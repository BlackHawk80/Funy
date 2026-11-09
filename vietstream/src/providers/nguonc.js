'use strict';

const BaseProvider = require('./base');
const { getJson, getText, stripHtml, mapImageUrl, cached, parseEpNum } = require('../utils');

// Nguồn NguonC — API công khai https://phim.nguonc.com/api
// Một số phim trả m3u8 trực tiếp, một số chỉ có link embed StreamC
// -> dùng bộ giải mã data-obf / Dean Edwards / regex m3u8, hoặc trả externalUrl.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function isSeriesItem(it) {
  return (
    parseInt(it.total_episodes, 10) > 1 ||
    (it.current_episode && !/full/i.test(String(it.current_episode)))
  );
}

function sanitizeImg(url) {
  return mapImageUrl(url, 'https://phim.nguonc.com');
}

function toMetaItem(it) {
  return {
    slug: it.slug,
    name: it.name,
    originalName: it.original_name,
    year: it.year,
    type: isSeriesItem(it) ? 'series' : 'movie',
    poster: sanitizeImg(it.poster_url || it.thumb_url),
    background: sanitizeImg(it.thumb_url || it.poster_url),
    quality: it.quality,
    lang: it.language,
    description: stripHtml(it.description)
  };
}

class NguoncProvider extends BaseProvider {
  async request(url, opts = {}) {
    // thử domain chính, lỗi thì thử domain dự phòng
    let data = await getJson(url, { headers: this.headers, ...opts });
    if (data) return data;
    for (const fb of this.cfg.apiFallbacks || []) {
      if (!url.startsWith(this.cfg.apiUrl)) break;
      data = await getJson(url.replace(this.cfg.apiUrl, fb), { headers: this.headers, ...opts });
      if (data) return data;
    }
    return null;
  }

  toMeta(it) {
    return {
      id: `${this.prefix}${it.slug}`,
      type: it.type === 'series' ? 'series' : 'movie',
      name: it.name || it.originalName,
      poster: it.poster,
      posterShape: 'poster',
      background: it.background,
      releaseInfo: [it.quality, it.lang, it.year].filter(Boolean).join(' · ') || (it.year ? String(it.year) : undefined),
      year: it.year
    };
  }

  async search(q) {
    if (!q) return [];
    return cached(`nc:search:${q}`, 10 * 60 * 1000, async () => {
      const data = await this.request(`${this.cfg.apiUrl}/films/search?keyword=${encodeURIComponent(q)}&page=1`);
      const items = (data && data.items) || [];
      return items.map(toMetaItem);
    });
  }

  async listCatalog(kind, extra = {}) {
    const page = Math.max(1, Math.floor((parseInt(extra.skip, 10) || 0) / 10) + 1);
    if (extra.search) return (await this.search(extra.search)).map((i) => this.toMeta(i));
    let path = '/films/danh-sach/phim-le';
    if (kind === 'phim-bo') path = '/films/danh-sach/phim-bo';
    else if (kind === 'moi') path = '/films/phim-moi-cap-nhat';
    const data = await this.request(`${this.cfg.apiUrl}${path}?page=${page}`);
    const items = (data && data.items) || [];
    return items.map((i) => this.toMeta(toMetaItem(i)));
  }

  async detail(slug) {
    return cached(`nc:detail:${slug}`, 60 * 60 * 1000, async () => {
      const data = await this.request(`${this.cfg.apiUrl}/film/${encodeURIComponent(slug)}`);
      const m = data && (data.movie || data);
      if (!m || (!m.name && !m.slug)) return null;
      const servers = (m.episodes || []).map((s) => ({
        serverName: s.server_name || 'Vietsub',
        items: (s.items || s.server_data || []).map((e) => ({
          name: e.name,
          slug: e.slug,
          m3u8: e.m3u8 || null,
          embed: e.embed || null
        }))
      }));
      return {
        slug: m.slug || slug,
        name: m.name,
        originalName: m.original_name,
        year: m.year,
        type: isSeriesItem(m) ? 'series' : 'movie',
        quality: m.quality,
        lang: m.language,
        time: m.time,
        poster: sanitizeImg(m.poster_url || m.thumb_url),
        background: sanitizeImg(m.thumb_url || m.poster_url),
        description: stripHtml(m.description),
        cast: typeof m.casts === 'string' ? m.casts.split(',').map((s) => s.trim()) : undefined,
        director: typeof m.director === 'string' ? [m.director] : undefined,
        servers,
        videos: this.videosFromServers(servers, `${this.prefix}${m.slug || slug}`)
      };
    });
  }

