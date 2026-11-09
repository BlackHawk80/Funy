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

module.exports = {
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
