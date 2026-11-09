/**
 * VietStream — Nuvio scraper provider (QuickJS)
 * Nguồn: KKphim (phimapi.com), OPhim, NguonC (phim.nguonc.com), Phim4K (vsmov.com), VnStream (cobephim.biz)
 * Đầu vào: TMDB ID + mediaType ("movie"/"tv") + season/episode.
 * Đầu ra: danh sách stream m3u8, ghi nhãn nguồn + audio (Vietsub / Lồng Tiếng / Thuyết Minh / Song Ngữ).
 *
 * Ràng buộc môi trường QuickJS: không Buffer (dùng atob), không setTimeout,
 * tổng thời gian 60s -> mọi nguồn chạy song song bằng Promise.allSettled.
 */

async function getStreams(tmdbId, mediaType, season, episode) {
  var streams = [];
  try {
    var type = mediaType === 'tv' || mediaType === 'series' || mediaType === 'show' ? 'tv' : 'movie';
    var info = await tmdbInfo(tmdbId, type);
    if (!info || (!info.titles || !info.titles.length)) {
      console.warn('VietStream: TMDB tra ve rong cho ' + tmdbId + ' (key=' + (globalThis.TMDB_API_KEY ? 'co' : 'THIEU') + ')');
      return streams;
    }
    console.log('VietStream: ' + type + ' ' + tmdbId + ' S' + (season || '-') + 'E' + (episode || '-') +
      ' | titles: ' + info.titles.join(' | ') + ' | year: ' + info.year);

    var seasonNum = parseInt(season, 10) || 1;
    var episodeNum = parseInt(episode, 10) || 1;

    var disabled = {};
    try {
      var st = globalThis.SCRAPER_SETTINGS || {};
      (st.disable || []).forEach(function (d) { disabled[String(d).toLowerCase()] = true; });
    } catch (e) { /* ignore */ }

    var providers = [];
    if (!disabled.kkphim) providers.push({ name: 'kkphim', fn: kkphimStreams });
    if (!disabled.ophim) providers.push({ name: 'ophim', fn: ophimStreams });
    if (!disabled.nguonc) providers.push({ name: 'nguonc', fn: nguoncStreams });
    if (!disabled.vnstream) providers.push({ name: 'vnstream', fn: vnstreamStreams });
    if (!disabled.phim4k) providers.push({ name: 'phim4k', fn: phim4kStreams });
    if (!disabled.tophim) providers.push({ name: 'tophim', fn: tophimStreams });

    var results = await Promise.allSettled(
      providers.map(function (p) {
        return p.fn(info, type, seasonNum, episodeNum).then(
          function (s) { console.log('VietStream [' + p.name + ']: ' + s.length + ' stream'); return s; },
          function (e) { console.warn('VietStream [' + p.name + '] loi: ' + (e && e.message)); return []; }
        );
      })
    );
    results.forEach(function (r) {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) streams = streams.concat(r.value);
    });

    // khử trùng lặp theo url
    var seen = {};
    streams = streams.filter(function (s) {
      if (!s || !s.url || seen[s.url]) return false;
      seen[s.url] = true;
      return true;
    });
    console.log('VietStream: tong cong ' + streams.length + ' stream');
  } catch (e) {
    console.error('VietStream getStreams error: ' + (e && e.message));
  }
  return streams;
}

/* ---------------- TMDB: tmdbId -> tên phim + năm ---------------- */

async function tmdbInfo(tmdbId, type) {
  var key = globalThis.TMDB_API_KEY;
  if (!key) {
    console.warn('VietStream: TMDB_API_KEY không có sẵn');
    return null;
  }
  var data = await fetchJson(
    'https://api.themoviedb.org/3/' + type + '/' + tmdbId + '?api_key=' + key + '&language=vi-VN'
  );
  if (!data) return null;

  var viTitle = data.title || data.name || '';
  var original = data.original_title || data.original_name || '';
  var dateStr = data.release_date || data.first_air_date || '';
  var year = parseInt(String(dateStr).slice(0, 4), 10) || null;

  var titles = [];
  [viTitle, original].forEach(function (t) {
    var n = normTitle(t);
    if (t && n && titles.indexOf(t) < 0) titles.push(t);
  });
  return { titles: titles, year: year, mediaType: type, tmdbId: String(tmdbId) };
}

