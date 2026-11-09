'use strict';

const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const { CONFIG, PROVIDERS } = require('./config');
const cinemeta = require('./cinemeta');
const { cached, getJson } = require('./utils');
const { router: hlsRouter, getBaseUrl, b64e } = require('./hls-proxy');
const { buildManifest, enabledProviders } = require('./manifest');

// ---------- Khởi tạo provider ----------
const CTORS = {
  kkphim: 'KKphimProvider',
  ophim: 'OphimProvider',
  nguonc: 'NguoncProvider',
  vnstream: 'VnstreamProvider',
  phim4k: 'Phim4kProvider',
  tophim: 'TophimProvider',
  k20: 'K20Provider',
  xem20: 'Xem20Provider'
};

const providers = {};
for (const cfg of enabledProviders()) {
  try {
    const mod = require(`./providers/${cfg.id}`);
    providers[cfg.id] = new mod[CTORS[cfg.id]](cfg);
  } catch (e) {
    console.warn(`[init] Không tải được nguồn ${cfg.id}:`, e.message);
  }
}

const router = express.Router();
router.use(hlsRouter);

// ---------- Helpers ----------

function parseId(id) {
  const parts = String(id).split(':').filter(Boolean);
  const head = parts[0] || '';
  if (/^tt\d+/.test(head)) {
    return { imdbId: head, season: parseInt(parts[1], 10) || 1, episode: parseInt(parts[2], 10) || 1 };
  }
  for (const p of Object.values(providers)) {
    if (head.startsWith(p.prefix)) {
      return { provider: p, slug: head.slice(p.prefix.length), season: parseInt(parts[1], 10) || 1, episode: parseInt(parts[2], 10) || 1 };
    }
  }
  return null;
}

// extra dạng "genre=Hành Động&skip=20" (phần path, có thể đuôi .json)
function parseExtra(str) {
  const extra = {};
  String(str || '')
    .replace(/\.json$/i, '')
    .split('&')
    .filter(Boolean)
    .forEach((pair) => {
      const idx = pair.indexOf('=');
      if (idx < 0) return;
      const k = decodeURIComponent(pair.slice(0, idx));
      const v = decodeURIComponent(pair.slice(idx + 1));
      if (['search', 'genre', 'skip'].includes(k)) extra[k] = v;
    });
  return extra;
}

function shouldProxy(providerId) {
  const cfg = PROVIDERS[providerId];
  if (!cfg || !cfg.proxy) return false;
  const list = CONFIG.proxyProviders;
  if (list.includes('none')) return false;
  return list.includes('*') || list.includes(providerId);
}

function wrapProxy(stream, baseUrl) {
  const pid = stream._providerId;
  if (stream.url && shouldProxy(pid)) {
    const h = (stream.behaviorHints && stream.behaviorHints.proxyHeaders && stream.behaviorHints.proxyHeaders.request) || {};
    stream.url = `${baseUrl}/hls/manifest.m3u8?url=${b64e(stream.url)}&ref=${b64e(h.Referer || '')}&origin=${b64e(h.Origin || '')}`;
  }
  return stream;
}

function dedupe(streams) {
  const seen = new Set();
  return streams.filter((s) => {
    const k = s.url || s.externalUrl;
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------- Routes ----------

router.get('/manifest.json', (req, res) => {
  res.json(buildManifest(getBaseUrl(req)));
});

router.get('/logo.svg', (req, res) => {
  res.type('image/svg+xml').send(
    `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ff4d4d"/><stop offset="1" stop-color="#ffb347"/>
      </linearGradient></defs>
      <rect width="256" height="256" rx="52" fill="#12141c"/>
      <circle cx="128" cy="128" r="74" fill="url(#g)"/>
      <path d="M108 92 L172 128 L108 164 Z" fill="#12141c"/>
    </svg>`
  );
});

// ---------- Host plugin Nuvio trên chính server này ----------
// (tránh phụ thuộc raw.githubusercontent.com — hay bị chặn ở Việt Nam)
const PLUGIN_DIR = path.join(__dirname, '..', 'nuvio-plugin');

router.get('/nuvio-plugin/manifest.json', (req, res) => {
  const base = getBaseUrl(req);
  try {
    const m = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, 'manifest.json'), 'utf8'));
    (m.scrapers || []).forEach((s) => {
      if (s.logo) s.logo = `${base}/nuvio-plugin/logo.svg`;
    });
    res.json(m);
  } catch (e) {
    res.status(500).json({ err: 'plugin manifest missing' });
  }
});

router.use('/nuvio-plugin', express.static(PLUGIN_DIR));

