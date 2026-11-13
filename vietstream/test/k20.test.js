'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  K20Provider,
  encodeNativeId,
  decodeNativeId,
  episodeNumber
} = require('../src/providers/k20');

const cfg = {
  id: 'k20',
  name: 'K20',
  prefix: 'k20_',
  apiUrl: 'https://sc.k-20.xyz',
  referer: 'https://sc.k-20.xyz/',
  proxy: false
};

test('K20 opaque native ID round-trips colon-containing IDs', () => {
  const encoded = encodeNativeId('series', 'vsmov:naruto:tap-1');
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeNativeId(encoded), { type: 'series', id: 'vsmov:naruto:tap-1' });
  assert.equal(decodeNativeId('not-base64-json'), null);
});

test('K20 episode number uses title, explicit episode, then index', () => {
  assert.equal(episodeNumber({ title: 'Tập 12', episode: 3 }, 0), 12);
  assert.equal(episodeNumber({ title: 'Special', episode: 3 }, 0), 3);
  assert.equal(episodeNumber({ title: 'Special' }, 4), 5);
});

test('K20 series resolves the exact native video and preserves headers/subtitles', async () => {
  const provider = new K20Provider(cfg);
  const calls = [];
  provider.request = async (url) => {
    calls.push(url);
    if (url.includes('/meta/series/')) {
      return {
        meta: {
          id: 'vsmov:naruto',
          type: 'series',
          name: 'Naruto',
          releaseInfo: '2002',
          videos: [
            { id: 'vsmov:naruto:tap-1', title: '1', season: 1, episode: 1 },
            { id: 'vsmov:naruto:tap-2', title: '2', season: 1, episode: 2 }
          ]
        }
      };
    }
    if (url.includes('/stream/series/')) {
      return {
        streams: [{
          name: 'NguonC • Direct CDN',
          title: 'Vietsub #1 - 2',
          url: 'https://sc.k-20.xyz/test.m3u8',
          behaviorHints: {
            proxyHeaders: { request: { Referer: 'https://embed.example/', Origin: 'https://embed.example' } }
          },
          subtitles: [{ url: 'https://sub.example/2.vtt', lang: 'vi', name: 'Tiếng Việt' }]
        }]
      };
    }
    return null;
  };

  const slug = encodeNativeId('series', 'vsmov:naruto');
  const streams = await provider.streamsFromSlug(slug, 'series', 1, 2);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://sc.k-20.xyz/test.m3u8');
  assert.equal(streams[0].behaviorHints.proxyHeaders.request.Origin, 'https://embed.example');
  assert.equal(streams[0].subtitles[0].url, 'https://sub.example/2.vtt');
  assert.ok(calls.some((url) => url.includes(encodeURIComponent('vsmov:naruto:tap-2'))));
});

test('K20 resolveStream falls back to a year-matched localized search result', async () => {
  const provider = new K20Provider(cfg);
  const localized = {
    nativeId: 'vsmov:tro-choi-vuong-quyen-phan-1',
    slug: encodeNativeId('series', 'vsmov:tro-choi-vuong-quyen-phan-1'),
    type: 'series',
    name: 'Trò Chơi Vương Quyền (Phần 1)',
    originalName: 'Trò Chơi Vương Quyền (Phần 1)',
    year: 2011
  };
  provider.searchType = async () => [localized];
  provider.streamsFromSlug = async (slug) => slug === localized.slug
    ? [{ url: 'https://k20.example/episode.m3u8' }]
    : [];

  const streams = await provider.resolveStream({
    title: 'Game of Thrones', year: 2011, type: 'series', season: 1, episode: 1
  });
  assert.equal(streams.length, 1);
});

test('K20 catalog merges and deduplicates provider results', async () => {
  const provider = new K20Provider(cfg);
  provider.fetchCatalog = async (type, catalogId) => {
    if (catalogId.startsWith('clbpx')) {
      return [{ nativeId: 'same:id', slug: encodeNativeId(type, 'same:id'), type, name: 'Same' }];
    }
    if (catalogId.startsWith('vsmov')) {
      return [
        { nativeId: 'same:id', slug: encodeNativeId(type, 'same:id'), type, name: 'Duplicate' },
        { nativeId: 'new:id', slug: encodeNativeId(type, 'new:id'), type, name: 'New' }
      ];
    }
    return [];
  };

  const metas = await provider.listCatalog('movie');
  assert.deepEqual(metas.map((meta) => meta.name), ['Same', 'New']);
  assert.ok(metas.every((meta) => meta.id.startsWith('k20_')));
});

test('K20 uses current catalogs, excludes NguonC and routes individual rows',async()=>{
 const p=new K20Provider(cfg);assert.deepEqual(p.catalogIds('series'),['vsmov-series','kkphim-series']);
 let called;p.fetchCatalog=async(type,id,extra)=>{called={type,id,extra};return []};
 await p.listCatalog('vsmov-4k',{skip:20});assert.deepEqual(called,{type:'movie',id:'vsmov-4k',extra:{skip:20}});
 assert.equal(await p.detail(encodeNativeId('movie','nguonc:old')),null);
 assert.equal(await p.detail(encodeNativeId('movie','stp:old')),null);
 assert.ok(!p.catalogIds('movie').some(id=>id.startsWith('stp-')));
 const {buildManifest}=require('../src/manifest');const manifest=buildManifest('https://test.example');
 assert.ok(!manifest.catalogs.some(c=>c.id.startsWith('nguonc-')));assert.ok(!manifest.description.includes('NguonC'));
 assert.equal(manifest.catalogs.filter(c=>c.id.startsWith('k20-')).length,6);
});
test('K20 cannot substitute another season or episode',()=>{
 const p=new K20Provider(cfg);const d={type:'series',nativeVideos:[{id:'one',season:1,episode:1,title:'1'}]};
 assert.equal(p.pickNativeVideo(d,2,1),null);assert.equal(p.pickNativeVideo(d,1,2),null);
});
