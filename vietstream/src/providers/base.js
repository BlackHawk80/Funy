'use strict';

const {
  getJson,
  normTitle,
  parseEpNum,
  detectAudio,
  audioKey,
  qualityFromText,
  mapImageUrl,
  extractUrlParam
} = require('../utils');

/**
 * Lớp nền chung cho mọi nguồn phim.
 * Mỗi provider cần cài: search(q), listCatalog(kind, extra), detail(slug)
 * và có thể ghi đè resolveStream / extractStreamItem / buildMeta.
 */
class BaseProvider {
  constructor(cfg) {
    this.id = cfg.id;
    this.name = cfg.name;
    this.prefix = cfg.prefix;
    this.cfg = cfg;
  }

  get headers() {
    return {
      'User-Agent': require('../config').CONFIG.userAgent,
      Referer: this.cfg.referer,
      Accept: 'application/json, text/plain, */*'
    };
  }

  async request(url, opts = {}) {
    return getJson(url, { headers: this.headers, ...opts });
  }

  // ---------- Tìm & so khớp ----------

  // Chấm điểm 1 ứng viên: IMDb trùng +30, tên gốc khớp tuyệt đối +100,
  // tên Việt khớp +90, khớp một phần +10, năm chênh <=1 +20 (lệch xa -50),
  // entry "Phần N/Season N" đúng mùa đang hỏi +25, sai mùa -40.
  scoreItem(it, { title, year, imdbId, type, season }) {
    const q = normTitle(title);
    if (!q) return -Infinity;
    let score = 0;
    if (imdbId && it.imdbId && String(it.imdbId).toLowerCase() === String(imdbId).toLowerCase()) score += 30;

    const key = normTitle(it.originalName || it.name);
    const nameKey = normTitle(it.name);
    if (key && key === q) score += 100;
    else if (nameKey && nameKey === q) score += 90;
    else if (key && Math.min(q.length, key.length) > 6 && (q.includes(key) || key.includes(q))) score += 10;
    else return -Infinity;

    const yr = parseInt(year, 10);
    const itY = parseInt(it.year, 10);
    if (itY && yr) score += Math.abs(itY - yr) <= 1 ? 20 : -50;

    const sn = this.seasonMarker(it);
    if (sn != null) score += type === 'series' && sn === (parseInt(season, 10) || 1) ? 25 : -40;
    return score;
  }

  // "Phần 2" / "Season 2" / "(Part 2)" / "S02" trong tên phim
  seasonMarker(it) {
    const hay = `${it.name || ''} ${it.originalName || ''}`.toLowerCase();
    let m = hay.match(/(?:phần|season|part)\s*(\d+)/);
    if (m) return parseInt(m[1], 10);
    m = hay.match(/\bs\s*(\d{1,2})\b/);
    if (m) return parseInt(m[1], 10);
    return null;
  }

