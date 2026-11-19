'use strict';

const { CONFIG } = require('./config');

// ---------- HTTP ----------

async function fetchWithTimeout(url, opts = {}, timeoutMs = CONFIG.timeout) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { redirect: 'follow', ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function getJson(url, { headers = {}, timeout } = {}) {
  try {
    const res = await fetchWithTimeout(
      url,
      { headers: { 'User-Agent': CONFIG.userAgent, Accept: 'application/json, text/plain, */*', ...headers } },
      timeout || CONFIG.timeout
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function getText(url, { headers = {}, timeout } = {}) {
  try {
    const res = await fetchWithTimeout(
      url,
      { headers: { 'User-Agent': CONFIG.userAgent, ...headers } },
      timeout || CONFIG.timeout
    );
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// ---------- Chuẩn hoá tên phim ----------

// "Harry Potter và Hòn Đá Phù Thủy" -> "harry potter va hon da phu thuy"
function normTitle(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stripHtml(str) {
  if (!str) return '';
  return String(str).replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();
}

// "Tập 12" / "tap-12" / "Full" -> 12 / null
function parseEpNum(v) {
  const m = String(v == null ? '' : v).match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

// Nhận diện nhãn audio từ tên server / trường lang
function detectAudio(text, fallback = 'Vietsub') {
  const s = String(text || '').toLowerCase();
  if (!s) return fallback;
  if (/song\s*ng[ữu]/.test(s)) return 'Song Ngữ';
  if (/thuy[ếe]t\s*minh|\btm\b/.test(s)) return 'Thuyết Minh';
  if (/l[ồo]ng\s*ti[ếe]ng/.test(s)) return 'Lồng Tiếng';
  if (/vietsub|ph[ụu]\s*[dđ][êe]|\bvs\b/.test(s)) return 'Vietsub';
  return fallback;
}

function audioKey(audio) {
  return String(audio || 'vietsub')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function qualityFromText(text, fallback) {
  const s = String(text || '');
  if (/2160|4k/i.test(s)) return '4K';
  const m = s.match(/(\d{3,4})p/i);
  if (m) return `${m[1]}p`;
  return fallback;
}

function mapImageUrl(url, cdn) {
  if (!url || typeof url !== 'string') return undefined;
  const u = url.trim();
  if (!u) return undefined;
  if (u.startsWith('//')) return 'https:' + u;
  if (/^https?:\/\//i.test(u)) return u.replace(/^http:\/\//i, 'https://');
  if (u.startsWith('/')) return cdn ? `${cdn.replace(/\/+$/, '')}${u}` : undefined;
  return cdn ? `${cdn.replace(/\/+$/, '')}/${u}` : undefined;
}

// Link embed kiểu "https://player.../player/?url=https%3A%2F%2F....m3u8" -> m3u8
function extractUrlParam(embedUrl) {
  if (!embedUrl || typeof embedUrl !== 'string') return null;
  try {
    const u = new URL(embedUrl);
    for (const key of ['url', 'v', 'id']) {
      const v = u.searchParams.get(key);
      if (v && /^https?:\/\//i.test(v)) return v;
    }
  } catch { /* ignore */ }
  return null;
}

function m3u8FromText(text) {
  const m = String(text || '').match(/https?:\/\/[^\s"'<>\\]+?\.m3u8[^\s"'<>\\]*/i);
  return m ? m[0] : null;
}

// ---------- Cache in-memory với TTL ----------

const _cache = new Map();

function cached(key, ttlMs, fn) {
  const hit = _cache.get(key);
  const now = Date.now();
  if (hit && hit.exp > now) return Promise.resolve(hit.value);
  return Promise.resolve()
    .then(fn)
    .then((value) => {
      if (value !== null && value !== undefined) {
        if (_cache.size > 800) {
          for (const [k, v] of _cache) if (v.exp <= now) _cache.delete(k);
        }
        _cache.set(key, { value, exp: Date.now() + ttlMs });
      }
      return value;
    })
    .catch(() => null);
}


const _catalogCache = new Map();
const _catalogPending = new Map();

// Preserve only successful nonempty pages, scoped by the full request key.
// Stale data is bounded to one day and only used on upstream failure.
function cachedCatalog(key, fn, { ttl = 600000, staleTtl = 86400000 } = {}) {
  const hit = _catalogCache.get(key);
  if (hit && hit.exp > Date.now()) return Promise.resolve({ metas: hit.value, stale: false });
  if (_catalogPending.has(key)) return _catalogPending.get(key);
  const work = Promise.resolve().then(fn).then(value => {
    if (!Array.isArray(value)) throw new Error('Invalid catalog response');
    if (value.length) {
      _catalogCache.delete(key);
      _catalogCache.set(key, { value, exp: Date.now() + ttl, staleExp: Date.now() + staleTtl });
      while (_catalogCache.size > 200) _catalogCache.delete(_catalogCache.keys().next().value);
    } else {
      // A legitimate empty search/page must not resurrect an old matching page.
      _catalogCache.delete(key);
    }
    return { metas: value, stale: false };
  }).catch(error => {
    if (hit && hit.staleExp > Date.now()) return { metas: hit.value, stale: true };
    throw error;
  }).finally(() => _catalogPending.delete(key));
  _catalogPending.set(key, work);
  return work;
}

// Keep missing years last; do not mistake quality labels such as 1080p for years.
function catalogYear(item) {
  const max = new Date().getUTCFullYear() + 10;
  for (const value of [item.year, item.releaseInfo, item.released]) {
    const match = String(value || '').match(/\b(?:18|19|20|21)\d{2}\b/);
    if (match && Number(match[0]) <= max) return Number(match[0]);
  }
  return 0;
}

// Only release fields count. Upload/modified dates are never premiere dates.
function releaseDate(item) {
  for (const value of [item.released, item.release_date, item.releaseDate, item.first_air_date]) {
    const text = String(value || '').trim();
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
    const local = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!iso && !local) continue;
    const [year, month, day] = iso ? iso.slice(1).map(Number) : [Number(local[3]), Number(local[2]), Number(local[1])];
    const date = new Date(Date.UTC(year, month - 1, day));
    if (year < 1800 || year > new Date().getUTCFullYear() + 10 ||
        date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) continue;
    return date.toISOString().slice(0, 10);
  }
  return undefined;
}

function releaseOrder(item) {
  const date = releaseDate(item);
  // Missing month/day sort after known dates in the same year; not a fabricated premiere.
  return date ? Number(date.replace(/-/g, '')) : catalogYear(item) * 10000;
}

function sortCatalogNewest(items) {
  return [...(items || [])].sort((a, b) => releaseOrder(b) - releaseOrder(a));
}


function metadataNames(value) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return list.map(v => typeof v === 'string' ? stripHtml(v).trim() : stripHtml(v?.name || '').trim())
    .filter(v => v && !/^(đang cập nhật|n\/a|unknown)$/i.test(v));
}
function metadataRating(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= 10 ? String(n) : undefined;
}
const _richMeta = new Map();
const _richPending = new Map();
const RICH_FIELDS = ['description', 'genres', 'runtime', 'cast', 'director', 'country', 'imdbRating', 'imdb_id', 'released', 'releaseInfo', 'year', 'language'];
async function enrichCatalog(provider, type, items, budgetMs = 9000) {
  const output = items.map(item => ({ ...item }));
  const deadline = Date.now() + budgetMs;
  let index = 0, incomplete = false;
  function apply(target, meta) {
    for (const key of RICH_FIELDS) {
      const value = meta[key];
      if (value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length)) target[key] = value;
    }
  }
  async function worker() {
    while (index < output.length && Date.now() < deadline) {
      const target = output[index++];
      if (!String(target.id).startsWith(provider.prefix)) continue;
      const key = provider.id + ':' + type + ':' + target.id;
      const hit = _richMeta.get(key);
      if (hit && hit.exp > Date.now()) { apply(target, hit.meta); continue; }
      let pending = _richPending.get(key);
      if (!pending) {
        if (_richPending.size >= 12) { incomplete = true; continue; }
        pending = Promise.resolve().then(() => provider.detail(target.id.slice(provider.prefix.length), type))
          .then(detail => detail ? provider.buildMeta(detail, { withVideos: false }) : null)
          .then(meta => {
            if (meta) {
              _richMeta.set(key, { meta, exp: Date.now() + 3600000 });
              while (_richMeta.size > 500) _richMeta.delete(_richMeta.keys().next().value);
            }
            return meta;
          }).catch(() => null).finally(() => _richPending.delete(key));
        _richPending.set(key, pending);
      }
      let timer;
      const meta = await Promise.race([pending, new Promise(resolve => {
        timer = setTimeout(() => resolve(null), Math.max(1, deadline - Date.now()));
      })]);
      clearTimeout(timer);
      if (meta) apply(target, meta); else incomplete = true;
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));
  return { metas: output, incomplete: incomplete || index < output.length };
}

module.exports = {
  metadataNames,
  metadataRating,
  enrichCatalog,
  cachedCatalog,
  releaseDate,
  catalogYear,
  sortCatalogNewest,
  getJson,
  getText,
  normTitle,
  stripHtml,
  parseEpNum,
  detectAudio,
  audioKey,
  qualityFromText,
  mapImageUrl,
  extractUrlParam,
  m3u8FromText,
  cached
};
