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
 p.watchM3u8=async(s,id)=>`https://cdn.test/${id}.m3u8`;p.validateHls=async()=>true;p.getFallback=async()=>null;
 const d=await p.detail(encodeNativeId('series','show'));assert.equal(slug,'show');assert.deepEqual(d.videos.map(e=>[e.season,e.episode]),[[1,2],[1,10],[2,2]]);
 const streams=await p.streamsFromSlug('show','series',2,2);assert.equal(streams.length,1);assert.equal(streams[0].url,'https://cdn.test/20.m3u8');assert.equal(streams[0].externalUrl,undefined);
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

test('VNStream never exposes browser URLs or invalid playlists', async()=>{
 const p=new VnstreamProvider(PROVIDERS.vnstream);p.detailFromSite=async()=>({id:1,name:'A'});p.episodes=async()=>[{id:1,name:'1',server:'Vietsub'}];p.getFallback=async()=>null;
 p.watchM3u8=async()=>({externalUrl:'https://embed1.streamc.xyz/player'});p.validateHls=async()=>true;
 assert.deepEqual(await p.streamsFromSlug('a','series',1,1),[]);
 p.watchM3u8=async()=>'https://cdn.test/dead.m3u8';p.validateHls=async()=>false;
 assert.deepEqual(await p.streamsFromSlug('a','series',1,1),[]);
});
test('NguonC hides blocked StreamC and labels matched browser fallback',async()=>{
 const p=new NguoncProvider(PROVIDERS.nguonc);p.validateHls=async()=>true;
 const d={slug:'a',type:'series',name:'A',servers:[{serverName:'Vietsub',items:[{name:'2',embed:'https://embed1.streamc.xyz/embed.php?hash=x'}]}]};
 p.getFallback=async()=>null;assert.deepEqual(await p.streamsFromDetail(d,{season:1,episode:2}),[]);
 p.getFallback=async()=>({servers:[{items:[{name:'2',embed:'https://player.phimapi.com/player/?url=x',m3u8:'https://cdn.test/2.m3u8'}]}]});
 const out=await p.streamsFromDetail(d,{season:1,episode:2});assert.equal(out.length,1);assert.match(out[0].name,/KKphim dự phòng/);assert.match(out[0].externalUrl,/player.phimapi.com/);
});
test('Image wrapper is removed only when repeated MPEG-TS sync exists',()=>{
 const {wrappedVideoOffset}=require('../src/hls-proxy');const b=Buffer.alloc(1300);Buffer.from('89504e470d0a1a0a','hex').copy(b);for(let i=0;i<4;i++) b[501+i*188]=0x47;
 assert.equal(wrappedVideoOffset(b),501);b[501+376]=0;assert.equal(wrappedVideoOffset(b),-1);assert.equal(wrappedVideoOffset(Buffer.from('<html>blocked</html>')),-1);
});
