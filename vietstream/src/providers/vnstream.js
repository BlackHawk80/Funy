'use strict';

const BaseProvider = require('./base');
const { getText, getJson, parseEpNum, detectAudio, cached, mapImageUrl } = require('../utils');
const { decodeNativeId } = require('./k20');
const { CONFIG, PROVIDERS } = require('../config');
const { KKphimProvider } = require('./kkphim');
const { normTitle } = require('../utils');
const { wrappedVideoOffset } = require('../hls-proxy');

// Nguồn VnStream — CoBePhim (biz redirects to fit):
//  - API nội bộ: /movies/search, /episodes/by-idMovie/{id}, /movies/hot
//  - Link xem: lấy m3u8 trực tiếp từ trang xem-phim (SSR React) hoặc giải mã embed (baseUrl + videoHash).

const UA = CONFIG.userAgent;

function unescapeSsr(body) {
  let b = String(body || '');
  while (b.includes('\\"')) {
    b = b.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return b;
}

// Ưu tiên server: Vietsub -> Phụ đề -> Thuyết minh -> Song ngữ -> còn lại
function serverScore(name) {
  const s = String(name || '');
  if (/vietsub/i.test(s)) return 0;
  if (/phụ đề|phu de/i.test(s)) return 1;
  if (/thuyết minh|thuyet minh/i.test(s)) return 2;
  if (/song ngữ|song ngu/i.test(s)) return 3;
  return 4;
}

// Only accept the same title, year and media type; never substitute by slug alone.
async function matchingFallback(detail, slug) {
  const other = await new KKphimProvider(PROVIDERS.kkphim).detail(slug);
  if (!other || other.type !== detail.type || !detail.year || Number(other.year) !== Number(detail.year)) return null;
  const a = normTitle(detail.originalName || detail.name);
  const b = normTitle(other.originalName || other.name);
  if (!a || a !== b) return null;
  if (detail.imdbId && other.imdbId && detail.imdbId !== other.imdbId) return null;
  return other;
}

async function playableHls(url, headers = {}, allowWrapped = false) {
  if (!/^https?:\/\//i.test(url || '')) return false;
  return cached(`playable:${allowWrapped}:${url}`, 120000, async () => {
    try {
      let target = url;
      for (let depth = 0; depth < 3; depth++) {
        const res = await fetch(target, { headers, signal: AbortSignal.timeout(12000) });
        if (!res.ok) return false;
        const text = await res.text();
        if (!text.trimStart().startsWith('#EXTM3U')) return false;
        const line = text.split(/\r?\n/).find(l => l.trim() && !l.startsWith('#'));
        if (!line) return false;
        const next = new URL(line.trim(), res.url || target).href;
        if (text.includes('#EXT-X-STREAM-INF')) { target = next; continue; }
        const seg = await fetch(next, { headers, signal: AbortSignal.timeout(12000) });
        if (!seg.ok || !seg.body) return false;
        const reader = seg.body.getReader(); let bytes = Buffer.alloc(0);
        try {
          while (bytes.length < 8192) { const {value,done}=await reader.read(); if(done) break; bytes=Buffer.concat([bytes,Buffer.from(value)]); }
        } finally { await reader.cancel(); }
        // Reject HTML challenges and image-wrapped segments, even with HTTP 200.
        return (allowWrapped && /(^|\.)streamvsmov\.com$/i.test(new URL(next).hostname) && wrappedVideoOffset(bytes) >= 0) || (bytes[0] === 0x47 && bytes[188] === 0x47 && bytes[376] === 0x47) ||
          ['ftyp','styp','moof'].includes(bytes.toString('ascii',4,8));
      }
    } catch { return false; }
    return false;
  });
}

class VnstreamProvider extends BaseProvider {
  validateHls(url, headers) { return playableHls(url, headers, true); }
  getFallback(detail, slug) { return matchingFallback(detail, slug); }

  async search(q) {
    if (!q) return [];
    return cached(`vn:search:${q}`, 10 * 60 * 1000, async () => {
      const data = await getJson(`${this.cfg.apiUrl}/movies/search?keyword=${encodeURIComponent(q)}`, {
        headers: { 'User-Agent': UA, Referer: this.cfg.referer }
      });
      const result = (data && data.result) || [];
      return result.map((it) => ({
        slug: it.slug,
        name: it.name,
        originalName: it.origin_name,
        year: it.publish_year || it.year || null,
        type: it.type === 'series' ? 'series' : 'movie',
        poster: mapImageUrl(it.poster || it.thumbnail, null),
        imdbId: it.imdb_id || it.imdbId || null,
        id: it.id
      }));
    });
  }

  toMeta(it) {
    return {
      id: `${this.prefix}${it.slug}`,
      type: it.type === 'series' ? 'series' : 'movie',
      name: it.name || it.originalName,
      poster: it.poster,
      posterShape: 'poster',
      background: it.poster,
      releaseInfo: it.year ? String(it.year) : undefined,
      year: it.year
    };
  }

  async listCatalog(kind, extra = {}) {
    const page = Math.max(1, Math.floor((parseInt(extra.skip, 10) || 0) / 20) + 1);
    if (extra.search) return (await this.search(extra.search)).filter(i => i.type === (kind === 'bo' ? 'series' : 'movie')).map((i) => this.toMeta(i));

    if (kind === 'moi') {
      const data = await getJson(`${this.cfg.apiUrl}/movies/hot`, {
        headers: { 'User-Agent': UA, Referer: this.cfg.referer }
      });
      const result = (data && data.result) || [];
      return result.filter(it => it.type !== 'series').slice(Math.max(0, parseInt(extra.skip,10)||0), Math.max(0, parseInt(extra.skip,10)||0)+20).map((it) =>
        this.toMeta({ slug: it.slug, name: it.name, poster: mapImageUrl(it.poster || it.thumbnail, null), type: 'movie' })
      );
    }

    // Các mục còn lại scrape HTML danh sách (phim-bo, the-loai/...)
    const path =
      kind === 'bo'
        ? `${this.cfg.siteUrl}/phim-bo?page=${page}`
        : `${this.cfg.siteUrl}/the-loai/${kind}?page=${page}`;
    return cached(`vn:cat:${path}`, 30 * 60 * 1000, async () => {
      let html = await getText(path, { headers: { 'User-Agent': UA, Referer: this.cfg.referer }, timeout: 10000 });
      if (!html) return [];
      html = unescapeSsr(html);
      const hostEsc = this.cfg.siteUrl.replace(/https?:\/\//, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`"url":"https?://${hostEsc}/phim/([^"]+)","name":"([^"]+)"`, 'g');
      const seen = new Set();
      const out = [];
      let m;
      while ((m = re.exec(html)) && out.length < 40) {
        const slug = m[1];
        if (seen.has(slug)) continue;
        seen.add(slug);
        out.push(this.toMeta({ slug, name: m[2], type: kind === 'bo' ? 'series' : 'movie' }));
      }
      return out;
    });
  }

  // Scrape trang chi tiết (SSR) để lấy id + imdb_id + năm
  async detailFromSite(slug) {
    return cached(`vn:detail:${slug}`, 60 * 60 * 1000, async () => {
      let html = await getText(`${this.cfg.siteUrl}/phim/${encodeURIComponent(slug)}`, {
        headers: { 'User-Agent': UA, Referer: this.cfg.referer },
        timeout: 10000
      });
      if (!html) return null;
      html = unescapeSsr(html);
      const i = html.indexOf('"movie":{');
      if (i < 0) return null;
      const chunk = html.slice(i, i + 4000);
      const grab = (re) => {
        const m = chunk.match(re);
        return m ? m[1] : null;
      };
      const idM = chunk.match(/"id":(\d+)/);
      return {
        id: idM ? parseInt(idM[1], 10) : null,
        slug,
        name: grab(/"name":"([^"]+)"/),
        originalName: grab(/"origin_name":"([^"]+)"/),
        imdbId: grab(/"imdb_id":"([^"]+)"/),
        year: grab(/"publish_year":(\d+)/),
        type: /"type":"series"/.test(chunk) ? 'series' : 'movie',
        poster: mapImageUrl(grab(/"poster":"([^"]+)"/), null)
      };
    });
  }

  async detail(slug) {
    slug = decodeNativeId(slug)?.id || slug;
    const d = await this.detailFromSite(slug);
    if (!d || !d.id) return null;
    const eps = await this.episodes(d.id);
    const videos = [];
    const seen = new Set();
    for (const e of eps) {
      const s = parseInt(e.season_number, 10) || 1;
      const num = parseEpNum(e.name) || parseEpNum(e.slug);
      if (!num) continue;
      const key = `${s}-${num}`;
      if (seen.has(key)) continue;
      seen.add(key);
      videos.push({
        id: `${this.prefix}${slug}:${s}:${num}`,
        title: `Tập ${num}`,
        season: s,
        episode: num,
        released: new Date().toISOString()
      });
    }
    return {
      slug,
      name: d.name,
      originalName: d.originalName,
      year: d.year ? parseInt(d.year, 10) : null,
      type: d.type,
      poster: d.poster,
      background: d.poster,
      description: '',
      imdbId: d.imdbId,
      servers: [],
      videos: videos.sort((a,b) => a.season-b.season || a.episode-b.episode)
    };
  }

  async episodes(movieId) {
    return cached(`vn:eps:${movieId}`, 30 * 60 * 1000, async () => {
      const data = await getJson(`${this.cfg.apiUrl}/episodes/by-idMovie/${movieId}`, {
        headers: { 'User-Agent': UA, Referer: this.cfg.referer }
      });
      return Array.isArray(data) ? data : [];
    });
  }

  // Lấy m3u8 từ trang xem phim của cobephim
  async watchM3u8(slug, epId) {
    const url = `${this.cfg.siteUrl}/xem-phim/${encodeURIComponent(slug)}.${epId}`;
    let html = await getText(url, {
      headers: { 'User-Agent': UA, Referer: `${this.cfg.siteUrl}/`, Accept: 'text/html' },
      timeout: 12000
    });
    if (!html) return null;

    // HTML React SSR có thể escape dấu quote
    let m = html.match(/"link"\s*:\s*\\?"(https?:\/\/[^"\\]+?\.m3u8[^"\\]*)\\?"/);
    if (m) return m[1];
    m = html.match(/"link"\s*:\s*"(https?:\/\/[^"]+?\.m3u8[^"]*)"/);
    if (m) return m[1];

    html = unescapeSsr(html);
    m = html.match(/"type":"([^"]+)","link":"([^"]+)"/);
    if (!m) return null;
    const [, typ, link] = m;
    if (/m3u8/i.test(typ)) return link;
    if (/embed/i.test(typ)) {
      const direct = await this.resolveEmbed(link).catch(() => null);
      return direct || null;
    }
    return null;
  }

  async resolveEmbed(embedUrl) {
    const response = await fetch(embedUrl, {
      headers: { 'User-Agent': UA, Referer: `${this.cfg.siteUrl}/` },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return null;
    const html = await response.text();
    if (!html) return null;
    const bm = html.match(/baseUrl\s*=\s*"([^"]+)"/);
    const vh = html.match(/videoHash\s*=\s*"([^"]+)"/);
    if (bm && vh) return `${bm[1]}/stream/${vh[1]}/master.m3u8`;
    const m = html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/i);
    return m ? m[0] : null;
  }

  async streamsFromSlug(slug, type, season, episode) {
    const isMovie = type !== 'series';
    slug = decodeNativeId(slug)?.id || slug;
    const d = await this.detailFromSite(slug);
    if (!d || !d.id) return [];
    let eps = await this.episodes(d.id);
    if (!eps.length) return [];

    // chọn tập
    let pool = eps;
    if (!isMovie) {
      const s = parseInt(season, 10) || 1;
      const target = parseInt(episode, 10) || 1;
      const bySeason = eps.filter((e) => (parseInt(e.season_number, 10) || 1) === s);
      pool = bySeason;
      const byNum = pool.filter((e) => parseEpNum(e.name) === target || parseEpNum(e.slug) === target);
      pool = byNum;
    } else {
      pool = eps.filter((e) => /full|tap-full/i.test(`${e.name} ${e.slug}`)) || eps;
      if (!pool.length) pool = eps;
    }
    if (!pool.length) return [];

    // mỗi server có bản ghi riêng cho cùng tập; sắp xếp theo mức ưu tiên audio
    const sorted = [...pool].sort((a, b) => serverScore(a.server) - serverScore(b.server));
    const headers = { 'User-Agent': UA, Referer: `${this.cfg.siteUrl}/` };
    const candidates = await Promise.allSettled(sorted.slice(0, 8).map(async ep => {
      const url = await this.watchM3u8(slug, ep.id);
      if (typeof url !== 'string' || !await this.validateHls(url, headers)) return null;
      return this.makeStream({ movieName: d.name, epLabel: isMovie ? 'Full' : `Tập ${episode}`,
        audio: detectAudio(ep.server, 'Vietsub'), quality: 'HD', url, headers });
    }));
    const streams = candidates.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
    if (!streams.length && (isMovie || (Number(season) || 1) === 1)) {
      const fallback = await this.getFallback({ ...d, type }, slug);
      for (const server of fallback?.servers || []) {
        const entry = isMovie ? server.items.find(e => /^(full|1|tập 0?1)$/i.test(e.name)) :
          server.items.find(e => parseEpNum(e.name) === (Number(episode) || 1));
        if (!entry?.m3u8 || !await this.validateHls(entry.m3u8, {})) continue;
        const stream = this.makeStream({ movieName: d.name, epLabel: isMovie ? 'Full' : `Tập ${episode}`,
          audio: detectAudio(server.serverName, 'Vietsub'), quality: fallback.quality, url: entry.m3u8 });
        stream.name = `KKphim dự phòng\n${fallback.quality || 'HD'} · ${detectAudio(server.serverName, 'Vietsub')}`;
        streams.push(stream);
      }
    }
    return streams;
  }
}

module.exports = { VnstreamProvider, matchingFallback, playableHls };
