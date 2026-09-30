'use strict';

const http = require('http');
const { URL, URLSearchParams } = require('url');

const PORT = Number(process.env.PORT || 7000);
const CACHE_TTL = Math.max(300, Number(process.env.CACHE_TTL_SECONDS || 21600)) * 1000;
const MAX_RESULTS_PER_PROVIDER = Math.min(4, Math.max(1, Number(process.env.MAX_RESULTS_PER_PROVIDER || 2)));
const SEARCH_TIMEOUT_MS = Math.min(15000, Math.max(2500, Number(process.env.SEARCH_TIMEOUT_MS || 7000)));

// Official/public providers only. The addon discovers public pages and opens
// playback on the provider website/app. It never extracts DRM manifests,
// bypasses authentication, or proxies protected media.
const PROVIDERS = [
  { key: 'vtvgo',  name: 'VTV Go',   domain: 'vtvgo.vn',     badge: 'VTV' },
  { key: 'thvli',  name: 'THVLi',    domain: 'thvli.vn',     badge: 'THVL' },
  { key: 'htv',    name: 'HTV',      domain: 'htv.com.vn',   badge: 'HTV' },
  { key: 'tv360',  name: 'TV360',    domain: 'tv360.vn',     badge: 'TV360' },
  { key: 'vieon',  name: 'VieON',    domain: 'vieon.vn',     badge: 'VieON' },
  { key: 'fptplay',name: 'FPT Play', domain: 'fptplay.vn',   badge: 'FPT' }
];

const memoryCache = new Map();

function normalize(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function htmlDecode(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripTags(s) {
  return htmlDecode(String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

function getOrigin(req) {
  const protoHeader = req.headers['x-forwarded-proto'];
  const proto = protoHeader ? String(protoHeader).split(',')[0].trim() : 'http';
  const host = req.headers.host || `127.0.0.1:${PORT}`;
  return `${proto}://${host}`;
}

function sendJson(res, status, payload, cacheSeconds = 300) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Cache-Control': `public, max-age=${cacheSeconds}`
  });
  res.end(body);
}

function sendText(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=300'
  });
  res.end(body);
}

function manifest(req) {
  const origin = getOrigin(req);
  return {
    id: 'vn.minh.vietnam.sources.official',
    version: '0.2.0',
    name: 'Vietnam Sources • Official',
    description: 'Tìm nguồn phim/series Việt Nam trên các nền tảng chính thức và public: VTV Go, THVLi, HTV, TV360, VieON và FPT Play. Không trích DRM, không vượt đăng nhập.',
    logo: `${origin}/logo.svg`,
    resources: ['stream'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs: [],
    behaviorHints: {
      configurable: false,
      configurationRequired: false,
      adult: false,
      p2p: false
    }
  };
}

function parseStremioId(type, rawId) {
  const id = decodeURIComponent(String(rawId || ''));
  const parts = id.split(':');
  const imdbId = parts[0];
  let season = null, episode = null;
  if (type === 'series' && parts.length >= 3) {
    const a = Number(parts[parts.length - 2]);
    const b = Number(parts[parts.length - 1]);
    if (Number.isInteger(a) && Number.isInteger(b)) {
      season = a; episode = b;
    }
  }
  return { id, imdbId, season, episode };
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/126 Safari/537.36',
        'accept-language': 'vi-VN,vi;q=0.9,en;q=0.6',
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function getImdbFallback(imdbId) {
  const key = `imdb:${imdbId}`;
  const cached = memoryCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  try {
    const res = await fetchWithTimeout(`https://www.imdb.com/title/${encodeURIComponent(imdbId)}/reference/`, {
      headers: { 'accept': 'text/html,application/xhtml+xml' }
    });
    if (!res.ok) return null;
    const html = await res.text();
    const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
    let name = titleMatch ? stripTags(titleMatch[1]).replace(/\s*-\s*IMDb\s*$/i, '').trim() : '';
    let releaseInfo = '';
    const ld = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
    if (ld) {
      try {
        const obj = JSON.parse(htmlDecode(ld[1]));
        if (obj && obj.name) name = obj.name;
        const date = obj && (obj.datePublished || obj.dateCreated);
        if (date) releaseInfo = String(date).slice(0, 4);
      } catch (_) {}
    }
    const value = name ? { name, releaseInfo } : null;
    memoryCache.set(key, { expires: Date.now() + CACHE_TTL, value });
    return value;
  } catch (_) {
    return null;
  }
}

async function getCinemeta(type, imdbId) {
  if (!/^tt\d+$/.test(imdbId)) return null;
  const key = `meta:${type}:${imdbId}`;
  const cached = memoryCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  try {
    const url = `https://v3-cinemeta.strem.io/meta/${encodeURIComponent(type)}/${encodeURIComponent(imdbId)}.json`;
    const res = await fetchWithTimeout(url);
    if (res.ok) {
      const data = await res.json();
      const value = data && data.meta ? data.meta : null;
      if (value) {
        memoryCache.set(key, { expires: Date.now() + CACHE_TTL, value });
        return value;
      }
    }
  } catch (_) {}
  const fallback = await getImdbFallback(imdbId);
  memoryCache.set(key, { expires: Date.now() + CACHE_TTL, value: fallback });
  return fallback;
}

function buildLookup(meta, parsed) {
  const baseName = (meta && meta.name) || parsed.imdbId;
  const year = meta && (meta.releaseInfo || meta.year) ? String(meta.releaseInfo || meta.year).slice(0, 4) : '';
  let episodeTitle = '';
  if (parsed.season != null && parsed.episode != null && meta && Array.isArray(meta.videos)) {
    const video = meta.videos.find(v => Number(v.season) === parsed.season && Number(v.episode) === parsed.episode);
    episodeTitle = video && video.title ? String(video.title) : '';
  }
  const episodeText = parsed.episode != null ? `tập ${parsed.episode}` : '';
  return {
    title: baseName,
    year,
    season: parsed.season,
    episode: parsed.episode,
    episodeTitle,
    query: [baseName, episodeText, episodeTitle].filter(Boolean).join(' ')
  };
}

function unwrapDuckUrl(href) {
  try {
    const decoded = htmlDecode(href);
    const u = new URL(decoded, 'https://duckduckgo.com');
    const uddg = u.searchParams.get('uddg');
    return uddg ? decodeURIComponent(uddg) : u.href;
  } catch (_) {
    return htmlDecode(href);
  }
}

function isAllowedProviderUrl(url, domain) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  } catch (_) {
    return false;
  }
}

