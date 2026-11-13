'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getJson } = require('../src/utils');

test('HTTP timeout remains active until fetch settles', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });

  const started = Date.now();
  try {
    const result = await getJson('https://timeout.test', { timeout: 25 });
    const elapsed = Date.now() - started;
    assert.equal(result, null);
    assert.ok(elapsed >= 15, `timeout fired too early: ${elapsed}ms`);
    assert.ok(elapsed < 500, `timeout did not fire: ${elapsed}ms`);
  } finally {
    global.fetch = originalFetch;
  }
});


test('Catalog newest first handles missing years, quality labels and same-year dates',()=>{
 const {sortCatalogNewest,catalogYear}=require('../src/utils');
 const items=[{id:'unknown',releaseInfo:'4K 2160p'},{id:'old',year:1997},{id:'recent-old-update',year:2026,updatedAt:'2026-01-01'},{id:'recent-new-update',releaseInfo:'HD · Vietsub · 2026',updatedAt:'2026-11-01'},{id:'mid',year:2024}];
 const before=JSON.stringify(items);
 assert.deepEqual(sortCatalogNewest(items).map(x=>x.id),['recent-new-update','recent-old-update','mid','old','unknown']);
 assert.equal(JSON.stringify(items),before);assert.equal(catalogYear({releaseInfo:'4K 2160p · 2025'}),2025);
 assert.deepEqual(sortCatalogNewest([{id:'a',year:2026},{id:'b',year:2026}]).map(x=>x.id),['a','b']);
});

test('KKPhim requests descending release-year order on every page and genre filter',async()=>{
 const {KKphimProvider}=require('../src/providers/kkphim');const p=new KKphimProvider({apiUrl:'https://example.test'});let calls=[];
 p.request=async u=>{calls.push(new URL(u));return {data:{items:[]}}};
 await p.listCatalog('phim-le',{skip:20});await p.listCatalog('phim-le',{genre:'Hành Động',skip:40});
 assert.deepEqual(calls.map(u=>u.searchParams.get('page')),['2','3']);
 for(const u of calls){assert.equal(u.searchParams.get('sort_field'),'year');assert.equal(u.searchParams.get('sort_type'),'desc');}
});


test('Vietnam catalog keeps country constraint for browsing, genre, search and pagination',async()=>{
 const {KKphimProvider}=require('../src/providers/kkphim');const p=new KKphimProvider({apiUrl:'https://example.test',prefix:'kk_'});let calls=[];
 p.request=async url=>{calls.push(new URL(url));return {data:{items:[
 {slug:'vn-movie',name:'VN',type:'single',year:2026,country:[{slug:'viet-nam'}]},
 {slug:'foreign',name:'Foreign',type:'single',country:[{slug:'han-quoc'}]},
 {slug:'vn-series',name:'Series',type:'series',country:[{slug:'viet-nam'}]}
 ]}}};
 for(const extra of [{},{genre:'Hài Hước',skip:20},{search:'Mai',skip:40}]){
 const list=await p.listCatalog('viet-nam',extra);assert.deepEqual(list.map(m=>m.id),['kk_vn-movie']);
 }
 assert.deepEqual(calls.map(u=>u.searchParams.get('page')),['1','2','3']);
 for(const u of calls){assert.equal(u.searchParams.get('country'),'viet-nam');assert.equal(u.searchParams.get('sort_type'),'desc');}
 assert.equal(calls[1].searchParams.get('category'),'hai-huoc');assert.equal(calls[2].searchParams.get('keyword'),'Mai');
 const {buildManifest}=require('../src/manifest');assert.ok(buildManifest('https://test.example').catalogs.some(c=>c.id==='kkphim-viet-nam'&&c.type==='movie'));
});
