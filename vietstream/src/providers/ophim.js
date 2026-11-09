'use strict';

const BaseProvider = require('./base');
const { getJson, stripHtml, mapImageUrl, cached, extractUrlParam } = require('../utils');

// Nguồn OPhim — format API /v1/api của mã nguồn OPhim (ophim1.cc, ophim.live và các site chạy mã nguồn này).
// OPhim gốc đã ngừng hoạt động; domain có thể thay đổi -> cấu hình qua OPHIM_API_URL.
// Provider tự hủy kết quả nếu nguồn chết (không làm treo addon).

class OphimProvider extends BaseProvider {
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
      poster: mapImageUrl(item.poster_url, item.poster_url && /^https?:/i.test(item.poster_url) ? null : this.cfg.cdnImage),
      background: mapImageUrl(item.thumb_url, item.thumb_url && /^https?:/i.test(item.thumb_url) ? null : this.cfg.cdnImage),
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
    return cached(`op:search:${q}`, 10 * 60 * 1000, async () => {
      const data = await this.request(`${this.cfg.apiUrl}/v1/api/tim-kiem?keyword=${encodeURIComponent(q)}&page=1&limit=24`);
      const items = (data && data.data && data.data.items) || (data && data.items) || [];
      return items.map((i) => this.normalizeItem(i, 'movie'));
    });
  }

  async listCatalog(kind, extra = {}) {
    const page = Math.max(1, Math.floor((parseInt(extra.skip, 10) || 0) / 20) + 1);
    if (extra.search) return (await this.search(extra.search)).map((i) => this.toMeta(i));
    const path = kind === 'phim-bo' ? 'phim-bo' : 'phim-le';
    const type = kind === 'phim-bo' ? 'series' : 'movie';
    const data = await this.request(`${this.cfg.apiUrl}/v1/api/danh-sach/${path}?page=${page}&limit=20`);
    const items = (data && data.data && data.data.items) || (data && data.items) || [];
    return items.map((i) => this.toMeta(this.normalizeItem(i, type)));
  }

  async detail(slug) {
    return cached(`op:detail:${slug}`, 60 * 60 * 1000, async () => {
      const data = await this.request(`${this.cfg.apiUrl}/v1/api/phim/${encodeURIComponent(slug)}`);
      if (!data || !data.data) return null;
      const d = data.data;
      const m = d.item || d.movie || {};
      if (!m.slug && !m.name) return null;
      const eps = d.episodes || m.episodes || [];
      const servers = eps.map((s) => ({
        serverName: s.server_name || 'Vietsub',
        items: (s.items || s.server_data || []).map((e) => ({
          name: e.name,
          slug: e.slug,
          m3u8: e.link_m3u8 || e.m3u8 || extractUrlParam(e.link_embed || e.embed) || null,
          embed: e.link_embed || e.embed || null
        }))
      }));
      const cdn = (d && d.APP_DOMAIN_CDN_IMAGE) || (data.data && data.data.APP_DOMAIN_CDN_IMAGE) || this.cfg.cdnImage;
      return {
        slug: m.slug || slug,
        name: m.name,
        originalName: m.origin_name,
        year: m.year,
        type: ['series', 'hoathinh', 'tvshows'].includes(m.type) ? 'series' : 'movie',
        quality: m.quality,
        lang: m.lang,
        time: m.time,
        poster: mapImageUrl(m.poster_url, m.poster_url && /^https?:/i.test(m.poster_url) ? null : cdn),
        background: mapImageUrl(m.thumb_url, m.thumb_url && /^https?:/i.test(m.thumb_url) ? null : cdn),
        description: stripHtml(m.content),
        genres: Array.isArray(m.category) ? m.category.map((c) => c.name || c.slug) : [],
        imdbId: m.imdb?.id || null,
        servers,
        videos: this.videosFromServers(servers, `${this.prefix}${m.slug || slug}`)
      };
    });
  }

  async streamsFromSlug(slug, type, season, episode) {
    const d = await this.detail(slug);
    if (!d) return [];
    return this.streamsFromDetail(d, { season, episode });
  }
}

module.exports = { OphimProvider };
