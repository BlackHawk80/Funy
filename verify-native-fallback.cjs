'use strict';
const assert=require('node:assert/strict'),r=require('./rophim-source');
const source={type:'movie',name:'Con Đường Trừ Bạo',original:'The Scavenger',year:2026,countries:['Trung Quốc'],season:null};
const movie={slug:'con-duong-tru-bao',name:source.name,origin_name:source.original,type:'single',year:2026,country:[{slug:'trung-quoc',name:'Trung Quốc'}],imdb:{id:null},episodes:[{server_name:'Vietsub',server_data:[{name:'Full',link_m3u8:'https://cdn.example/full.m3u8'}]}]};
assert(r.matchesNative(movie,source));
for(const patch of [{year:2025},{name:'Different'},{origin_name:'Different'},{type:'series'},{country:[{slug:'viet-nam',name:'Việt Nam'}]}])assert(!r.matchesNative({...movie,...patch},source));
const series={...movie,type:'series',tmdb:{season:1}};assert(r.matchesNative(series,{...source,type:'series'}));assert(!r.matchesNative({...series,tmdb:{season:2}},{...source,type:'series'}));assert(!r.matchesNative({...series,tmdb:{}},{...source,type:'series'}));
(async()=>{
 global.fetch=async url=>({ok:true,json:async()=>url.includes('tim-kiem')?{data:{items:[movie]}}:{movie,episodes:movie.episodes}});
 assert.equal((await r.nativeStreams(source,null))[0].url,'https://cdn.example/full.m3u8');
 const ambiguous={...source,name:'Ambiguous'};global.fetch=async()=>({ok:true,json:async()=>({data:{items:[{...movie,name:'Ambiguous'},{...movie,name:'Ambiguous',slug:'another'}]}})});
 assert.deepEqual(await r.nativeStreams(ambiguous,null),[]);
 console.log('PASS no-IMDb exact native fallback, wrong year/title/original/country/type/season and ambiguity rejected');
})().catch(e=>{console.error(e);process.exitCode=1});
