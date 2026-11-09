'use strict';

const makeFetchCookie = require('fetch-cookie').default;
const { CookieJar } = require('tough-cookie');
const cheerio = require('cheerio');
const BaseProvider = require('./base');
const { CONFIG } = require('../config');
const { cached, detectAudio, parseEpNum, qualityFromText } = require('../utils');

function encodeSlug(slug) {
  return Buffer.from(String(slug || ''), 'utf8').toString('base64url');
}

function decodeSlug(value) {
  try {
    const slug = Buffer.from(String(value || ''), 'base64url').toString('utf8').trim();
    return slug && !slug.includes('\0') ? slug : null;
  } catch {
    return null;
  }
}

function cleanQuery(raw) {
  return String(raw || '')
    .replace(/\((19|20)\d{2}\)/g, '')
    .replace(/\b(19|20)\d{2}\b/g, '')
    .replace(/\b(season|ss|phần|tập)\s*\d+/gi, '')
    .replace(/[:\-–—_/,.?!#@+*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractCsrfToken(html) {
  const $ = cheerio.load(String(html || ''));
  return $('meta[name="csrf-token"]').attr('content') || $('input[name="_token"]').first().attr('value') || null;
}

function absoluteUrl(value, baseUrl) {
  if (!value) return undefined;
  try {
    return new URL(value, `${baseUrl}/`).href;
  } catch {
    return undefined;
  }
}

function parseSearchHtml(html, baseUrl) {
  const $ = cheerio.load(String(html || ''));
  const items = [];
  const seen = new Set();
  const ignored = [
    'danh-sach', 'the-loai', 'quoc-gia', 'login', 'register',
    'tu-phim', 'loc-phim', 'profile', 'shop', 'wheel',
    'nam', 'dao-dien', 'dien-vien'
  ];

  $('a.cd-card').each((_, element) => {
    const card = $(element);
    const href = card.attr('href') || '';
    if (!href) return;

    let slug = href;
    try {
      const url = new URL(href, `${baseUrl}/`);
      slug = url.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
    } catch {
      slug = href.replace(baseUrl, '').replace(/^\/+/, '').split('?')[0];
    }
    if (!slug || slug.includes('#') || ignored.some((prefix) => slug === prefix || slug.startsWith(`${prefix}/`))) return;

    const name = card.find('h3, .line-clamp-1, .line-clamp-2, p.font-semibold, p.text-sm').first().text().trim();
    if (!name) return;
    const poster = card.find('img').first().attr('src') || card.find('img').first().attr('data-src') || '';
    const badge = card.find('.absolute, span, .text-xs').map((__, node) => $(node).text().trim()).get().filter(Boolean).join(' · ');
    const key = slug.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    const yearMatch = `${name} ${badge}`.match(/\b(19\d{2}|20\d{2})\b/);
    items.push({
      nativeSlug: slug,
      slug: encodeSlug(slug),
      name,
      originalName: name,
      year: yearMatch ? parseInt(yearMatch[1], 10) : null,
      type: /tập|full/i.test(badge) || href.includes('phim-bo') || slug.includes('phim-bo') ? 'series' : 'movie',
      poster: absoluteUrl(poster, baseUrl),
      background: absoluteUrl(poster, baseUrl),
      description: badge
    });
  });
  return items;
}

function parseReleaseEpisode(name) {
  const text = String(name || '');
  let match = text.match(/\bS(\d+)E(\d+)\b/i);
  if (match) return { season: parseInt(match[1], 10) || 1, episode: parseInt(match[2], 10) || null };
  match = text.match(/[Tt]ập\s*(\d+)/i) || text.match(/\bE(\d+)\b/i);
  return { season: 1, episode: match ? parseInt(match[1], 10) || null : null };
}

function parseDetailHtml(html, slug, baseUrl) {
  const body = String(html || '');
  const $ = cheerio.load(body);
  const pageToken = extractCsrfToken(body);
  const title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || slug;
  const description = $('meta[name="description"]').attr('content') || $('p.line-clamp-3, .description').first().text().trim();
  const poster = absoluteUrl($('meta[property="og:image"]').attr('content') || $('img.poster, .cd-poster img').first().attr('src'), baseUrl);
  const yearMatch = title.match(/\b(19\d{2}|20\d{2})\b/) || body.match(/\/nam\/(\d{4})/);
  const genres = [];
  $('a[href*="/the-loai/"]').each((_, element) => {
    const genre = $(element).text().trim();
    if (genre && !genres.includes(genre)) genres.push(genre);
  });

  const releases = [];
  $('article.cd-release').each((_, element) => {
    const release = $(element);
    const name = release.find('p.cd-release__name').text().trim();
    const metaText = release.find('div.cd-release__meta').text().replace(/\s+/g, ' ').trim();
    const form = release.find('form[data-download-form], form[action*="/download-links/"]').first();
    const action = form.attr('action') || '';
    const idMatch = action.match(/\/download-links\/(\d+)\/access/);
    if (!idMatch) return;

    const episodeInfo = parseReleaseEpisode(name);
    releases.push({
      downloadLinkId: idMatch[1],
      name: name || metaText || `Release ${idMatch[1]}`,
      metaText,
      season: episodeInfo.season,
      episode: episodeInfo.episode,
      token: form.find('input[name="_token"]').first().attr('value') || pageToken || ''
    });
  });

  const isSeries = releases.some((release) => release.episode !== null) || slug.includes('phim-bo');
  const videos = [];
  const seenEpisodes = new Set();
  for (const release of releases) {
    if (release.episode === null) continue;
    const key = `${release.season}:${release.episode}`;
    if (seenEpisodes.has(key)) continue;
    seenEpisodes.add(key);
    videos.push({
      id: `x20_${encodeSlug(slug)}:${release.season}:${release.episode}`,
      title: `Tập ${release.episode}`,
      season: release.season,
      episode: release.episode,
      released: new Date().toISOString()
    });
  }
  videos.sort((a, b) => a.season - b.season || a.episode - b.episode);

  return {
    slug: encodeSlug(slug),
    nativeSlug: slug,
    name: title,
    originalName: title,
    year: yearMatch ? parseInt(yearMatch[1], 10) : null,
    type: isSeries ? 'series' : 'movie',
    quality: 'Auto',
    lang: '',
    poster,
    background: poster,
    description: description || '',
    genres,
    servers: [],
    videos: videos.length ? videos : undefined,
    releases,
    csrfToken: pageToken
  };
}

function extractTicketHash(location, body) {
  const match = `${location || ''}\n${body || ''}`.match(/\/x\/([a-f0-9]{32,64})/i);
  return match ? match[1] : null;
}

class Xem20Provider extends BaseProvider {
  constructor(cfg, options = {}) {
    super(cfg);
    this.jar = options.jar || new CookieJar();
    const fetchImpl = options.fetch || globalThis.fetch;
    this.fetch = options.wrappedFetch || makeFetchCookie(fetchImpl, this.jar);
    this.loggedIn = false;
    this.csrfToken = null;
    this.loginPromise = null;
  }

  get headers() {
    return {
      'User-Agent': CONFIG.userAgent,
      Referer: this.cfg.referer,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
    };
  }

  async requestRaw(url, options = {}, timeout = CONFIG.timeout) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      return await this.fetch(url, {
        redirect: 'follow',
        ...options,
        headers: { ...this.headers, ...(options.headers || {}) },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async requestText(url, options = {}, timeout = CONFIG.timeout) {
    const response = await this.requestRaw(url, options, timeout);
    return { response, text: await response.text() };
  }

  async ensureLoggedIn(force = false) {
    if (!this.cfg.login || !this.cfg.password) return false;
    if (force) {
      this.loggedIn = false;
      this.csrfToken = null;
      await this.jar.removeAllCookies();
    }
    if (this.loggedIn && this.csrfToken) return true;
    if (this.loginPromise) return this.loginPromise;
    this.loginPromise = this.login().finally(() => {
      this.loginPromise = null;
    });
    return this.loginPromise;
  }

  async login() {
    const loginPage = await this.requestText(`${this.cfg.apiUrl}/login`, {}, this.cfg.authTimeout || 12000);
    const token = extractCsrfToken(loginPage.text);
    if (!token) throw new Error('Xem20 login page did not contain a CSRF token');

    const params = new URLSearchParams({
      _token: token,
      login: this.cfg.login,
      password: this.cfg.password,
      remember: 'on'
    });
    const result = await this.requestText(`${this.cfg.apiUrl}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: this.cfg.apiUrl,
        Referer: `${this.cfg.apiUrl}/login`
      },
      body: params.toString()
    }, this.cfg.authTimeout || 12000);

    const stillOnLogin = new URL(result.response.url || `${this.cfg.apiUrl}/login`).pathname === '/login' &&
      /name=["']password["']/.test(result.text);
    if (!result.response.ok || stillOnLogin) throw new Error('Xem20 login failed; check XEM20_LOGIN and XEM20_PASSWORD');

    this.csrfToken = extractCsrfToken(result.text) || token;
    this.loggedIn = true;
    return true;
  }

  toMeta(item) {
    return {
      id: `${this.prefix}${item.slug}`,
      type: item.type,
      name: item.name,
      poster: item.poster,
      posterShape: 'poster',
      background: item.background || item.poster,
      description: item.description,
      releaseInfo: item.year ? String(item.year) : undefined,
      year: item.year || undefined
    };
  }

  async search(query) {
    const clean = cleanQuery(query);
    if (!clean || !(await this.ensureLoggedIn())) return [];
    return (await cached(`x20:search:${clean.toLowerCase()}`, 30 * 60 * 1000, async () => {
      const searchUrl = `${this.cfg.apiUrl}/tim-kiem?keyword=${encodeURIComponent(clean.toLowerCase())}`;
      const result = await this.requestText(
        searchUrl,
        {},
        this.cfg.searchTimeout || 8000
      );
      if (new URL(result.response.url || searchUrl).pathname === '/login') {
        if (!(await this.ensureLoggedIn(true))) return [];
        const retry = await this.requestText(
          searchUrl,
          {},
          this.cfg.searchTimeout || 8000
        );
        return parseSearchHtml(retry.text, this.cfg.apiUrl);
      }
      return parseSearchHtml(result.text, this.cfg.apiUrl);
    })) || [];
  }

  async resolveStream({ title, year, type = 'movie', season = 1, episode = 1 } = {}) {
    const hits = await this.search(title);
    const ranked = this.matchCandidates(hits, { title, year, type, season });
    const targetYear = parseInt(year, 10);
    const yearMatch = targetYear
      ? hits.find((item) => item.year && Math.abs(parseInt(item.year, 10) - targetYear) <= 1)
      : null;
    const candidates = [...ranked];
    for (const fallback of [yearMatch, hits[0]]) {
      if (fallback && !candidates.some((item) => item.slug === fallback.slug)) candidates.push(fallback);
    }
    for (const candidate of candidates.slice(0, 3)) {
      const streams = await this.streamsFromSlug(candidate.slug, type, season, episode);
      if (streams.length) return streams;
    }
    return [];
  }

  async fetchDetail(nativeSlug, retryAuth = true) {
    if (!(await this.ensureLoggedIn())) return null;
    const safePath = nativeSlug.split('/').map(encodeURIComponent).join('/');
    const detailUrl = `${this.cfg.apiUrl}/${safePath}`;
    const result = await this.requestText(detailUrl, {}, this.cfg.detailTimeout || 10000);
    const gated = new URL(result.response.url || detailUrl).pathname === '/login' ||
      /Đăng nhập để tải/i.test(cheerio.load(result.text)('a[href*="/login"]').text());
    if (gated && retryAuth) {
      await this.ensureLoggedIn(true);
      return this.fetchDetail(nativeSlug, false);
    }
    if (!result.response.ok || gated) return null;
    const detail = parseDetailHtml(result.text, nativeSlug, this.cfg.apiUrl);
    if (detail.csrfToken) this.csrfToken = detail.csrfToken;
    return detail;
  }

  async detail(slug) {
    const nativeSlug = decodeSlug(slug);
    if (!nativeSlug) return null;
    return (await cached(`x20:detail:${nativeSlug}`, 30 * 60 * 1000, () => this.fetchDetail(nativeSlug))) || null;
  }

  pickReleases(detail, type, season, episode) {
    if (type !== 'series' && detail.type !== 'series') return detail.releases.filter((release) => release.episode === null);
    const targetSeason = parseInt(season, 10) || 1;
    const targetEpisode = parseInt(episode, 10) || 1;
    let releases = detail.releases.filter((release) => release.season === targetSeason && release.episode === targetEpisode);
    if (!releases.length) releases = detail.releases.filter((release) => release.episode === targetEpisode);
    return releases;
  }

  async accessRelease(detail, release, retryAuth = true) {
    const token = release.token || detail.csrfToken || this.csrfToken || '';
    const safePath = detail.nativeSlug.split('/').map(encodeURIComponent).join('/');
    const params = new URLSearchParams({ _token: token });
    const result = await this.requestText(
      `${this.cfg.apiUrl}/download-links/${release.downloadLinkId}/access`,
      {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: this.cfg.apiUrl,
          Referer: `${this.cfg.apiUrl}/${safePath}`
        },
        body: params.toString()
      },
      this.cfg.streamTimeout || 12000
    );

    const location = result.response.headers.get('location') || '';
    const hash = extractTicketHash(location, result.text);
    if (hash) return `https://dl.downfshare.top/x/${hash}/play`;

    const authFailed = [401, 419].includes(result.response.status) || /\/login(?:\?|$)/.test(location);
    if (authFailed && retryAuth) {
      await this.ensureLoggedIn(true);
      const refreshed = await this.fetchDetail(detail.nativeSlug, false);
      if (!refreshed) return null;
      const updated = refreshed.releases.find((item) => item.downloadLinkId === release.downloadLinkId) ||
        refreshed.releases.find((item) => item.name === release.name);
      return updated ? this.accessRelease(refreshed, updated, false) : null;
    }
    return null;
  }

  async streamsFromSlug(slug, type, season, episode) {
    const detail = await this.detail(slug);
    if (!detail) return [];
    const releases = this.pickReleases(detail, type, season, episode);
    const results = await Promise.allSettled(releases.map(async (release) => {
      const url = await cached(`x20:stream:${release.downloadLinkId}`, 2 * 60 * 60 * 1000, () =>
        this.accessRelease(detail, release)
      );
      if (!url) return null;
      const audio = detectAudio(`${release.name} ${release.metaText}`, 'Vietsub');
      const quality = qualityFromText(`${release.name} ${release.metaText}`, 'Auto');
      const stream = this.makeStream({
        movieName: detail.name,
        epLabel: detail.type === 'series' ? `Tập ${release.episode || episode}` : release.name || 'Full',
        audio,
        quality,
        url,
        headers: { 'User-Agent': CONFIG.userAgent, Referer: `${this.cfg.apiUrl}/` }
      });
      stream.behaviorHints.notWebReady = true;
      stream.behaviorHints.bingeGroup = `xem20-${detail.nativeSlug}-${release.season}-${release.episode || 'movie'}`;
      return stream;
    }));
    return results.filter((result) => result.status === 'fulfilled' && result.value).map((result) => result.value);
  }
}

module.exports = {
  Xem20Provider,
  encodeSlug,
  decodeSlug,
  cleanQuery,
  extractCsrfToken,
  parseSearchHtml,
  parseReleaseEpisode,
  parseDetailHtml,
  extractTicketHash
};
