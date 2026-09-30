'use strict';

const http = require('http');
const { URL, URLSearchParams } = require('url');

const PORT = Number(process.env.PORT || 10000);
const AIOMETA_BASE = String(process.env.AIOMETA_BASE || '')
  .replace(/\/manifest\.json\/?$/i, '')
  .replace(/\/$/, '');

const PROVIDERS = [
  { name: 'VTV Go', domain: 'vtvgo.vn', badge: 'VTV' },
  { name: 'VTV', domain: 'vtv.vn', badge: 'VTV' },
  { name: 'THVLi', domain: 'thvli.vn', badge: 'THVL' },
  { name: 'HTV', domain: 'htv.com.vn', badge: 'HTV' },
  { name: 'TV360', domain: 'tv360.vn', badge: 'TV360' },
  { name: 'VieON', domain: 'vieon.vn', badge: 'VieON' },
  { name: 'FPT Play', domain: 'fptplay.vn', badge: 'FPT' }
];

const manifest = {
  id: 'vn.minh.vietnam.sources.official',
  version: '0.3.0',
  name: 'Vietnam Sources • Official',
  description:
    'Tìm nguồn phim/series Việt Nam trên các nền tảng chính thức/public. ' +
    'Hỗ trợ IMDb, TMDB, TVDB và TVMaze ID.',
  resources: ['stream'],
  types: ['movie', 'series'],
  idPrefixes: [
    'tt',
    'imdb:',
    'tmdb:',
    'tvdb:',
    'tvmaze:',
    'mal:',
    'kitsu:',
    'anidb:',
    'anilist:'
  ],
  catalogs: [],
  behaviorHints: {
    configurable: false,
    configurationRequired: false,
    adult: false,
    p2p: false
  }
};

function sendJson(res, status, payload, maxAge = 120) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'cache-control': `public, max-age=${maxAge}`
  });
  res.end(JSON.stringify(payload));
}

function parseStremioId(type, rawId) {
  const id = decodeURIComponent(String(rawId || ''));
  const parts = id.split(':');
  let baseId = id;
  let season = null;
  let episode = null;

  if (type === 'series' && parts.length >= 3) {
    const maybeSeason = Number(parts[parts.length - 2]);
    const maybeEpisode = Number(parts[parts.length - 1]);
    if (Number.isInteger(maybeSeason) && Number.isInteger(maybeEpisode)) {
      season = maybeSeason;
      episode = maybeEpisode;
      baseId = parts.slice(0, -2).join(':');
    }
  }

  return { id, baseId, season, episode };
}

async function fetchJson(url, timeoutMs = 2500) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      headers: {
        accept: 'application/json',
        'user-agent':
          'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/126 Safari/537.36'
      }
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveMeta(type, baseId) {
  // First use the same configured AIOMetadata source as Stremio.
  if (AIOMETA_BASE) {
    const u =
      `${AIOMETA_BASE}/meta/${encodeURIComponent(type)}/` +
      `${encodeURIComponent(baseId)}.json`;
    const j = await fetchJson(u);
    if (j && j.meta) return j.meta;
  }

  // Fallback for IMDb IDs.
  if (/^tt\d+$/.test(baseId)) {
    const u =
      `https://v3-cinemeta.strem.io/meta/${encodeURIComponent(type)}/` +
      `${encodeURIComponent(baseId)}.json`;
    const j = await fetchJson(u);
    if (j && j.meta) return j.meta;
  }

  return null;
}

function getEpisodeTitle(meta, season, episode) {
  if (!meta || !Array.isArray(meta.videos)) return '';
  const v = meta.videos.find(
    x => Number(x.season) === season && Number(x.episode) === episode
  );
  return v && v.title ? String(v.title) : '';
}

function providerSearchUrl(domain, title, season, episode, episodeTitle) {
  const bits = [`site:${domain}`, `"${title}"`];
  if (episode != null) bits.push(`"tập ${episode}"`);
  if (episodeTitle) bits.push(`"${episodeTitle}"`);
  const q = bits.join(' ');
  return `https://www.google.com/search?${new URLSearchParams({ q }).toString()}`;
}

async function streamsFor(type, rawId) {
  const parsed = parseStremioId(type, rawId);
  const meta = await resolveMeta(type, parsed.baseId);

  const title = meta && meta.name ? String(meta.name) : parsed.baseId;
  const episodeTitle = getEpisodeTitle(
    meta,
    parsed.season,
    parsed.episode
  );

  const suffix =
    parsed.episode != null
      ? ` • S${String(parsed.season ?? 1).padStart(2, '0')}E${String(parsed.episode).padStart(2, '0')}`
      : '';

  const streams = PROVIDERS.map(p => ({
    name: `${p.badge} • Tìm nguồn`,
    description:
      `${title}${suffix}` +
      (episodeTitle ? ` • ${episodeTitle}` : '') +
      `\nTìm trên ${p.name}`,
    externalUrl: providerSearchUrl(
      p.domain,
      title,
      parsed.season,
      parsed.episode,
      episodeTitle
    )
  }));

  const ytQuery = [
    title,
    parsed.episode != null ? `tập ${parsed.episode}` : '',
    episodeTitle,
    'VTV Go VTV Giải Trí HTV THVL'
  ].filter(Boolean).join(' ');

  streams.push({
    name: 'YouTube • Chính thức',
    description:
      `Tìm bản phát hành chính thức của ${title}` +
      (parsed.episode != null ? ` • Tập ${parsed.episode}` : ''),
    externalUrl:
      `https://www.youtube.com/results?` +
      new URLSearchParams({ search_query: ytQuery }).toString()
  });

  console.log(
    `[stream] type=${type} id=${parsed.id} base=${parsed.baseId} ` +
    `title="${title}" results=${streams.length}`
  );

  return streams;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*'
    });
    return res.end();
  }

  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (u.pathname === '/manifest.json') {
    return sendJson(res, 200, manifest, 300);
  }

  if (u.pathname === '/' || u.pathname === '/health') {
    return sendJson(res, 200, {
      ok: true,
      version: manifest.version,
      aiometaConfigured: Boolean(AIOMETA_BASE),
      idPrefixes: manifest.idPrefixes
    }, 0);
  }

  const m = u.pathname.match(/^\/stream\/(movie|series)\/(.+)\.json$/);
  if (m) {
    const streams = await streamsFor(m[1], m[2]);
    return sendJson(res, 200, { streams }, 60);
  }

  return sendJson(res, 404, { error: 'not_found' }, 0);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    `Vietnam Sources • Official v${manifest.version} listening on 0.0.0.0:${PORT}`
  );
});
