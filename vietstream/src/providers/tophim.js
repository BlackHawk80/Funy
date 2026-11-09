'use strict';

const BaseProvider = require('./base');
const { getText, cached } = require('../utils');

// Nguồn Tophim (tophim.top) — hậu duệ còn sống của nhà Motchill / PhimMoi
// (site tự nhận brand "TOPHIM, MOTCHILL, PHIMMOI", gộp cả stream kkphim/nguonc/ophim).
//  - Tìm kiếm: /api/search/suggestions?q=  (JSON)
//  - Chi tiết: /phim/{slug} (HTML Next.js nhúng JSON tập + video_url m3u8)
// Nếu nhà Motchill ra domain mới chạy cùng CMS, chỉ cần đổi TOPHIM_API_URL.

const UA = require('../config').CONFIG.userAgent;

function unescapeSsr(body) {
  let b = String(body || '');
  while (b.includes('\\"')) {
    b = b.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return b;
}

class TophimProvider extends BaseProvider {
  toMeta(it) {
    return {
      id: `${this.prefix}${it.slug}`,
      type: it.type === 'series' ? 'series' : 'movie',
      name: it.name || it.originalName,
      poster: it.poster,
      posterShape: 'poster',
      background: it.poster,
      year: it.year
    };
  }

  async search(q) {
    if (!q) return [];
    return cached(`tp:search:${q}`, 10 * 60 * 1000, async () => {
      const data = await this.request(`${this.cfg.apiUrl}/api/search/suggestions?q=${encodeURIComponent(q)}`);
      const movies = (data && data.movies) || [];
      return movies.map((m) => ({
        slug: m.slug,
        name: m.title,
        originalName: m.original_title,
        poster: m.poster_url || m.thumb_url || null,
        year: m.year || null
      }));
    });
  }

  async detail(slug) {
    return cached(`tp:detail:${slug}`, 60 * 60 * 1000, async () => {
      const html = await getText(`${this.cfg.apiUrl}/phim/${encodeURIComponent(slug)}`, {
        headers: { 'User-Agent': UA, Referer: `${this.cfg.apiUrl}/` },
        timeout: 12000
      });
      if (!html) return null;
      const b = unescapeSsr(html);

      // Tên phim + năm từ thẻ <title>: "Xem Phim Tên Việt (Original) (2023) HD Vietsub | Tô Phim"
      const t = (html.match(/<title>([^<]+)<\/title>/) || [])[1] || '';
      const tm = t.match(/Xem Phim\s+(.+?)\s+\(([^()]*)\)\s+\((\d{4})\)/);
      const name = tm ? tm[1].trim() : slug;
      const originalName = tm && tm[2] ? tm[2].trim() : '';
      const year = tm ? parseInt(tm[3], 10) : null;
      const qualityM = t.match(/\b(4K|2160p|1080p|HD)\b/i);

      // Tập: "label","name":"Tập 1","slug":"...","video_url":"https://..."
      // (label là nhãn server/audio đứng ngay trước "name")
      const re = /"([^"]+)","name":"([^"]+)","slug":"([^"]+)","video_url":"([^"]+)"/g;
      const groups = {};
      let m;
      let count = 0;
      while ((m = re.exec(b))) {
        const label = m[1].trim().replace(/^#/, '');
        const epName = m[2];
        const url = m[4];
        // bỏ qua link embed (đã có nguồn NguonC riêng cover) — chỉ lấy m3u8 trực tiếp
        if (!/^https?:\/\//i.test(url) || /embed\.php|\/embed/i.test(url)) continue;
        if (!groups[label]) groups[label] = [];
        groups[label].push({ name: epName, slug: m[3], m3u8: url, embed: null });
        count++;
      }
      if (!count) return null;

      const servers = Object.keys(groups).map((label) => ({
        serverName: label,
        items: groups[label]
      }));
      const hasNumbered = servers.some((s) => s.items.some((e) => /tập|\d/.test(e.name) && !/full/i.test(e.name)));
      return {
        slug,
        name,
        originalName,
        year,
        type: hasNumbered && count > 1 ? 'series' : 'movie',
        quality: qualityM ? qualityM[0].toUpperCase() : 'HD',
        lang: '',
        poster: null,
        background: null,
        description: '',
        servers,
        videos: this.videosFromServers(servers, `${this.prefix}${slug}`)
      };
    });
  }

  async streamsFromSlug(slug, type, season, episode) {
    const d = await this.detail(slug);
    if (!d) return [];
    return this.streamsFromDetail(d, { season, episode });
  }
}

module.exports = { TophimProvider };
