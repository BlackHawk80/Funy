'use strict';

const BaseProvider = require('./base');
const { cached, detectAudio, qualityFromText } = require('../utils');
const { encodeNativeId, decodeNativeId } = require('./k20');

// Official VNStream Stremio backend. No CoBePhim HTML scraping.
function episodeInfo(stream) {
  const label = String(stream.name || stream.title || '');
  const ep = label.match(/(?:tập|tap|episode|ep)\s*0*(\d+)/i);
  const season = label.match(/(?:season|mùa|phan|phần)\s*(\d+)/i);
  return ep ? { season: season ? Number(season[1]) : 1, episode: Number(ep[1]) } : null;
}

class VnstreamProvider extends BaseProvider {
  async request(url) {
    try {
      const response = await fetch(url, { headers: this.headers, signal: AbortSignal.timeout(25000) });
      if (!response.ok) {
        console.warn('[VNStream] upstream HTTP', response.status, new URL(url).pathname);
        return null;
      }
      return await response.json();
    } catch (error) {
      console.warn('[VNStream] request failed', error.name, error.cause?.code || '', new URL(url).pathname);
      return null;
    }
  }

  normalize(item, type) {
    return { ...item, type, nativeId: String(item.id), slug: encodeNativeId(type, item.id),
      originalName: String(item.description || '').split(' / ')[1] || item.name,
      year: parseInt(item.year || item.releaseInfo, 10) || undefined };
  }

  toMeta(item) {
    return { ...item, id: this.prefix + item.slug, releaseInfo: item.releaseInfo == null ? undefined : String(item.releaseInfo) };
  }

  async fetchCatalog(type, catalog, extra = {}) {
    const parts = [];
    for (const key of ['search', 'genre', 'skip']) {
      if (extra[key] !== undefined && extra[key] !== '') parts.push(`${key}=${encodeURIComponent(extra[key])}`);
    }
    const suffix = parts.length ? '/' + parts.join('&') : '';
    const data = await this.request(`${this.cfg.apiUrl}/catalog/${type}/${catalog}${suffix}.json`);
    return (data?.metas || []).filter(m => m.id).map(m => this.normalize(m, type));
  }

  async listCatalog(kind, extra = {}) {
    const type = kind === 'bo' || kind.startsWith('series-') ? 'series' : 'movie';
    const category = kind.replace(/^(movie|series)-/, '');
    const catalog = ['vietsub','voice-over','dubbed'].includes(category) ? `vnstream-${category}` : 'vnstream-top';
    const filters = kind === 'hanh-dong' ? { ...extra, genre: 'Hành Động' } : extra;
    const items = extra.search ? await this.searchType(extra.search, type) : await this.fetchCatalog(type, catalog, filters);
    return items.map(m => this.toMeta(m));
  }

  async searchType(query, type) {
    return await cached(`vnGuest:search:${type}:${query}`, 300000, () => this.fetchCatalog(type, 'vnstream-vietsub', { search: query })) || [];
  }

  async search(query) {
    return (await Promise.all(['movie','series'].map(t => this.searchType(query, t)))).flat();
  }

  async resolveStream(options) {
    const hits = await this.searchType(options.title, options.type === 'series' ? 'series' : 'movie');
    for (const item of this.matchCandidates(hits, options).slice(0, 3)) {
      const streams = await this.streamsFromSlug(item.slug, options.type, options.season, options.episode);
      if (streams.length) return streams;
    }
    return [];
  }

  async rawStreams(native) {
    return await cached(`vnGuest:streams:${native.type}:${native.id}`, 60000, async () => {
      const data = await this.request(`${this.cfg.apiUrl}/stream/${native.type}/${encodeURIComponent(native.id)}.json`);
      return (data?.streams || []).filter(s => /^https?:\/\//i.test(s.url || ''));
    }) || [];
  }

  async detail(slug) {
    const native = decodeNativeId(slug);
    if (!native) return null;
    const data = await this.request(`${this.cfg.apiUrl}/meta/${native.type}/${encodeURIComponent(native.id)}.json`);
    const meta = data?.meta;
    if (!meta) return null;
    let videos = [];
    if (native.type === 'series') {
      const streams = await this.rawStreams(native);
      const seen = new Set();
      for (const stream of streams) {
        const ep = episodeInfo(stream);
        if (!ep || seen.has(`${ep.season}:${ep.episode}`)) continue;
        seen.add(`${ep.season}:${ep.episode}`);
        videos.push({ id: `${this.prefix}${slug}:${ep.season}:${ep.episode}`, title: `Tập ${ep.episode}`, ...ep });
      }
      videos.sort((a,b) => a.season-b.season || a.episode-b.episode);
    }
    return { ...meta, slug, nativeId: native.id, type: native.type, time: meta.runtime, year: parseInt(meta.releaseInfo,10) || undefined, videos };
  }

  async streamsFromSlug(slug, type, season = 1, episode = 1) {
    // Legacy vn_<slug> catalog entries can still fetch their original title.
    const native = decodeNativeId(slug) || { type, id: slug };
    let streams = await this.rawStreams(native);
    if (native.type === 'series') streams = streams.filter(s => {
      const ep = episodeInfo(s);
      return ep && ep.season === Number(season) && ep.episode === Number(episode);
    });
    return streams.map(s => {
      const label = [s.name, s.description, s.title, s.behaviorHints?.filename].filter(Boolean).join(' ');
      const mapped = { ...s, name: `VNStream\n${qualityFromText(label, 'HD')} · ${detectAudio(label, 'Vietsub')}`,
        title: [s.name, s.description || s.title].filter(Boolean).join(' • ') };
      Object.defineProperty(mapped, '_providerId', { value: this.id, enumerable: false });
      return mapped;
    });
  }
}
module.exports = { VnstreamProvider, episodeInfo };