  // Giải mã link embed StreamC -> m3u8
  async extractStreamC(embedUrl) {
    if (!embedUrl) return null;
    try {
      const origin = new URL(embedUrl).origin;
      const html = await getText(embedUrl, {
        headers: { 'User-Agent': UA, Referer: 'https://phim.nguonc.com/', Origin: 'https://phim.nguonc.com' },
        timeout: 6000
      });
      if (!html) return null;

      // 1) data-obf: base64 JSON chứa { sUb, hD }
      const obf = html.match(/data-obf=["']([^"']+)["']/i);
      if (obf) {
        try {
          const decoded = JSON.parse(Buffer.from(obf[1], 'base64').toString('utf8'));
          if (decoded && decoded.sUb) {
            return { m3u8: `${origin}/${decoded.sUb}`, referer: `${origin}/` };
          }
        } catch { /* ignore */ }
      }

      // 2) Dean Edwards unpacker
      if (html.includes('eval(function(p,a,c,k,e,d)')) {
        const unpacked = unpackDeanEdwards(html);
        const sub = unpacked.match(/["'](eyJoIjoi[^"']+)["']/);
        if (sub) return { m3u8: `${origin}/${sub[1]}`, referer: `${origin}/` };
        const direct = unpacked.match(/(https?:\/\/[^"'\s)]+\.m3u8[^"'\s)]*)/i);
        if (direct) return { m3u8: direct[1], referer: `${origin}/` };
      }

      // 3) regex m3u8 trực tiếp trong HTML
      const direct = html.match(/(https?:\/\/[^"'\s)]+\.m3u8[^"'\s)]*)/i);
      if (direct) return { m3u8: direct[1], referer: `${origin}/` };
    } catch { /* ignore */ }
    return null;
  }

  async extractStreamItem(ep) {
    if (ep.m3u8) return { url: ep.m3u8 };
    if (ep.embed) {
      const extracted = await this.extractStreamC(ep.embed);
      if (extracted) return { url: extracted.m3u8, headers: { 'User-Agent': UA, Referer: extracted.referer } };
      return { externalUrl: ep.embed };
    }
    return null;
  }

  async streamsFromDetail(d, { season, episode }) {
    const isMovie = d.type !== 'series';
    const epNum = isMovie ? null : parseInt(episode, 10) || 1;
    const streams = [];
    for (const server of d.servers || []) {
      const ep = this.pickEpisode(server.items, epNum, isMovie);
      if (!ep) continue;
      const src = await this.extractStreamItem(ep); // tuần tự: ít request song song
      if (!src) continue;
      const audio = require('../utils').detectAudio(server.serverName, require('../utils').detectAudio(d.lang, 'Vietsub'));
      streams.push(
        this.makeStream({
          movieName: d.name,
          epLabel: isMovie ? ep.name || 'Full' : `Tập ${epNum}`,
          audio,
          quality: d.quality,
          url: src.url,
          externalUrl: src.externalUrl,
          headers: src.headers || { 'User-Agent': UA, Referer: this.cfg.referer }
        })
      );
    }
    return streams;
  }

  async streamsFromSlug(slug, type, season, episode) {
    const d = await this.detail(slug);
    if (!d) return [];
    return this.streamsFromDetail(d, { season, episode });
  }
}

// Unpacker Dean Edwards (p,a,c,k,e,d)
function unpackDeanEdwards(packed) {
  const m = packed.match(
    /eval\(function\(p,a,c,k,e,d\)[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/
  );
  if (!m) return packed;
  let [, p, a, c, k] = m;
  a = parseInt(a, 10);
  c = parseInt(c, 10);
  const keys = k.split('|');
  const e = (cVal) =>
    (cVal < a ? '' : e(Math.floor(cVal / a))) +
    ((cVal = cVal % a) > 35 ? String.fromCharCode(cVal + 29) : cVal.toString(36));
  while (c--) {
    if (keys[c]) p = p.replace(new RegExp('\\b' + e(c) + '\\b', 'g'), keys[c]);
  }
  return p;
}

module.exports = { NguoncProvider };
