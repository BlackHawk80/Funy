'use strict';

const BaseProvider = require('./base');
const { getJson, stripHtml, mapImageUrl, parseEpNum, qualityFromText, cached } = require('../utils');
const { CONFIG } = require('../config');

// Nguồn KKphim — API công khai tại https://phimapi.com
// Search items có sẵn imdb.id nên khớp IMDb ID trực tiếp, rất chính xác.

const GENRE_MAP = {
  'Hành Động': 'hanh-dong',
  'Phiêu Lưu': 'phieu-luu',
  'Hài Hước': 'hai-huoc',
  'Cổ Trang': 'co-trang',
  'Tâm Lý': 'tam-ly',
  'Hình Sự': 'hinh-su',
  'Chiến Tranh': 'chien-tranh',
  'Võ Thuật': 'vo-thuat',
  'Viễn Tưởng': 'vien-tuong',
  'Khoa Học Viễn Tưởng': 'khoa-hoc-vien-tuong',
  'Kinh Dị': 'kinh-di',
  'Âm Nhạc': 'am-nhac',
  'Thần Thoại': 'than-thoai',
  'Tài Liệu': 'tai-lieu',
  'Gia Đình': 'gia-dinh',
  'Chính Kịch': 'chinh-kich',
  'Bí Ẩn': 'bi-an',
  'Học Đường': 'hoc-duong',
  'Kinh Điển': 'kinh-dien',
  'Tình Cảm': 'tinh-cam',
  'Hoạt Hình': 'hoat-hinh',
  'Thể Thao': 'the-thao'
};

// Các danh mục catalog của KKphim -> endpoint
const CATALOG_ENDPOINTS = {
  'phim-le': { path: '/v1/api/danh-sach/phim-le', type: 'movie' },
  'chieu-rap': { path: '/v1/api/danh-sach/phim-chieu-rap', type: 'movie' },
  'phim-bo': { path: '/v1/api/danh-sach/phim-bo', type: 'series' },
  'hoat-hinh': { path: '/v1/api/danh-sach/hoat-hinh', type: 'series' }
};

class KKphimProvider extends BaseProvider {
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
      poster: mapImageUrl(item.poster_url, this.cfg.cdnImage),
      background: mapImageUrl(item.thumb_url, this.cfg.cdnImage),
      imdbId: item.imdb?.id || null,
      quality: item.quality,
      lang: item.lang
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
    return cached(`kk:search:${q}`, 10 * 60 * 1000, async () => {
      const data = await this.request(
        `${this.cfg.apiUrl}/v1/api/tim-kiem?keyword=${encodeURIComponent(q)}&page=1&limit=24`
      );
      const items = (data && data.data && data.data.items) || [];
      return items.map((i) => this.normalizeItem(i, 'movie'));
    });
  }

  async listCatalog(kind, extra = {}) {
    const page = Math.max(1, Math.floor((parseInt(extra.skip, 10) || 0) / 20) + 1);
    if (extra.search) return (await this.search(extra.search)).map((i) => this.toMeta(i));

    let items = [];
    if (extra.genre) {
      // dùng danh-sach + category để giữ đúng loại phim (phim-le/phim-bo/...),
      // endpoint the-loai trả lẫn cả movie lẫn series
      const slug = GENRE_MAP[extra.genre] || String(extra.genre).toLowerCase().replace(/\s+/g, '-');
      const ep = CATALOG_ENDPOINTS[kind] || CATALOG_ENDPOINTS['phim-le'];
      const data = await this.request(
        `${this.cfg.apiUrl}${ep.path}?category=${encodeURIComponent(slug)}&page=${page}&limit=20`
      );
      items = (data && data.data && data.data.items) || [];
    } else {
      const ep = CATALOG_ENDPOINTS[kind];
      if (!ep) return [];
      const data = await this.request(`${this.cfg.apiUrl}${ep.path}?page=${page}&limit=20`);
      items = (data && data.data && data.data.items) || [];
    }
    return items.map((i) => this.toMeta(this.normalizeItem(i, CATALOG_ENDPOINTS[kind] ? CATALOG_ENDPOINTS[kind].type : 'movie')));
  }

  async detail(slug) {
    return cached(`kk:detail:${slug}`, 60 * 60 * 1000, async () => {
      const data = await this.request(`${this.cfg.apiUrl}/phim/${encodeURIComponent(slug)}`);
      if (!data || !data.status || !data.movie) return null;
      const m = data.movie;
      const servers = (data.episodes || []).map((s) => ({
        serverName: s.server_name || 'Vietsub',
        items: (s.server_data || []).map((e) => ({
          name: e.name,
          slug: e.slug,
          filename: e.filename || '',
          m3u8: e.link_m3u8 || null,
          embed: e.link_embed || null
        }))
      }));
      return {
        slug: m.slug,
        name: m.name,
        originalName: m.origin_name,
        year: m.year,
        type: ['series', 'hoathinh', 'tvshows'].includes(m.type) ? 'series' : 'movie',
        quality: m.quality,
        lang: m.lang,
        time: m.time,
        poster: mapImageUrl(m.poster_url, this.cfg.cdnImage),
        background: mapImageUrl(m.thumb_url, this.cfg.cdnImage),
        description: stripHtml(m.content),
        genres: Array.isArray(m.category) ? m.category.map((c) => c.name || c.slug) : [],
        cast: Array.isArray(m.actor) ? m.actor : undefined,
        director: Array.isArray(m.director) ? m.director : undefined,
        imdbId: m.imdb?.id || null,
        servers,
        videos: this.videosFromServers(servers, `${this.prefix}${m.slug}`)
      };
    });
  }

  extractStreamItem(ep) {
    if (ep.m3u8) return { url: ep.m3u8 };
    if (ep.embed) {
      try {
        const u = new URL(ep.embed);
        const v = u.searchParams.get('url');
        if (v && /^https?:/i.test(v)) return { url: v };
      } catch { /* ignore */ }
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

module.exports = { KKphimProvider, GENRE_MAP };
