/**
 * Test harness cho plugin Nuvio trên Node.js.
 * - Shim TMDB API (trả dữ liệu cứng) vì TMDB_API_KEY thật chỉ có trong app Nuvio.
 * - Các request khác đi ra internet thật.
 * Chạy: node nuvio-plugin/test/test.js
 */

const plugin = require('../providers/vietstream.js');

const TMDB_FIXTURES = {
  '872586': { title: 'Oppenheimer', original_title: 'Oppenheimer', release_date: '2023-07-19' },
  '1399': { name: 'Game of Thrones', original_name: 'Game of Thrones', first_air_date: '2011-04-17' },
  '507089': { title: 'Mưa Đỏ', original_title: 'Red Rain', release_date: '2025-08-22' }
};

const realFetch = global.fetch;
global.fetch = async function (url, opts) {
  const u = String(url);
  if (u.includes('api.themoviedb.org')) {
    const id = u.match(/\/(?:movie|tv)\/(\d+)\?/)[1];
    const body = TMDB_FIXTURES[id];
    return {
      ok: !!body,
      status: body ? 200 : 404,
      json: async () => body || ({}),
      text: async () => JSON.stringify(body || {})
    };
  }
  return realFetch(url, opts);
};

globalThis.TMDB_API_KEY = 'test-key';

async function run(label, tmdbId, mediaType, season, episode) {
  const t0 = Date.now();
  try {
    const streams = await plugin.getStreams(tmdbId, mediaType, season, episode);
    console.log(`\n=== ${label} (${((Date.now() - t0) / 1000).toFixed(1)}s) — ${streams.length} streams ===`);
    streams.forEach((s) => {
      console.log(` * [${s.provider}] ${s.title}`);
      console.log(`   url: ${(s.url || '').slice(0, 85)}`);
      console.log(`   quality: ${s.quality} | type: ${s.type} | Referer: ${(s.headers && s.headers.Referer) || '-'}`);
      if (!s.url || !s.title) throw new Error('Stream thiếu url/title!');
    });
  } catch (e) {
    console.error(`${label} LỖI:`, e.message);
    process.exitCode = 1;
  }
}

(async () => {
  await run('MOVIE Oppenheimer (tmdb 872586)', '872586', 'movie');
  await run('TV Game of Thrones S1E1 (tmdb 1399)', '1399', 'tv', 1, 1);
  console.log('\nDONE');
})();
