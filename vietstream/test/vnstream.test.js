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
