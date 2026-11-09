'use strict';

const BaseProvider = require('./base');
const { stripHtml, mapImageUrl, cached, extractUrlParam, getText } = require('../utils');
const { CONFIG } = require('../config');

// Nguồn Phim4K — hệ VSMOV (vsmov.com/api), format tương tự OPhim.
// Domain có thể thay đổi -> cấu hình qua PHIM4K_API_URL. Chất lượng chủ đạo 4K/UHD.

class Phim4kProvider extends BaseProvider {
  normalizeItem(item, fallbackType = 'movie') {
    let type = fallbackType;
    if (item.type === 'single' || item.tmdb?.type === 'movie') type = 'movie';
    else if (['series', 'hoathinh', 'tvshows'].includes(item.type) || item.tmdb?.type === 'series') type = 'series';
    return {
      slug: item.slug,
      name: item.name,
      originalName: item.origin_name,
      year: item.year,
      type,
      poster: mapImageUrl(item.poster_url, null),
      background: mapImageUrl(item.thumb_url, null),
      imdbId: item.imdb?.id || null,
      quality: item.quality,
      lang: item.lang,
      description: stripHtml(item.content)
    };
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
      year: it.year,
      imdbId: it.imdbId || undefined
    };
  }

  async search(q) {
    if (!q) return [];
    return cached(`p4k:search:${q}`, 10 * 60 * 1000, async () => {
      const data = await this.request(`${this.cfg.apiUrl}/tim-kiem?keyword=${encodeURIComponent(q)}&page=1`);
      const items = (data && data.items) || (data && data.data && data.data.items) || [];
      return items.map((i) => this.normalizeItem(i, 'movie'));
    });
  }

  async listCatalog(kind, extra = {}) {
    const page = Math.max(1, Math.floor((parseInt(extra.skip, 10) || 0) / 20) + 1);
    if (extra.search) return (await this.search(extra.search)).map((i) => this.toMeta(i));
    const path = kind === 'phim-bo' ? 'phim-bo' : 'phim-le';
    const type = kind === 'phim-bo' ? 'series' : 'movie';
    const data = await this.request(`${this.cfg.apiUrl}/danh-sach/${path}?page=${page}&limit=20`);
    const items = (data && data.items) || (data && data.data && data.data.items) || [];
    return items.map((i) => this.toMeta(this.normalizeItem(i, type)));
  }

  async detail(slug) {
    return cached(`p4k:detail:${slug}`, 60 * 60 * 1000, async () => {
      const data = await this.request(`${this.cfg.apiUrl}/phim/${encodeURIComponent(slug)}`);
      if (!data) return null;
      const m = data.movie || (data.data && data.data.movie);
      if (!m) return null;
      const eps = data.episodes || (data.data && data.data.episodes) || [];
      const servers = eps.map((s) => ({
        serverName: s.server_name || 'Vietsub',
        items: (s.server_data || s.items || []).map((e) => ({
          name: e.name,
          slug: e.slug,
          filename: e.filename || '',
          m3u8: e.link_m3u8 || e.m3u8 || extractUrlParam(e.link_embed || e.embed) || null,
          embed: e.link_embed || e.embed || null
        }))
      }));
      return {
        slug: m.slug || slug,
        name: m.name,
        originalName: m.origin_name,
        year: m.year,
        type: ['series', 'hoathinh', 'tvshows'].includes(m.type) ? 'series' : 'movie',
        quality: m.quality,
        lang: m.lang,
        time: m.time,
        poster: mapImageUrl(m.poster_url, null),
        background: mapImageUrl(m.thumb_url, null),
        description: stripHtml(m.content),
        genres: Array.isArray(m.category) ? m.category.map((c) => c.name || c.slug) : [],
        imdbId: m.imdb?.id || null,
        servers,
        videos: this.videosFromServers(servers, `${this.prefix}${m.slug || slug}`)
      };
    });
  }

  // Embed của hệ streamvsmov chứa baseUrl + videoHash -> ghép thành master.m3u8
  async resolveEmbed(embedUrl) {
    const html = await getText(embedUrl, {
      headers: { 'User-Agent': CONFIG.userAgent, Referer: this.cfg.referer },
      timeout: 8000
    });
    if (!html) return null;
    const bm = html.match(/baseUrl\s*=\s*"([^"]+)"/);
    const vh = html.match(/videoHash\s*=\s*"([^"]+)"/);
    if (bm && vh) return `${bm[1]}/stream/${vh[1]}/master.m3u8`;
    const m = html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/i);
    return m ? m[0] : null;
  }

  async extractStreamItem(ep) {
    if (ep.m3u8) return { url: ep.m3u8 };
    if (ep.embed) {
      const inner = extractUrlParam(ep.embed);
      if (inner) return { url: inner };
      const resolved = await this.resolveEmbed(ep.embed);
      if (resolved) return { url: resolved, headers: { 'User-Agent': CONFIG.userAgent, Referer: this.cfg.referer } };
      return { externalUrl: ep.embed };
    }
    return null;
  }

  async streamsFromSlug(slug, type, season, episode) {
    const d = await this.detail(slug);
    if (!d) return [];
    return this.streamsFromDetail(d, { season, episode });
  }
}

module.exports = { Phim4kProvider };
