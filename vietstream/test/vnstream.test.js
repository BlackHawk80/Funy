'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {VnstreamProvider}=require('../src/providers/vnstream');
const {encodeNativeId}=require('../src/providers/k20');
const cfg={id:'vnstream',prefix:'vn_',name:'VNStream',apiUrl:'https://example.test/guest'};
test('VNStream builds distinct episodes and preserves playback headers and subtitles',async()=>{
 const p=new VnstreamProvider(cfg); const headers={request:{Referer:'https://example.test/'}};
 p.request=async u=>u.includes('/meta/')?{meta:{name:'Series',type:'series'}}:{streams:[
 {name:'Tập 01',url:'https://cdn.test/1.m3u8'},
 {name:'Tập 02',url:'https://cdn.test/2.m3u8',behaviorHints:{proxyHeaders:headers},subtitles:[{id:'vi',url:'https://cdn.test/2.vtt',lang:'vie'}]},
 {name:'Tập 02',url:'https://cdn.test/2-dub.m3u8'},
 {name:'Tập 03',externalUrl:'https://example.test/player'}]};
 const id=encodeNativeId('series','show:opaque');const d=await p.detail(id);
 assert.equal(d.videos.length,2);assert.equal(d.videos[1].episode,2);
 const streams=await p.streamsFromSlug(id,'series',1,2);assert.equal(streams.length,2);
 assert.deepEqual(streams[0].behaviorHints.proxyHeaders,headers);assert.equal(streams[0].subtitles[0].lang,'vie');
 assert.deepEqual(await p.streamsFromSlug(id,'series',2,2),[]);assert.deepEqual(await p.streamsFromSlug(id,'series',1,99),[]);
});
test('VNStream forwards pagination and genre to official catalog and separates types',async()=>{
 const p=new VnstreamProvider(cfg);let url;
 p.request=async u=>{url=u;return {metas:[{id:'show',name:'Show',releaseInfo:2026}]}};
 const result=await p.listCatalog('bo',{skip:24,genre:'Hành Động'});
 assert.match(url,/\/catalog\/series\/vnstream-top\//);assert.match(url,/skip=24/);assert.match(url,/genre=/);
 assert.equal(result[0].type,'series');assert.equal(result[0].releaseInfo,'2026');
});
test('VNStream falls back to direct source with exact episodes and truthful labels',async()=>{
 const p=new VnstreamProvider(cfg);p.request=async()=>null;
 p.fallback.detail=async()=>({name:'Fallback show',type:'series',year:2026,servers:[{serverName:'Vietsub',items:[
 {name:'01',m3u8:'https://cdn.test/fallback-1.m3u8'},
 {name:'02',m3u8:'https://cdn.test/fallback-2.m3u8'},
 {name:'Trailer',m3u8:'https://cdn.test/trailer.m3u8'},
 {name:'03',embed:'https://cdn.test/player'}]}]});
 const id=encodeNativeId('series','fallback-show');
 const detail=await p.detail(id);assert.equal(detail.videos.length,2);
 const streams=await p.streamsFromSlug(id,'series',1,2);
 assert.equal(streams.length,1);assert.equal(streams[0].url,'https://cdn.test/fallback-2.m3u8');
 assert.match(streams[0].title,/KKphim dự phòng/);
 assert.deepEqual(await p.streamsFromSlug(id,'series',1,3),[]);
});
test('Fallback catalog keeps page size and excludes other media types',async()=>{
 const p=new VnstreamProvider(cfg);p.request=async()=>null;let url;
 p.fallback.request=async u=>{url=new URL(u);return {data:{items:[
 {slug:'series-a',name:'A',type:'series',year:2026},{slug:'movie-b',name:'B',type:'single'}]}}};
 const list=await p.listCatalog('bo',{skip:24,genre:'Hành Động'});
 assert.equal(url.searchParams.get('page'),'2');assert.equal(url.searchParams.get('limit'),'24');
 assert.equal(url.searchParams.get('category'),'hanh-dong');assert.equal(list.length,1);
 assert.match(list[0].id,/^vn_/);assert.equal(list[0].type,'series');
});
test('Valid empty VNStream response does not substitute unrelated fallback data',async()=>{
 const p=new VnstreamProvider(cfg);p.request=async()=>({metas:[],streams:[]});
 p.fallbackCatalog=async()=>{throw new Error('must not fallback')};
 p.fallbackStreams=async()=>{throw new Error('must not fallback')};
 assert.deepEqual(await p.listCatalog('moi'),[]);
 assert.deepEqual(await p.rawStreams({type:'movie',id:'valid-empty'}),[]);
});
