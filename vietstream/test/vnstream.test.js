'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {VnstreamProvider}=require('../src/providers/vnstream');
const {NguoncProvider}=require('../src/providers/nguonc');
const {encodeNativeId}=require('../src/providers/k20');
const {PROVIDERS}=require('../src/config');
test('CoBe selects exact season and episode, preserves legacy IDs and sorts videos',async()=>{
 const p=new VnstreamProvider(PROVIDERS.vnstream);let slug;
 p.detailFromSite=async s=>{slug=s;return {id:1,name:'Show',type:'series'}};
 p.episodes=async()=>[{id:10,name:'10',season_number:1,server:'Vietsub'},{id:2,name:'2',season_number:1,server:'Vietsub'},{id:20,name:'2',season_number:2,server:'Vietsub'}];
 p.watchM3u8=async(s,id)=>({externalUrl:`https://player.test/${id}`});
 const d=await p.detail(encodeNativeId('series','show'));assert.equal(slug,'show');assert.deepEqual(d.videos.map(e=>[e.season,e.episode]),[[1,2],[1,10],[2,2]]);
 const streams=await p.streamsFromSlug('show','series',2,2);assert.equal(streams.length,1);assert.equal(streams[0].externalUrl,'https://player.test/20');
 assert.deepEqual(await p.streamsFromSlug('show','series',1,99),[]);
 assert.deepEqual(await p.streamsFromSlug('show','series',3,2),[]);
});
test('NguonC returns browser player only and never wrong episode',async()=>{
 const p=new NguoncProvider(PROVIDERS.nguonc);
 const d={type:'series',name:'Show',servers:[{serverName:'Vietsub',items:[{name:'2',embed:'https://player.test/2',m3u8:'https://cdn.test/2.m3u8'}]}]};
 const streams=await p.streamsFromDetail(d,{season:1,episode:2});assert.equal(streams.length,1);assert.equal(streams[0].externalUrl,'https://player.test/2');assert.equal(streams[0].url,undefined);
 assert.deepEqual(await p.streamsFromDetail(d,{season:1,episode:1}),[]);
 assert.deepEqual(await p.streamsFromDetail(d,{season:2,episode:2}),[]);
 assert.equal(await p.extractStreamItem({embed:'javascript:alert(1)'}),null);
 assert.equal(await p.extractStreamItem({m3u8:'https://cdn.test/2.m3u8'}),null);
});
test('OPhim disabled and CoBe uses API with current site',()=>{assert.equal(PROVIDERS.ophim.enabled,false);assert.match(PROVIDERS.vnstream.apiUrl,/darkbytes/);assert.match(PROVIDERS.vnstream.siteUrl,/cobephim.fit/);});
