'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {VnstreamProvider,guestEpisode}=require('../src/providers/vnstream');
const {encodeNativeId}=require('../src/providers/k20');
const {PROVIDERS}=require('../src/config');
test('Guest keeps complete metadata and derives distinct sorted episodes from streams',async()=>{
 const p=new VnstreamProvider(PROVIDERS.vnstream);
 p.request=async url=>url.includes('/meta/')?{meta:{name:'Show',poster:'https://img.test/p.jpg',description:'Summary',runtime:'45 phút',imdbRating:'8.5',releaseInfo:2026}}:{streams:[{name:'Tập 02',url:'https://cdn.test/2.m3u8'},{name:'Tập 01',url:'https://cdn.test/1.m3u8'},{name:'Tập 02',url:'https://cdn.test/2-dub.m3u8'},{name:'Trailer',externalUrl:'https://site.test'}]};
 const slug=encodeNativeId('series','guest-test-show');const d=await p.detail(slug);const meta=p.buildMeta(d);
 assert.equal(meta.description,'Summary');assert.equal(meta.poster,'https://img.test/p.jpg');assert.equal(meta.runtime,'45 phút');assert.equal(meta.imdbRating,'8.5');assert.equal(meta.releaseInfo,'2026');assert.deepEqual(meta.videos.map(e=>e.episode),[1,2]);
 const s=await p.streamsFromSlug(slug,'series',1,2);assert.equal(s.length,2);assert.equal(s[0].url,'https://cdn.test/2.m3u8');
 assert.deepEqual(await p.streamsFromSlug(slug,'series',2,2),[]);assert.deepEqual(await p.streamsFromSlug(slug,'series',1,99),[]);
});
test('Guest forwards filters and retains playback headers and subtitles unchanged',async()=>{
 const p=new VnstreamProvider(PROVIDERS.vnstream);let called;
 p.request=async url=>{called=url;return {metas:[{id:'movie-test',name:'Film',releaseInfo:2026,poster:'https://img.test/a.jpg'}]}};
 const items=await p.listCatalog('moi',{search:'A B',skip:24,genre:'Hài'});assert.match(called,/vnstream-vietsub/);assert.match(called,/skip=24/);assert.equal(items[0].releaseInfo,'2026');
 const stream={url:'https://cdn.test/movie.mp4',name:'Full',behaviorHints:{proxyHeaders:{request:{Referer:'https://source.test/'}}},subtitles:[{url:'https://cdn.test/vi.vtt',lang:'vie'}]};
 p.rawStreams=async()=>[stream];const out=await p.streamsFromSlug('plain-legacy-slug','movie',1,1);assert.equal(out[0].url,stream.url);assert.deepEqual(out[0].behaviorHints,stream.behaviorHints);assert.deepEqual(out[0].subtitles,stream.subtitles);
});
test('Guest empty responses remain empty and no source substitution occurs',async()=>{
 const p=new VnstreamProvider(PROVIDERS.vnstream);p.request=async()=>null;
 assert.deepEqual(await p.listCatalog('moi'),[]);assert.equal(await p.detail(encodeNativeId('movie','missing')),null);
 assert.deepEqual(await p.streamsFromSlug('missing','movie',1,1),[]);
 assert.deepEqual(guestEpisode({name:'Tập 2',behaviorHints:{filename:'Show_S02E02'}}),{season:2,episode:2});
 assert.equal(PROVIDERS.vnstream.proxy,false);assert.equal(PROVIDERS.vnstream.apiUrl,'https://addon.vnstream.io.vn/guest');assert.equal(PROVIDERS.nguonc.enabled,false);
});