router.get('/', (req, res) => {
  const base = getBaseUrl(req);
  const rows = Object.values(providers)
    .map((p) => `<li><b>${p.name}</b> <code>${p.cfg.apiUrl}</code>${p.cfg.proxy ? ' (qua proxy)' : ''}</li>`)
    .join('');
  res.type('html').send(
    `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>VietStream Addon</title>
     <style>body{font-family:system-ui;background:#12141c;color:#eee;max-width:680px;margin:48px auto;padding:0 16px}
     a{color:#ffb347}code{background:#1e2230;padding:2px 6px;border-radius:6px}</style></head><body>
     <h1>🎬 VietStream — Addon phim Việt cho Nuvio / Stremio</h1>
     <p>Cài addon bằng manifest URL:</p>
     <p><code>${base}/manifest.json</code></p>
     <h3>Nguồn đang bật</h3><ul>${rows}</ul>
     <p>Nguồn khác (đã tắt hoặc chết sẽ tự bỏ qua, không ảnh hưởng addon).</p>
     </body></html>`
  );
});

// /stream/movie/tt123.json hoặc /stream/series/tt123:1:2.json
router.get('/stream/:type/:id.json', async (req, res) => {
  const type = req.params.type === 'series' ? 'series' : 'movie';
  const parsed = parseId(req.params.id);
  const base = getBaseUrl(req);
  let streams = [];
  try {
    if (parsed && parsed.provider) {
      // ID có prefix nguồn (kk_..., nc_...) -> lấy trực tiếp, không cần Cinemeta
      streams = await parsed.provider.streamsFromSlug(parsed.slug, type, parsed.season, parsed.episode);
    } else if (parsed) {
      // IMDb ID -> tra tên phim từ Cinemeta rồi hỏi từng nguồn
      const meta = await cinemeta.getMeta(type, parsed.imdbId);
      if (meta) {
        const results = await Promise.allSettled(
          Object.values(providers).map((p) =>
            p.resolveStream({
              imdbId: parsed.imdbId,
              title: meta.name,
              year: meta.year,
              type,
              season: parsed.season,
              episode: parsed.episode
            })
          )
        );
        for (const r of results) {
          if (r.status === 'fulfilled' && Array.isArray(r.value)) streams.push(...r.value);
        }
      }
    }
  } catch (e) {
    console.warn('[stream] lỗi:', e.message);
  }
  streams = dedupe(streams.map((s) => wrapProxy(s, base)));
  res.json({ streams, cacheMaxAge: 600 });
});

// /catalog/movie/kkphim-phim-le.json và /catalog/movie/kkphim-phim-le/genre=X&skip=20.json
router.get('/catalog/:type/:id.json', (req, res, next) => {
  req._catalogId = req.params.id;
  req._extra = { ...req.query };
  next();
}, catalogSend);

router.get('/catalog/:type/:id/:extra', (req, res) => {
  req._catalogId = req.params.id;
  const fromPath = parseExtra(req.params.extra);
  req._extra = { ...req.query, ...fromPath };
  catalogSend(req, res);
});

async function catalogSend(req, res) {
  const type = req.params.type === 'series' ? 'series' : 'movie';
  const catalogId = String(req._catalogId || '').replace(/\.json$/i, '');
  const dash = catalogId.indexOf('-');
  const providerId = dash > 0 ? catalogId.slice(0, dash) : catalogId;
  const kind = dash > 0 ? catalogId.slice(dash + 1) : '';
  const p = providers[providerId];
  if (!p) return res.json({ metas: [] });

  const extra = req._extra || {};
  if (process.env.DEBUG) console.log('[catalog]', providerId, kind, JSON.stringify(extra));
  const key = `cat:${providerId}:${kind}:${type}:${extra.search || ''}|${extra.genre || ''}|${extra.skip || 0}`;
  const metas = await cached(key, 10 * 60 * 1000, () => p.listCatalog(kind, extra));
  const filtered = (metas || [])
    .filter((m) => m && m.id)
    .filter((m) => !m.type || m.type === type);
  if (process.env.DEBUG) console.log('[catalog] raw:', (metas || []).length, '-> filtered:', filtered.length);
  res.json({ metas: filtered, cacheMaxAge: 600 });
}

// /meta/series/kk_slug.json
router.get('/meta/:type/:id.json', async (req, res) => {
  const type = req.params.type === 'series' ? 'series' : 'movie';
  const parsed = parseId(req.params.id);
  if (!parsed) return res.status(404).json({ err: 'not found' });

  if (parsed.provider) {
    const d = await cached(`meta:${parsed.provider.id}:${parsed.slug}`, 30 * 60 * 1000, () =>
      parsed.provider.detail(parsed.slug)
    );
    if (!d) return res.status(404).json({ err: 'not found' });
    const meta = parsed.provider.buildMeta(d, { withVideos: true });
    if (meta) meta.type = type === 'series' || d.type === 'series' ? 'series' : 'movie';
    return res.json({ meta, cacheMaxAge: 1800 });
  }

  // IMDb ID -> trả nguyên meta Cinemeta (dùng khi app chưa có Cinemeta)
  const raw = await cached(`cinemetaRaw:${type}:${parsed.imdbId}`, 6 * 3600 * 1000, () =>
    getJson(`${CONFIG.cinemetaUrl}/meta/${type}/${parsed.imdbId}.json`)
  );
  if (raw && raw.meta) return res.json({ meta: raw.meta, cacheMaxAge: 1800 });
  res.status(404).json({ err: 'not found' });
});

module.exports = router;
