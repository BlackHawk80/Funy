'use strict';

const BaseProvider = require('./base');
const { cached, detectAudio, parseEpNum, qualityFromText } = require('../utils');
const { CONFIG } = require('../config');

const K20_SOURCES = ['nguonc', 'hh3d', 'stp', 'vsmov', 'yan'];

function encodeNativeId(type, id) {
  return Buffer.from(JSON.stringify({ type, id }), 'utf8').toString('base64url');
}

function decodeNativeId(value) {
  try {
    const decoded = JSON.parse(Buffer.from(String(value || ''), 'base64url').toString('utf8'));
    if (!decoded || !['movie', 'series'].includes(decoded.type) || !decoded.id) return null;
    return { type: decoded.type, id: String(decoded.id) };
  } catch {
    return null;
  }
}

function episodeNumber(video, index) {
  return parseEpNum(video && video.title) || parseInt(video && video.episode, 10) || index + 1;
}

class K20Provider extends BaseProvider {
  get headers() {
    return {
      'User-Agent': CONFIG.userAgent,
      Referer: this.cfg.referer,
      Accept: 'application/json, text/plain, */*'
    };
  }

  catalogIds(type) {
    return K20_SOURCES.map((source) => `${source}-${type}`);
  }

  normalizeMeta(meta, fallbackType) {
    const type = meta.type === 'series' ? 'series' : meta.type === 'movie' ? 'movie' : fallbackType;
    return {
      nativeId: String(meta.id || ''),
      slug: encodeNativeId(type, meta.id),
      type,
      name: meta.name,
      originalName: meta.name,
      year: parseEpNum(meta.releaseInfo),
      poster: meta.poster,
      background: meta.background || meta.poster,
      description: meta.description || '',
      releaseInfo: meta.releaseInfo
    };
  }

  toMeta(item) {
    return {
      id: `${this.prefix}${item.slug}`,
      type: item.type,
      name: item.name,
      poster: item.poster,
      posterShape: 'poster',
      background: item.background,
      description: item.description,
      releaseInfo: item.releaseInfo || (item.year ? String(item.year) : undefined),
      year: item.year || undefined
    };
  }

  async fetchCatalog(type, catalogId, extra = {}) {
    let suffix = '';
    if (extra.search) suffix = `/search=${encodeURIComponent(extra.search)}.json`;
    else if (parseInt(extra.skip, 10) > 0) suffix = `/skip=${parseInt(extra.skip, 10)}.json`;
    else suffix = '.json';

    const data = await this.request(`${this.cfg.apiUrl}/catalog/${type}/${catalogId}${suffix}`);
    return ((data && data.metas) || []).map((meta) => this.normalizeMeta(meta, type));
  }

  async searchType(query, type) {
    if (!query) return [];
    return (await cached(`k20:search:${type}:${query}`, 10 * 60 * 1000, async () => {
      const results = await Promise.allSettled(
        this.catalogIds(type).map((catalogId) => this.fetchCatalog(type, catalogId, { search: query }))
      );
      return this.mergeItems(results);
    })) || [];
  }

  async search(query) {
    if (!query) return [];
    const [movies, series] = await Promise.all([
      this.searchType(query, 'movie'),
      this.searchType(query, 'series')
    ]);
    return [...movies, ...series];
  }

