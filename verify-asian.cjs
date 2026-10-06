'use strict';
const assert=require('node:assert/strict');
process.env.DISABLE_SYNC='1';process.env.PORT='0';
const app=require('./asian-v013');
(async()=>{
 await app.start();if(!app.server.listening)await new Promise(r=>app.server.once('listening',r));
 const root='http://127.0.0.1:'+app.server.address().port;
 const get=async p=>{const r=await fetch(root+p);assert.equal(r.status,200);return r.json()};
 const m=await get('/manifest.json'),h=await get('/health');
 assert.equal(m.version,'0.17.0');assert.equal(h.version,m.version);
 assert(m.resources.some(x=>x.name==='stream'&&x.idPrefixes.includes('tt')));
 assert.deepEqual(await get('/stream/series/tt123:0:1.json'),{streams:[]});
 assert.deepEqual(await get('/stream/movie/not-imdb.json'),{streams:[]});
 assert.equal(m.catalogs.length,4);assert.deepEqual(m.idPrefixes,['tt']);
 assert(!JSON.stringify(m).match(/motchilla|thvli/i));
 const allCounts={};
 for(const c of m.catalogs){
  const all=[];for(let skip=0;skip<1000;skip+=50){const a=(await get('/catalog/'+c.type+'/'+c.id+'/skip='+skip+'.json')).metas;all.push(...a);if(a.length<50)break}
  assert(all.length>0);assert.equal(new Set(all.map(x=>x.id)).size,all.length);
  assert(all.every(x=>/^tt\d+$/.test(x.id)&&x.type===c.type&&app.isAsian(x)));
  if(c.id.startsWith('vn-'))assert(all.every(app.isVietnam));
  allCounts[c.id]=all.length;
 }
 const route='/catalog/movie/asia-movie-v013';
 const initial=app.list('movie','skip=0').concat(app.list('movie','skip=50'),app.list('movie','skip=100'),app.list('movie','skip=150'));
 const page1=(await get(route+'/skip=0.json')).metas;
 app.merge('movie',[...initial].reverse());
 const page2=(await get(route+'/skip=50.json')).metas;
 assert.equal(new Set([...page1,...page2].map(x=>x.id)).size,page1.length+page2.length,'sync must not duplicate titles across pages');
 assert.deepEqual(app.list('movie','skip=0').map(x=>x.id),page1.map(x=>x.id),'metadata refresh must preserve order');
 const response=await fetch(root+route+'.json');assert.equal(response.headers.get('cache-control'),'no-store');
 const before=(await get('/catalog/movie/asia-movie-v013.json')).metas;
 app.merge('movie',[]);assert.deepEqual((await get('/catalog/movie/asia-movie-v013.json')).metas,before);
 app.merge('movie',[{id:'tt0000000',type:'movie',name:'wrong region',country:'United States',language:'English'}]);
 assert(!app.list('movie','').some(x=>x.id==='tt0000000'));
 assert.equal(app.norm('Đất Rừng'),app.norm('dat rung'));
 assert.equal(app.extra('search=A%26B&skip=50').search,'A&B');
 console.log('PASS',JSON.stringify(allCounts));
 app.server.close();
})().catch(e=>{console.error(e);app.server.close();process.exitCode=1});