/* ---------------- Helper chung ---------------- */

var UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function fetchJson(url, headers) {
  try {
    var res = await fetch(url, { method: 'GET', headers: headers || { 'User-Agent': UA } });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function fetchText(url, headers) {
  try {
    var res = await fetch(url, { method: 'GET', headers: headers || { 'User-Agent': UA } });
    if (!res.ok) return null;
    return await res.text();
  } catch (e) {
    return null;
  }
}

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

function parseEpNum(v) {
  var m = String(v == null ? '' : v).match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

function detectAudio(text, fallback) {
  var s = String(text || '').toLowerCase();
  if (!s) return fallback || 'Vietsub';
  if (/song\s*ng[ữu]/.test(s)) return 'Song Ngữ';
  if (/thuy[ếe]t\s*minh|\btm\b/.test(s)) return 'Thuyết Minh';
  if (/l[ồo]ng\s*ti[ếe]ng/.test(s)) return 'Lồng Tiếng';
  if (/vietsub|ph[ụu]\s*[dđ][êe]|\bvs\b/.test(s)) return 'Vietsub';
  return fallback || 'Vietsub';
}

function qualityFromText(text, fallback) {
  var s = String(text || '');
  if (/2160|4k/i.test(s)) return '4K';
  var m = s.match(/(\d{3,4})p/i);
  if (m) return m[1] + 'p';
  return fallback || 'HD';
}

function extractUrlParam(embedUrl) {
  if (!embedUrl) return null;
  try {
    var u = new URL(embedUrl);
    var keys = ['url', 'v', 'id'];
    for (var i = 0; i < keys.length; i++) {
      var v = u.searchParams.get(keys[i]);
      if (v && /^https?:/i.test(v)) return v;
    }
  } catch (e) { /* ignore */ }
  return null;
}

// Chấm điểm ứng viên: khớp tuyệt đối 100/90, một phần 10, năm ±1 +20 (lệch xa -50),
// "Phần N/Season N" đúng mùa +25, sai mùa -40.
function seasonMarker(item) {
  var hay = String((item.name || '') + ' ' + (item.originalName || '')).toLowerCase();
  var m = hay.match(/(?:phần|season|part)\s*(\d+)/);
  if (m) return parseInt(m[1], 10);
  m = hay.match(/\bs\s*(\d{1,2})\b/);
  if (m) return parseInt(m[1], 10);
  return null;
}

function scoreItem(item, titles, year, season, isSeries) {
  var best = -Infinity;
  for (var ti = 0; ti < titles.length; ti++) {
    var q = normTitle(titles[ti]);
    if (!q) continue;
    var score = 0;
    var key = normTitle(item.originalName || item.name);
    var nameKey = normTitle(item.name);
    if (key && key === q) score += 100;
    else if (nameKey && nameKey === q) score += 90;
    else if (key && Math.min(q.length, key.length) > 6 && (q.indexOf(key) >= 0 || key.indexOf(q) >= 0)) score += 10;
    else continue;

    var yr = parseInt(year, 10);
    var itY = parseInt(item.year, 10);
    if (itY && yr) score += Math.abs(itY - yr) <= 1 ? 20 : -50;

    var sn = seasonMarker(item);
    if (sn != null) score += isSeries && sn === (parseInt(season, 10) || 1) ? 25 : -40;

    if (score > best) best = score;
  }
  return best;
}

function rankCandidates(items, titles, year, season, isSeries) {
  var cands = [];
  (items || []).forEach(function (it) {
    if (!it || !it.slug) return;
    var score = scoreItem(it, titles, year, season, isSeries);
    if (score >= 10) cands.push({ it: it, score: score });
  });
  cands.sort(function (a, b) { return b.score - a.score; });
  return cands.slice(0, 2).map(function (c) { return c.it; });
}

function pickEpisode(items, epNum, isMovie) {
  if (!items || !items.length) return null;
  if (isMovie) {
    for (var i = 0; i < items.length; i++) {
      if (/full/i.test(String(items[i].name || '') + ' ' + String(items[i].slug || ''))) return items[i];
    }
    return items[0];
  }
  var target = parseInt(epNum, 10) || 1;
  var pool = items.filter(function (e) {
    return parseEpNum(e.name) === target || parseEpNum(e.slug) === target;
  });
  if (!pool.length && target >= 1 && target <= items.length) pool = [items[target - 1]];
  return pool[0] || null;
}

function makeStream(provName, referer, movieName, epLabel, audio, quality, url) {
  return {
    name: 'VietStream · ' + provName,
    title: [epLabel, audio, quality].filter(Boolean).join(' • ') + (movieName ? ' • ' + movieName : ''),
    url: url,
    quality: quality || 'HD',
    type: 'hls',
    language: 'vi',
    provider: provName,
    headers: { 'User-Agent': UA, Referer: referer }
  };
}

function buildStreams(provName, referer, detail, epNum, isMovie) {
  var out = [];
  var servers = (detail && detail.servers) || [];
  for (var i = 0; i < servers.length; i++) {
    var server = servers[i];
    var ep = pickEpisode(server.items, epNum, isMovie);
    if (!ep) continue;
    var src = ep.m3u8 || extractUrlParam(ep.embed) || null;
    if (!src) continue;
    out.push(
      makeStream(
        provName,
        referer,
        detail.name,
        isMovie ? ep.name || 'Full' : 'Tập ' + epNum,
        detectAudio(server.serverName, detectAudio(detail.lang, 'Vietsub')),
        qualityFromText(ep.filename || ep.name, detail.quality),
        src
      )
    );
  }
  return out;
}

/* ---------------- Nguồn 1: KKphim (phimapi.com) ---------------- */

async function kkphimStreams(info, type, season, episode) {
  var api = 'https://phimapi.com';
  var referer = 'https://phimapi.com/';
  var headers = { 'User-Agent': UA, Referer: referer };
  var isSeries = type === 'tv';

  var searchResults = await Promise.all(
    info.titles.map(function (t) {
      return fetchJson(api + '/v1/api/tim-kiem?keyword=' + encodeURIComponent(t) + '&page=1&limit=20', headers);
    })
  );
  var items = [];
  searchResults.forEach(function (d) {
    var arr = (d && d.data && d.data.items) || [];
    arr.forEach(function (i) {
      if (i && i.slug) items.push({
        slug: i.slug,
        name: i.name,
        originalName: i.origin_name,
        year: i.year
      });
    });
  });

  var cands = rankCandidates(items, info.titles, info.year, season, isSeries);
  for (var c = 0; c < cands.length; c++) {
    var d = await fetchJson(api + '/phim/' + encodeURIComponent(cands[c].slug), headers);
    if (!d || !d.status || !d.movie) continue;
    var m = d.movie;
    var detail = {
      name: m.name,
      lang: m.lang,
      quality: m.quality,
      type: ['series', 'hoathinh', 'tvshows'].indexOf(m.type) >= 0 ? 'series' : 'movie',
      servers: (d.episodes || []).map(function (s) {
        return {
          serverName: s.server_name || 'Vietsub',
          items: (s.server_data || []).map(function (e) {
            return { name: e.name, slug: e.slug, filename: e.filename, m3u8: e.link_m3u8 || null, embed: e.link_embed || null };
          })
        };
      })
    };
    var isMovie = detail.type !== 'series';
    var streams = buildStreams('KKphim', referer, detail, isMovie ? null : episode, isMovie);
    if (streams.length) return streams;
  }
  return [];
}

/* ---------------- Nguồn 2: OPhim (ophim.live, format /v1/api) ---------------- */

async function ophimStreams(info, type, season, episode) {
  var api = 'https://www.ophim.live';
  var referer = 'https://www.ophim.live/';
  var headers = { 'User-Agent': UA, Referer: referer };
  var isSeries = type === 'tv';

  var searchResults = await Promise.all(
    info.titles.map(function (t) {
      return fetchJson(api + '/v1/api/tim-kiem?keyword=' + encodeURIComponent(t) + '&page=1&limit=20', headers);
    })
  );
  var items = [];
  searchResults.forEach(function (d) {
    var arr = (d && d.data && d.data.items) || (d && d.items) || [];
    arr.forEach(function (i) {
      if (i && i.slug) items.push({ slug: i.slug, name: i.name, originalName: i.origin_name, year: i.year });
    });
  });

  var cands = rankCandidates(items, info.titles, info.year, season, isSeries);
  for (var c = 0; c < cands.length; c++) {
    var d = await fetchJson(api + '/v1/api/phim/' + encodeURIComponent(cands[c].slug), headers);
    var body = d && d.data;
    if (!body) continue;
    var m = body.item || body.movie || {};
    var eps = body.episodes || m.episodes || [];
    var detail = {
      name: m.name,
      lang: m.lang,
      quality: m.quality,
      type: ['series', 'hoathinh', 'tvshows'].indexOf(m.type) >= 0 ? 'series' : 'movie',
      servers: eps.map(function (s) {
        return {
          serverName: s.server_name || 'Vietsub',
          items: (s.items || s.server_data || []).map(function (e) {
            return { name: e.name, slug: e.slug, m3u8: e.link_m3u8 || e.m3u8 || null, embed: e.link_embed || e.embed || null };
          })
        };
      })
    };
    var isMovie = detail.type !== 'series';
    var streams = buildStreams('OPhim', referer, detail, isMovie ? null : episode, isMovie);
    if (streams.length) return streams;
  }
  return [];
}

/* ---------------- Nguồn 3: NguonC (phim.nguonc.com) ---------------- */

function b64Decode(b64) {
  try { return atob(b64); } catch (e) { return null; }
}

function unpackDeanEdwards(packed) {
  var m = packed.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/);
  if (!m) return packed;
  var p = m[1], a = parseInt(m[2], 10), c = parseInt(m[3], 10);
  var keys = m[4].split('|');
  function e(cVal) {
    return (cVal < a ? '' : e(Math.floor(cVal / a))) + ((cVal = cVal % a) > 35 ? String.fromCharCode(cVal + 29) : cVal.toString(36));
  }
  while (c--) {
    if (keys[c]) p = p.replace(new RegExp('\\b' + e(c) + '\\b', 'g'), keys[c]);
  }
  return p;
}

// Giải mã link embed StreamC -> m3u8 (data-obf / Dean Edwards / regex)
async function extractStreamC(embedUrl, referer) {
  try {
    var origin = new URL(embedUrl).origin;
    var html = await fetchText(embedUrl, { 'User-Agent': UA, Referer: referer, Origin: 'https://phim.nguonc.com' });
    if (!html) return null;

    var obf = html.match(/data-obf=["']([^"']+)["']/i);
    if (obf) {
      var decoded = b64Decode(obf[1]);
      if (decoded) {
        try {
          var obj = JSON.parse(decoded);
          if (obj && obj.sUb) return origin + '/' + obj.sUb;
        } catch (e) { /* ignore */ }
      }
    }
    if (html.indexOf('eval(function(p,a,c,k,e,d)') >= 0) {
      var unpacked = unpackDeanEdwards(html);
      var sub = unpacked.match(/["'](eyJoIjoi[^"']+)["']/);
      if (sub) return origin + '/' + sub[1];
      var direct = unpacked.match(/(https?:\/\/[^"'\s)]+\.m3u8[^"'\s)]*)/i);
      if (direct) return direct[1];
    }
    var plain = html.match(/(https?:\/\/[^"'\s)]+\.m3u8[^"'\s)]*)/i);
    if (plain) return plain[1];
  } catch (e) { /* ignore */ }
  return null;
}

async function nguoncStreams(info, type, season, episode) {
  var api = 'https://phim.nguonc.com/api';
  var referer = 'https://phim.nguonc.com/';
  var headers = { 'User-Agent': UA, Referer: referer };
  var isSeries = type === 'tv';

  var searchResults = await Promise.all(
    info.titles.map(function (t) {
      return fetchJson(api + '/films/search?keyword=' + encodeURIComponent(t) + '&page=1', headers);
    })
  );
  var items = [];
  searchResults.forEach(function (d) {
    var arr = (d && d.items) || [];
    arr.forEach(function (i) {
      if (i && i.slug) items.push({ slug: i.slug, name: i.name, originalName: i.original_name, year: i.year });
    });
  });

  var cands = rankCandidates(items, info.titles, info.year, season, isSeries);
  for (var c = 0; c < cands.length; c++) {
    var d = await fetchJson(api + '/film/' + encodeURIComponent(cands[c].slug), headers);
    var m = d && (d.movie || d);
    if (!m || (!m.name && !m.slug)) continue;
    var isMovie = !(parseInt(m.total_episodes, 10) > 1 || (m.current_episode && !/full/i.test(String(m.current_episode))));
    var epNum = isMovie ? null : episode;
    var streams = [];
    var servers = m.episodes || [];
    for (var i = 0; i < servers.length; i++) {
      var server = servers[i];
      var ep = pickEpisode(server.items || [], epNum, isMovie);
      if (!ep) continue;
      var audio = detectAudio(server.server_name, detectAudio(m.language, 'Vietsub'));
      var url = ep.m3u8 || null;
      if (!url && ep.embed) url = await extractStreamC(ep.embed, referer);
      if (!url) continue;
      streams.push(
        makeStream(
          'NguonC', referer, m.name,
          isMovie ? ep.name || 'Full' : 'Tập ' + (epNum || 1),
          audio, m.quality || 'HD', url
        )
      );
    }
    if (streams.length) return streams;
  }
  return [];
}

/* ---------------- Nguồn 4: VnStream (cobephim.biz) ---------------- */

function unescapeSsr(body) {
  var b = String(body || '');
  while (b.indexOf('\\"') >= 0) {
    b = b.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return b;
}

function serverScore(name) {
  var s = String(name || '');
  if (/vietsub/i.test(s)) return 0;
  if (/phụ đề|phu de/i.test(s)) return 1;
  if (/thuyết minh|thuyet minh/i.test(s)) return 2;
  if (/song ngữ|song ngu/i.test(s)) return 3;
  return 4;
}

async function vnstreamStreams(info, type, season, episode) {
  var api = 'https://egluy2hhb21vaw5ndw9pbmhl.darkbytes.xyz/api/v1';
  var site = 'https://cobephim.biz';
  var referer = 'https://cobephim.biz/';
  var headers = { 'User-Agent': UA, Referer: referer };
  var isMovie = type !== 'tv';

  var searchResults = await Promise.all(
    info.titles.map(function (t) {
      return fetchJson(api + '/movies/search?q=' + encodeURIComponent(t), headers);
    })
  );
  var items = [];
  searchResults.forEach(function (d) {
    var arr = (d && d.result) || [];
    arr.forEach(function (i) {
      if (i && i.slug) items.push({ slug: i.slug, name: i.name, originalName: i.origin_name, year: i.publish_year || i.year, id: i.id });
    });
  });
  var cands = rankCandidates(items, info.titles, info.year, season, !isMovie);
  if (!cands.length) return [];
  var movie = cands[0];
  if (!movie.id) return [];

  var eps = await fetchJson(api + '/episodes/by-idMovie/' + movie.id, headers);
  if (!Array.isArray(eps) || !eps.length) return [];

  var pool = eps;
  if (!isMovie) {
    var s = parseInt(season, 10) || 1;
    var target = parseInt(episode, 10) || 1;
    var bySeason = eps.filter(function (e) { return (parseInt(e.season_number, 10) || 1) === s; });
    pool = bySeason.length ? bySeason : eps;
    var byNum = pool.filter(function (e) {
      return parseEpNum(e.name) === target || parseEpNum(e.slug) === target;
    });
    pool = byNum.length ? byNum : pool;
  } else {
    var full = eps.filter(function (e) { return /full|tap-full/i.test(String(e.name) + ' ' + String(e.slug)); });
    pool = full.length ? full : eps;
  }
  if (!pool.length) return [];

  var sorted = pool.slice().sort(function (a, b) { return serverScore(a.server) - serverScore(b.server); });
  var streams = [];
  var usedServers = {};
  for (var i = 0; i < sorted.length && streams.length < 3; i++) {
    var ep = sorted[i];
    if (usedServers[ep.server]) continue;
    usedServers[ep.server] = true;
    var url = await vnstreamWatch(site, referer, headers, movie.slug, ep.id);
    if (!url) continue;
    streams.push(
      makeStream(
        'VnStream', referer, movie.name,
        isMovie ? 'Full' : 'Tập ' + (parseEpNum(ep.name) || episode),
        detectAudio(ep.server, 'Vietsub'), 'HD', url
      )
    );
  }
  return streams;
}

async function vnstreamWatch(site, referer, headers, slug, epId) {
  var html = await fetchText(site + '/xem-phim/' + encodeURIComponent(slug) + '.' + epId, headers);
  if (!html) return null;

  var m = html.match(/"link"\s*:\s*\\?"(https?:\/\/[^"\\]+?\.m3u8[^"\\]*)\\?"/);
  if (m) return m[1];
  m = html.match(/"link"\s*:\s*"(https?:\/\/[^"]+?\.m3u8[^"]*)"/);
  if (m) return m[1];

  html = unescapeSsr(html);
  m = html.match(/"type":"([^"]+)","link":"([^"]+)"/);
  if (!m) return null;
  if (/m3u8/i.test(m[1])) return m[2];
  if (/embed/i.test(m[1])) {
    var embedHtml = await fetchText(m[2], headers);
    if (!embedHtml) return null;
    var bm = embedHtml.match(/baseUrl\s*=\s*"([^"]+)"/);
    var vh = embedHtml.match(/videoHash\s*=\s*"([^"]+)"/);
    if (bm && vh) return bm[1] + '/stream/' + vh[1] + '/master.m3u8';
    var direct = embedHtml.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/i);
    if (direct) return direct[0];
  }
  return null;
}

/* ---------------- Nguồn 5: Phim4K (vsmov.com/api) ---------------- */

async function phim4kStreams(info, type, season, episode) {
  var api = 'https://vsmov.com/api';
  var referer = 'https://vsmov.com/';
  var headers = { 'User-Agent': UA, Referer: referer };
  var isSeries = type === 'tv';

  var searchResults = await Promise.all(
    info.titles.map(function (t) {
      return fetchJson(api + '/tim-kiem?keyword=' + encodeURIComponent(t) + '&page=1', headers);
    })
  );
  var items = [];
  searchResults.forEach(function (d) {
    var arr = (d && d.items) || (d && d.data && d.data.items) || [];
    arr.forEach(function (i) {
      if (i && i.slug) items.push({ slug: i.slug, name: i.name, originalName: i.origin_name, year: i.year });
    });
  });

  var cands = rankCandidates(items, info.titles, info.year, season, isSeries);
  for (var c = 0; c < cands.length; c++) {
    var d = await fetchJson(api + '/phim/' + encodeURIComponent(cands[c].slug), headers);
    if (!d) continue;
    var m = d.movie || (d.data && d.data.movie);
    if (!m) continue;
    var eps = d.episodes || (d.data && d.data.episodes) || [];
    var detail = {
      name: m.name,
      lang: m.lang,
      quality: m.quality,
      type: ['series', 'hoathinh', 'tvshows'].indexOf(m.type) >= 0 ? 'series' : 'movie',
      servers: eps.map(function (s) {
        return {
          serverName: s.server_name || 'Vietsub',
          items: (s.server_data || s.items || []).map(function (e) {
            return { name: e.name, slug: e.slug, filename: e.filename, m3u8: e.link_m3u8 || e.m3u8 || null, embed: e.link_embed || e.embed || null };
          })
        };
      })
    };
    var isMovie = detail.type !== 'series';

    // embed streamvsmov cần giải mã baseUrl + videoHash -> master.m3u8
    var streams = [];
    var servers = detail.servers;
    var epNum = isMovie ? null : episode;
    for (var i = 0; i < servers.length; i++) {
      var server = servers[i];
      var ep = pickEpisode(server.items, epNum, isMovie);
      if (!ep) continue;
      var url = ep.m3u8 || null;
      if (!url && ep.embed) {
        var inner = extractUrlParam(ep.embed);
        if (inner) url = inner;
        else url = await resolveVsmovEmbed(ep.embed, referer);
      }
      if (!url) continue;
      streams.push(
        makeStream(
          'Phim4K', referer, detail.name,
          isMovie ? ep.name || 'Full' : 'Tập ' + (epNum || 1),
          detectAudio(server.serverName, detectAudio(detail.lang, 'Vietsub')),
          qualityFromText(ep.filename || ep.name, detail.quality),
          url
        )
      );
    }
    if (streams.length) return streams;
  }
  return [];
}

async function resolveVsmovEmbed(embedUrl, referer) {
  var html = await fetchText(embedUrl, { 'User-Agent': UA, Referer: referer });
  if (!html) return null;
  var bm = html.match(/baseUrl\s*=\s*"([^"]+)"/);
  var vh = html.match(/videoHash\s*=\s*"([^"]+)"/);
  if (bm && vh) return bm[1] + '/stream/' + vh[1] + '/master.m3u8';
  var m = html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/i);
  return m ? m[0] : null;
}

/* ---------------- Nguồn 6: Tophim (tophim.top — nhà Motchill/PhimMoi) ---------------- */

// Site Next.js: trang /phim/{slug} nhúng JSON tập + video_url m3u8.
// Slug còn có dạng TMDB trực tiếp: movie-<tmdbId> và tv-<tmdbId>-<season> -> fast path.

function tophimParsePage(html) {
  var b = unescapeSsr(html);
  var t = (html.match(/<title>([^<]+)<\/title>/) || [])[1] || '';
  var tm = t.match(/Xem Phim\s+(.+?)\s+\(([^()]*)\)\s+\((\d{4})\)/);
  var re = /"([^"]+)","name":"([^"]+)","slug":"([^"]+)","video_url":"([^"]+)"/g;
  var groups = {};
  var count = 0;
  var m;
  while ((m = re.exec(b))) {
    var label = m[1].trim().replace(/^#/, '');
    var url = m[4];
    if (!/^https?:\/\//i.test(url) || /embed\.php|\/embed/i.test(url)) continue; // chỉ lấy m3u8 trực tiếp
    if (!groups[label]) groups[label] = [];
    groups[label].push({ name: m[2], slug: m[3], m3u8: url, embed: null });
    count++;
  }
  if (!count) return null;
  var servers = Object.keys(groups).map(function (label) {
    return { serverName: label, items: groups[label] };
  });
  var hasNumbered = servers.some(function (s) {
    return s.items.some(function (e) { return /tập|\d/.test(e.name) && !/full/i.test(e.name); });
  });
  return {
    name: tm ? tm[1].trim() : '',
    originalName: tm && tm[2] ? tm[2].trim() : '',
    year: tm ? parseInt(tm[3], 10) : null,
    quality: /\b(4K|2160P|1080P|HD)\b/i.test(t) ? 'HD' : 'HD',
    type: hasNumbered && count > 1 ? 'series' : 'movie',
    servers: servers
  };
}

async function tophimStreams(info, type, season, episode) {
  var site = 'https://tophim.top';
  var referer = 'https://tophim.top/';
  var headers = { 'User-Agent': UA, Referer: referer };
  var isMovie = type !== 'tv';
  var epNum = isMovie ? null : parseInt(episode, 10) || 1;

  // 1) fast path: slug theo TMDB id (movie-872586 / tv-1396-1)
  var slugs = [];
  if (info.tmdbId) {
    slugs.push(isMovie ? 'movie-' + info.tmdbId : 'tv-' + info.tmdbId + '-' + (parseInt(season, 10) || 1));
  }
  // 2) dự phòng: search suggestions -> slug
  try {
    var results = await Promise.all(
      info.titles.map(function (t) {
        return fetchJson(site + '/api/search/suggestions?q=' + encodeURIComponent(t), headers);
      })
    );
    results.forEach(function (d) {
      var arr = (d && d.movies) || [];
      arr.forEach(function (mv) {
        if (mv && mv.slug && slugs.indexOf(mv.slug) < 0) slugs.push(mv.slug);
      });
    });
  } catch (e) { /* ignore */ }

  for (var c = 0; c < slugs.length; c++) {
    var html = await fetchText(site + '/phim/' + encodeURIComponent(slugs[c]), {
      headers: headers
    });
    if (!html) continue;
    var d = tophimParsePage(html);
    if (!d) continue;
    var streams = [];
    for (var i = 0; i < d.servers.length; i++) {
      var server = d.servers[i];
      var ep = pickEpisode(server.items, epNum, isMovie);
      if (!ep || !ep.m3u8) continue;
      streams.push(
        makeStream(
          'Tophim', referer, d.name,
          isMovie ? ep.name || 'Full' : 'Tập ' + (epNum || 1),
          detectAudio(server.serverName, 'Vietsub'),
          d.quality, ep.m3u8
        )
      );
    }
    if (streams.length) return streams;
  }
  return [];
}

/* ---------------- Xuất hàm cho runtime Nuvio ---------------- */

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
}
if (typeof globalThis !== 'undefined') globalThis.getStreams = getStreams;
if (typeof global !== 'undefined') global.getStreams = getStreams;
if (typeof self !== 'undefined') self.getStreams = getStreams;
