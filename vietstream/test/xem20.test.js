'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  Xem20Provider,
  encodeSlug,
  decodeSlug,
  cleanQuery,
  extractCsrfToken,
  parseSearchHtml,
  parseReleaseEpisode,
  parseDetailHtml,
  extractTicketHash
} = require('../src/providers/xem20');

const searchHtml = `
  <a class="cd-card" href="/mat-ma-song">
    <img data-src="/storage/poster.jpg">
    <h3>Mật Mã Sống</h3><span class="text-xs">2026</span><span>Tập 8</span>
  </a>
  <a class="cd-card" href="/the-loai/hanh-dong"><h3>Bỏ qua</h3></a>
`;

const detailHtml = `
  <html><head>
    <meta name="csrf-token" content="page-token">
    <meta name="description" content="Mô tả phim">
    <meta property="og:image" content="/poster.jpg">
  </head><body>
    <h1>Mật Mã Sống (2026)</h1>
    <a href="/the-loai/hanh-dong">Hành Động</a>
    <article class="cd-release">
      <p class="cd-release__name">S2E3 Thuyết Minh</p>
      <div class="cd-release__meta">1080p</div>
      <form data-download-form action="/download-links/101/access">
        <input name="_token" value="release-token">
      </form>
    </article>
    <article class="cd-release">
      <p class="cd-release__name">S2E3 Vietsub</p>
      <div class="cd-release__meta">4K</div>
      <form action="/download-links/102/access"></form>
    </article>
    <article class="cd-release">
      <p class="cd-release__name">S2E4 Vietsub</p>
      <div class="cd-release__meta">720p</div>
      <form action="/download-links/103/access"></form>
    </article>
  </body></html>
`;

function response({ url, status = 200, body = '', headers = {} }) {
  return new Response(body, { status, headers: new Headers(headers) });
}

test('Xem20 helpers encode slugs and clean search queries', () => {
  const slug = 'phim-bo/mat-ma-song';
  assert.equal(decodeSlug(encodeSlug(slug)), slug);
  assert.equal(cleanQuery('Mật Mã Sống - Phần 2 (2026)'), 'Mật Mã Sống');
  assert.equal(extractCsrfToken('<input name="_token" value="abc">'), 'abc');
});

test('Xem20 search parser ignores navigation cards and normalizes metadata', () => {
  const items = parseSearchHtml(searchHtml, 'https://xem20.net');
  assert.equal(items.length, 1);
  assert.equal(items[0].nativeSlug, 'mat-ma-song');
  assert.equal(items[0].type, 'series');
  assert.equal(items[0].year, 2026);
  assert.equal(items[0].poster, 'https://xem20.net/storage/poster.jpg');
});

test('Xem20 detail parser keeps seasons, variants and CSRF tokens', () => {
  const detail = parseDetailHtml(detailHtml, 'mat-ma-song', 'https://xem20.net');
  assert.equal(detail.type, 'series');
  assert.equal(detail.releases.length, 3);
  assert.deepEqual(detail.videos.map((video) => [video.season, video.episode]), [[2, 3], [2, 4]]);
  assert.equal(detail.releases[0].token, 'release-token');
  assert.equal(detail.releases[1].token, 'page-token');
  assert.deepEqual(parseReleaseEpisode('Tập 12'), { season: 1, episode: 12 });
  assert.deepEqual(parseReleaseEpisode('S3E7'), { season: 3, episode: 7 });
});

test('Xem20 ticket parser accepts Location and body without logging the ticket', () => {
  const hash = 'a'.repeat(40);
  assert.equal(extractTicketHash(`https://dl.downfshare.top/x/${hash}/play`, ''), hash);
  assert.equal(extractTicketHash('', `<a href="/x/${hash}">play</a>`), hash);
  assert.equal(extractTicketHash('', 'none'), null);
});

test('Xem20 provider is inert without credentials', async () => {
  const provider = new Xem20Provider({
    id: 'xem20', name: 'Xem20', prefix: 'x20_', apiUrl: 'https://xem20.net',
    referer: 'https://xem20.net/', login: '', password: ''
  }, { wrappedFetch: async () => { throw new Error('must not fetch'); } });
  assert.deepEqual(await provider.search('Naruto'), []);
});

test('Xem20 resolveStream falls back to a year-matched localized result', async () => {
  const provider = new Xem20Provider({
    id: 'xem20', name: 'Xem20', prefix: 'x20_', apiUrl: 'https://xem20.net',
    referer: 'https://xem20.net/', login: 'tester', password: 'secret'
  }, { wrappedFetch: async () => { throw new Error('must not fetch'); } });
  const localized = {
    slug: encodeSlug('tro-choi-vuong-quyen-phan-1'),
    name: 'Trò Chơi Vương Quyền (Phần 1)',
    originalName: 'Trò Chơi Vương Quyền (Phần 1)',
    year: 2011,
    type: 'series'
  };
  provider.search = async () => [localized];
  provider.streamsFromSlug = async (slug) => slug === localized.slug
    ? [{ url: 'https://xem20.example/play' }]
    : [];

  const streams = await provider.resolveStream({
    title: 'Game of Thrones', year: 2011, type: 'series', season: 1, episode: 1
  });
  assert.equal(streams.length, 1);
});

test('Xem20 provider logs in once, selects exact season/episode variants and resolves tickets', async () => {
  const calls = [];
  const hashes = { '101': 'b'.repeat(40), '102': 'c'.repeat(40) };
  const fetchMock = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', body: options.body || '' });
    if (url.endsWith('/login') && (options.method || 'GET') === 'GET') {
      return response({ url, body: '<input name="_token" value="login-token"><input name="password">' });
    }
    if (url.endsWith('/login') && options.method === 'POST') {
      return response({ url: 'https://xem20.net/', body: '<meta name="csrf-token" content="home-token">' });
    }
    if (url.includes('/tim-kiem?')) return response({ url, body: searchHtml });
    if (url.endsWith('/mat-ma-song')) return response({ url, body: detailHtml });
    const id = String(url).match(/download-links\/(\d+)\/access/);
    if (id) {
      return response({
        url,
        status: 302,
        headers: { location: `https://dl.downfshare.top/x/${hashes[id[1]]}/play` }
      });
    }
    return response({ url, status: 404, body: 'not found' });
  };

  const provider = new Xem20Provider({
    id: 'xem20', name: 'Xem20', prefix: 'x20_', apiUrl: 'https://xem20.net',
    referer: 'https://xem20.net/', login: 'tester', password: 'secret'
  }, { wrappedFetch: fetchMock });

  const hits = await provider.search('Mật Mã Sống (2026)');
  assert.equal(hits.length, 1);
  const streams = await provider.streamsFromSlug(hits[0].slug, 'series', 2, 3);
  assert.equal(streams.length, 2);
  assert.ok(streams.some((stream) => stream.name.includes('Thuyết Minh')));
  assert.ok(streams.some((stream) => stream.name.includes('4K')));
  assert.ok(streams.every((stream) => stream.behaviorHints.notWebReady));
  assert.equal(calls.filter((call) => call.url.endsWith('/login') && call.method === 'POST').length, 1);
  assert.ok(calls.some((call) => call.body.includes('_token=release-token')));
});