  mergeItems(results) {
    const seen = new Set();
    const merged = [];
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      for (const item of result.value || []) {
        const key = `${item.type}:${item.nativeId}`;
        if (!item.nativeId || seen.has(key)) continue;
        seen.add(key);
        merged.push(item);
      }
    }
    return merged;
  }

  async listCatalog(kind, extra = {}) {
    const type = kind === 'series' ? 'series' : 'movie';
    if (extra.search) return (await this.searchType(extra.search, type)).map((item) => this.toMeta(item));

    const results = await Promise.allSettled(
      this.catalogIds(type).map((catalogId) => this.fetchCatalog(type, catalogId, extra))
    );
    return this.mergeItems(results).map((item) => this.toMeta(item));
  }

  async resolveStream({ title, year, type = 'movie', season = 1, episode = 1 } = {}) {
    const mediaType = type === 'series' ? 'series' : 'movie';
    const hits = await this.searchType(title, mediaType);
    const ranked = this.matchCandidates(hits, { title, year, type: mediaType, season });
    const targetYear = parseInt(year, 10);
    const yearMatch = targetYear
      ? hits.find((item) => item.year && Math.abs(parseInt(item.year, 10) - targetYear) <= 1)
      : null;
    const candidates = [...ranked];
    for (const fallback of [yearMatch, hits[0]]) {
      if (fallback && !candidates.some((item) => item.slug === fallback.slug)) candidates.push(fallback);
    }

    for (const candidate of candidates.slice(0, 3)) {
      const streams = await this.streamsFromSlug(candidate.slug, mediaType, season, episode);
      if (streams.length) return streams;
    }
    return [];
  }

  async detail(slug) {
    const native = decodeNativeId(slug);
    if (!native) return null;
    return cached(`k20:detail:${native.type}:${native.id}`, 60 * 60 * 1000, async () => {
      const data = await this.request(
        `${this.cfg.apiUrl}/meta/${native.type}/${encodeURIComponent(native.id)}.json`
      );
      const meta = data && data.meta;
      if (!meta) return null;

      const nativeVideos = Array.isArray(meta.videos) ? meta.videos : [];
      const videos = nativeVideos.map((video, index) => {
        const ep = episodeNumber(video, index);
        const season = parseInt(video.season, 10) || 1;
        return {
          id: `${this.prefix}${slug}:${season}:${ep}`,
          title: video.title || `Tập ${ep}`,
          season,
          episode: ep,
          released: video.released
        };
      });

      return {
        slug,
        nativeId: native.id,
        name: meta.name,
        originalName: meta.name,
        year: parseEpNum(meta.releaseInfo),
        type: native.type,
        quality: 'Auto',
        lang: '',
        poster: meta.poster,
        background: meta.background || meta.poster,
        description: meta.description || '',
        genres: meta.genres,
        runtime: meta.runtime,
        servers: [],
        videos: videos.length ? videos : undefined,
        nativeVideos
      };
    });
  }

  pickNativeVideo(detail, season, episode) {
    if (detail.type !== 'series' || !detail.nativeVideos.length) return detail.nativeId;
    const targetSeason = parseInt(season, 10) || 1;
    const targetEpisode = parseInt(episode, 10) || 1;

    let match = detail.nativeVideos.find((video, index) => {
      const videoSeason = parseInt(video.season, 10) || 1;
      return videoSeason === targetSeason && episodeNumber(video, index) === targetEpisode;
    });
    if (!match) {
      match = detail.nativeVideos.find((video, index) => episodeNumber(video, index) === targetEpisode);
    }
    if (!match && targetEpisode <= detail.nativeVideos.length) match = detail.nativeVideos[targetEpisode - 1];
    return match && match.id ? String(match.id) : null;
  }

  mapStream(stream, detail, episode) {
    if (!stream || !stream.url) return null;
    const label = `${stream.name || ''} ${stream.title || ''}`;
    const audio = detectAudio(label, 'Vietsub');
    const quality = qualityFromText(label, 'Auto');
    const behaviorHints = stream.behaviorHints ? { ...stream.behaviorHints } : { notWebReady: false };
    const mapped = {
      name: `K20\n${quality} · ${audio}`,
      title: stream.title || (detail.type === 'series' ? `Tập ${episode}` : detail.name),
      url: stream.url,
      behaviorHints,
      subtitles: Array.isArray(stream.subtitles) ? stream.subtitles : undefined
    };
    Object.defineProperty(mapped, '_providerId', { value: this.id, enumerable: false });
    return mapped;
  }

  async streamsFromSlug(slug, type, season, episode) {
    const detail = await this.detail(slug);
    if (!detail) return [];
    const nativeVideoId = this.pickNativeVideo(detail, season, episode);
    if (!nativeVideoId) return [];

    const data = await this.request(
      `${this.cfg.apiUrl}/stream/${detail.type}/${encodeURIComponent(nativeVideoId)}.json`
    );
    return ((data && data.streams) || [])
      .map((stream) => this.mapStream(stream, detail, episode))
      .filter(Boolean);
  }
}

module.exports = {
  K20Provider,
  K20_SOURCES,
  encodeNativeId,
  decodeNativeId,
  episodeNumber
};