  // Danh sách ứng viên xếp theo điểm giảm dần (score >= 10)
  matchCandidates(items, opts) {
    if (!Array.isArray(items)) return [];
    return items
      .map((it) => ({ it, score: this.scoreItem(it, opts) }))
      .filter((x) => x.score >= 10)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.it);
  }

  matchItem(items, opts) {
    return this.matchCandidates(items, opts)[0] || null;
  }

  // Chọn đúng tập từ danh sách episode của một server
  pickEpisode(items, epNum, isMovie) {
    if (!Array.isArray(items) || !items.length) return null;
    if (isMovie) {
      return items.find((e) => /full|fullhd/i.test(`${e.name || ''} ${e.slug || ''}`)) || items[0];
    }
    const target = parseInt(epNum, 10) || 1;
    let pool = items.filter((e) => parseEpNum(e.name) === target || parseEpNum(e.slug) === target);
    if (!pool.length && target >= 1 && target <= items.length) pool = [items[target - 1]];
    return pool[0] || null;
  }

  // ---------- Xây stream / meta ----------

  makeStream({ movieName, epLabel, audio, quality, url, externalUrl, headers }) {
    const q = quality || 'HD';
    const stream = {
      name: `${this.name}\n${q} · ${audio || 'Vietsub'}`,
      title: [epLabel, movieName].filter(Boolean).join(' • '),
      behaviorHints: {
        notWebReady: false,
        bingeGroup: `${this.id}-${audioKey(audio || 'vietsub')}`
      }
    };
    // tag nội bộ (không serialise ra JSON) để routes biết stream thuộc nguồn nào
    Object.defineProperty(stream, '_providerId', { value: this.id, enumerable: false });
    if (externalUrl) {
      stream.externalUrl = externalUrl;
      stream.title = `${stream.title} • Mở bằng trình duyệt`;
    } else {
      stream.url = url;
    }
    if (headers) stream.behaviorHints.proxyHeaders = { request: headers };
    return stream;
  }

  buildMeta(d, { withVideos = true } = {}) {
    if (!d) return null;
    const meta = {
      id: `${this.prefix}${d.slug}`,
      type: d.type === 'series' ? 'series' : 'movie',
      name: d.name || d.originalName,
      poster: d.poster,
      posterShape: 'poster',
      background: d.background || d.poster,
      description: d.description || '',
      releaseInfo: [d.quality, d.lang, d.year].filter(Boolean).join(' · ') || (d.year ? String(d.year) : undefined),
      genres: d.genres || undefined,
      runtime: d.time || undefined,
      cast: d.cast || undefined,
      director: d.director || undefined
    };
    if (meta.type === 'series' && withVideos && Array.isArray(d.videos)) {
      meta.videos = d.videos;
    }
    return meta;
  }

  // Danh sách tập (videos) từ episode đầu tiên tìm được
  videosFromServers(servers, metaId) {
    const primary = (servers || []).find((s) => (s.items || []).length) || servers?.[0];
    const items = primary ? primary.items || [] : [];
    return items
      .map((e, idx) => {
        const num = parseEpNum(e.name) || parseEpNum(e.slug) || idx + 1;
        return {
          id: `${metaId}:1:${num}`,
          title: e.name && /tập|ep/i.test(e.name) ? e.name : `Tập ${num}`,
          season: 1,
          episode: num,
          released: new Date().toISOString()
        };
      });
  }

  // Luồng mặc định: search -> xếp hạng ứng viên -> thử từng ứng viên cho tới khi có stream
  async resolveStream({ imdbId, title, year, type, season, episode }) {
    const hits = await this.search(title);
    const cands = this.matchCandidates(hits, { title, year, imdbId, type, season });
    for (const it of cands.slice(0, 3)) {
      try {
        const streams = await this.streamsFromSlug(it.slug, type, season, episode);
        if (streams.length) return streams;
      } catch { /* thử ứng viên kế tiếp */ }
    }
    return [];
  }

  // Xây danh sách stream từ detail đã chuẩn hoá
  async streamsFromDetail(d, { season, episode }) {
    const isMovie = d.type !== 'series';
    const epNum = isMovie ? null : parseInt(episode, 10) || 1;
    const streams = [];
    for (const server of d.servers || []) {
      const items = server.items || [];
      const ep = this.pickEpisode(items, epNum, isMovie);
      if (!ep) continue;
      const audio = detectAudio(server.serverName, detectAudio(d.lang, 'Vietsub'));
      const src = await this.extractStreamItem(ep);
      if (!src) continue;
      streams.push(
        this.makeStream({
          movieName: d.name,
          epLabel: isMovie ? ep.name || 'Full' : `Tập ${epNum}`,
          audio,
          quality: qualityFromText(ep.filename || ep.name, d.quality),
          url: src.url,
          externalUrl: src.externalUrl,
          headers: src.headers || { 'User-Agent': require('../config').CONFIG.userAgent, Referer: this.cfg.referer }
        })
      );
    }
    return streams;
  }

  // Mỗi provider tự cài cách lấy m3u8 từ 1 episode item
  extractStreamItem(ep) {
    if (ep.m3u8) return { url: ep.m3u8 };
    if (ep.embed) {
      const inner = extractUrlParam(ep.embed);
      if (inner) return { url: inner };
      return { externalUrl: ep.embed };
    }
    return null;
  }

  // ---------- Catalog (mỗi provider tự cài) ----------
  async listCatalog(/* kind, extra */) {
    return [];
  }
}

module.exports = BaseProvider;