function scoreResult(item, lookup, provider) {
  const hay = normalize(`${item.title} ${item.snippet} ${item.url}`);
  const words = normalize(lookup.title).split(' ').filter(w => w.length >= 2);
  let score = 0;
  for (const w of words) if (hay.includes(w)) score += 2;
  if (lookup.episode != null && (hay.includes(`tap ${lookup.episode}`) || hay.includes(`episode ${lookup.episode}`))) score += 4;
  if (lookup.year && hay.includes(lookup.year)) score += 1;
  if (item.url.includes(provider.domain)) score += 3;
  return score;
}

async function searchProvider(provider, lookup) {
  const cacheKey = `search:${provider.key}:${normalize(lookup.query)}`;
  const cached = memoryCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value;

  const q = `site:${provider.domain} "${lookup.title}" ${lookup.episode != null ? `"tập ${lookup.episode}"` : ''}`.trim();
  const ddg = `https://html.duckduckgo.com/html/?${new URLSearchParams({ q }).toString()}`;
  let results = [];
  try {
    const res = await fetchWithTimeout(ddg);
    if (res.ok) {
      const html = await res.text();
      const blocks = html.split(/class="result\s/gi).slice(1, 16);
      for (const block of blocks) {
        const linkMatch = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
        if (!linkMatch) continue;
        const url = unwrapDuckUrl(linkMatch[1]);
        if (!isAllowedProviderUrl(url, provider.domain)) continue;
        const snipMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/i);
        const title = stripTags(linkMatch[2]);
        const snippet = snipMatch ? stripTags(snipMatch[1]) : '';
        results.push({ url, title, snippet });
      }
    }
  } catch (_) {
    results = [];
  }

  // De-duplicate and rank. We deliberately return only public provider page URLs.
  const seen = new Set();
  results = results
    .filter(r => r.url && !seen.has(r.url) && seen.add(r.url))
    .map(r => ({ ...r, score: scoreResult(r, lookup, provider) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS_PER_PROVIDER);

  memoryCache.set(cacheKey, { expires: Date.now() + CACHE_TTL, value: results });
  return results;
}

function fallbackDiscoveryUrl(provider, lookup) {
  const q = `site:${provider.domain} "${lookup.title}" ${lookup.episode != null ? `"tập ${lookup.episode}"` : ''}`.trim();
  return `https://www.google.com/search?${new URLSearchParams({ q }).toString()}`;
}

async function streamsFor(type, rawId) {
  const parsed = parseStremioId(type, rawId);
  if (!/^tt\d+$/.test(parsed.imdbId)) return [];
  const meta = await getCinemeta(type, parsed.imdbId);
  const lookup = buildLookup(meta, parsed);

  const settled = await Promise.all(PROVIDERS.map(async provider => {
    const items = await searchProvider(provider, lookup);
    return { provider, items };
  }));

  const streams = [];
  for (const { provider, items } of settled) {
    if (items.length) {
      for (const item of items) {
        streams.push({
          name: `${provider.badge} • Official`,
          description: `${item.title || lookup.title}${parsed.episode != null ? ` • Tập ${parsed.episode}` : ''}\nMở trên ${provider.name}`,
          externalUrl: item.url,
          behaviorHints: { bingeGroup: `vn-official-${provider.key}` }
        });
      }
    }
  }

  // If discovery found nothing at all, still expose safe site-restricted searches
  // so the user can see whether the official provider has an indexed page.
  if (!streams.length) {
    for (const provider of PROVIDERS) {
      streams.push({
        name: `${provider.badge} • Tìm nguồn`,
        description: `Tìm “${lookup.title}${parsed.episode != null ? ` tập ${parsed.episode}` : ''}” trên ${provider.name}`,
        externalUrl: fallbackDiscoveryUrl(provider, lookup)
      });
    }
  }

  // Public YouTube fallback. This is a search page, not a scraped stream.
  const ytQuery = `${lookup.title}${parsed.episode != null ? ` tập ${parsed.episode}` : ''} VTV Go HTV THVL`;
  streams.push({
    name: 'YouTube • Kênh chính thức',
    description: `Tìm bản phát hành chính thức cho ${lookup.title}${parsed.episode != null ? ` • Tập ${parsed.episode}` : ''}`,
    externalUrl: `https://www.youtube.com/results?${new URLSearchParams({ search_query: ytQuery }).toString()}`
  });

  return streams.slice(0, 18);
}

function rootHtml(req) {
  const origin = getOrigin(req);
  const manifestUrl = `${origin}/manifest.json`;
  const stremioUrl = `stremio://${manifestUrl.replace(/^https?:\/\//, '')}`;
  const providerList = PROVIDERS.map(p => `<li>${p.name} <small>(${p.domain})</small></li>`).join('');
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vietnam Sources • Official</title>
<style>body{font-family:system-ui,sans-serif;background:#0b1020;color:#eef2ff;max-width:820px;margin:36px auto;padding:0 20px;line-height:1.55}.card{background:#151b2f;border:1px solid #2b3555;border-radius:16px;padding:22px;margin:18px 0}.btn{display:inline-block;background:#2563eb;color:white;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700}a{color:#93c5fd}code{word-break:break-all}small{color:#a5b4fc}</style></head><body>
<h1>Vietnam Sources • Official <small>v0.2.0</small></h1>
<p>Add-on tự lấy tên phim/tập từ ID IMDb của Stremio rồi dò các trang phát hành chính thức/public tại Việt Nam.</p>
<div class="card"><a class="btn" href="${stremioUrl}">Cài vào Stremio</a><p>Manifest: <code>${manifestUrl}</code></p></div>
<div class="card"><b>Nguồn đang dò:</b><ul>${providerList}</ul></div>
<p><b>Giới hạn:</b> addon không trích xuất DRM, không vượt đăng nhập/gói thuê bao và không proxy video được bảo vệ. Với nguồn cần tài khoản, Stremio sẽ mở trang/app chính thức.</p>
</body></html>`;
}

const LOGO_SVG = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#0f172a"/><path d="M90 130h72l94 252h-72L90 130zm130 0h75l-35 95 34 93h-72l-45-120 43-68zm120 0h82l-92 252h-77l87-252z" fill="#fff"/><circle cx="402" cy="106" r="31" fill="#22c55e"/><text x="256" y="442" text-anchor="middle" font-family="Arial,sans-serif" font-size="52" font-weight="700" fill="#93c5fd">VN</text></svg>`;

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*'
    });
    return res.end();
  }

  const origin = getOrigin(req);
  const url = new URL(req.url, origin);
  const path = url.pathname;

  try {
    if (path === '/' || path === '/index.html') return sendText(res, 200, rootHtml(req), 'text/html; charset=utf-8');
    if (path === '/logo.svg') return sendText(res, 200, LOGO_SVG, 'image/svg+xml; charset=utf-8');
    if (path === '/manifest.json') return sendJson(res, 200, manifest(req), 600);
    if (path === '/health') return sendJson(res, 200, { ok: true, version: '0.2.0', providers: PROVIDERS.map(p => p.key) }, 0);

    const streamMatch = path.match(/^\/stream\/(movie|series)\/(.+)\.json$/);
    if (streamMatch) {
      const [, type, rawId] = streamMatch;
      const streams = await streamsFor(type, rawId);
      return sendJson(res, 200, { streams }, 300);
    }

    return sendJson(res, 404, { error: 'Not found' }, 0);
  } catch (err) {
    return sendJson(res, 200, { streams: [], error: String(err && err.message ? err.message : err) }, 0);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Vietnam Sources • Official v0.2.0 listening on http://0.0.0.0:${PORT}`);
});
