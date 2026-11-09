'use strict';

const express = require('express');
const { Readable } = require('node:stream');
const { CONFIG } = require('./config');

// HLS proxy gọn nhẹ: bọc m3u8 + segment, gắn thêm User-Agent / Referer / Origin
// cho những nguồn chặn referer (VD link StreamC của NguonC).
//   /hls/manifest.m3u8?url=<b64>&ref=<b64>&origin=<b64>
//   /hls/seg?url=<b64>&ref=<b64>&origin=<b64>

const router = express.Router();

function b64e(s) {
  return Buffer.from(String(s == null ? '' : s)).toString('base64url');
}

function b64d(s) {
  try {
    return Buffer.from(String(s || ''), 'base64url').toString('utf8');
  } catch {
    return '';
  }
}

function getBaseUrl(req) {
  if (process.env.PROXY_URL) return process.env.PROXY_URL.replace(/\/+$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host') || `localhost:${CONFIG.port}`;
  return `${proto}://${host}`;
}

function upstreamHeaders(ref, origin, range) {
  const h = { 'User-Agent': CONFIG.userAgent, Accept: '*/*' };
  if (ref) h.Referer = ref;
  if (origin) h.Origin = origin;
  if (range) h.Range = range;
  return h;
}

function proxify(base, target, ref, origin, isManifest) {
  return `${base}/hls/${isManifest ? 'manifest.m3u8' : 'seg'}?url=${b64e(target)}&ref=${b64e(ref)}&origin=${b64e(origin)}`;
}

function resolveUrl(base, u) {
  try {
    return new URL(u, base).href;
  } catch {
    return null;
  }
}

// Chỉnh sửa playlist: mọi URI con (segment/key/variant) đều trỏ về proxy
function rewriteM3u8(text, targetUrl, ref, origin, base) {
  return text
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (m, uri) => {
          const abs = resolveUrl(targetUrl, uri);
          return abs ? `URI="${proxify(base, abs, ref, origin, /\.m3u8(\?|$)/i.test(uri))}"` : m;
        });
      }
      const abs = resolveUrl(targetUrl, t);
      if (!abs) return line;
      return proxify(base, abs, ref, origin, /\.m3u8(\?|$)/i.test(t));
    })
    .join('\n');
}

router.get('/hls/manifest.m3u8', async (req, res) => {
  const base = getBaseUrl(req);
  const target = b64d(req.query.url);
  const ref = b64d(req.query.ref);
  const origin = b64d(req.query.origin);
  if (!/^https?:/i.test(target)) return res.status(400).send('bad url');
  try {
    const up = await fetch(target, { headers: upstreamHeaders(ref, origin, req.headers.range), redirect: 'follow' });
    const ct = up.headers.get('content-type') || '';
    const text = await up.text();
    if (!text.trim().startsWith('#EXTM3U')) {
      // upstream trả về thứ không phải playlist -> trả nguyên bản
      res.status(up.status);
      if (ct) res.set('Content-Type', ct);
      return res.send(text);
    }
    res.set('Content-Type', 'application/vnd.apple.mpegurl');
    res.set('Cache-Control', 'no-cache');
    res.send(rewriteM3u8(text, up.url || target, ref, origin, base));
  } catch {
    res.status(502).send('upstream error');
  }
});

router.get('/hls/seg', async (req, res) => {
  const base = getBaseUrl(req);
  const target = b64d(req.query.url);
  const ref = b64d(req.query.ref);
  const origin = b64d(req.query.origin);
  if (!/^https?:/i.test(target)) return res.status(400).send('bad url');
  try {
    const up = await fetch(target, { headers: upstreamHeaders(ref, origin, req.headers.range), redirect: 'follow' });
    const ct = up.headers.get('content-type') || '';
    if (/mpegurl/i.test(ct) || /\.m3u8(\?|$)/i.test(target)) {
      // playlist biến thể lọt vào seg -> rewrite luôn
      const text = await up.text();
      res.set('Content-Type', 'application/vnd.apple.mpegurl');
      return res.send(rewriteM3u8(text, up.url || target, ref, origin, base));
    }
    res.status(up.status);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const v = up.headers.get(h);
      if (v) res.set(h, v);
    }
    res.set('Cache-Control', 'no-cache');
    if (!up.body) return res.end();
    Readable.fromWeb(up.body).pipe(res);
  } catch {
    res.status(502).end('upstream error');
  }
});

module.exports = { router, getBaseUrl, b64e, b64d };
