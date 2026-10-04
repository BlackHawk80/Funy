'use strict';
// rophimhd.com's public web client uses these phimapi.com endpoints.
const API='https://phimapi.com';
const COUNTRIES=['viet-nam','trung-quoc','han-quoc','nhat-ban','thai-lan','hong-kong','dai-loan','an-do','philippines','indonesia','malaysia','singapore'];
const links=new Map(),cache=new Map();
let lastStream='not requested';
const validSlug=s=>typeof s==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)&&s.length<240;
const typeOf=m=>m.type==='single'?'movie':m.type==='series'?'series':m.type==='hoathinh'?(m.tmdb?.type==='movie'?'movie':m.tmdb?.type==='tv'?'series':null):null;
const asian=m=>Array.isArray(m.country)&&m.country.some(c=>COUNTRIES.includes(c.slug));
function parseRequest(type,id){
 const m=String(id).match(type==='movie'?/^(tt\d+)$/ : /^(tt\d+):(\d+):(\d+)$/);
 if(!m||!['movie','series'].includes(type))return null;
 const season=type==='series'?Number(m[2]):null,episode=type==='series'?Number(m[3]):null;
 if(type==='series'&&(!Number.isSafeInteger(season)||season<1||!Number.isSafeInteger(episode)||episode<1))return null;
 return {type,id:m[1],season,episode};
}
async function json(path){
 const c=new AbortController(),t=setTimeout(()=>c.abort(),12000);
 try{const r=await fetch(API+path,{signal:c.signal,headers:{accept:'application/json'}});if(!r.ok)throw Error('HTTP '+r.status);const j=await r.json();if(j.status===false)throw Error('upstream rejected request');return j}finally{clearTimeout(t)}
}
async function cached(key,fn){
 const old=cache.get(key);if(old&&old.until>Date.now())return old.promise;
 const entry={until:Date.now()+5*60e3,promise:null};
 entry.promise=Promise.resolve().then(fn).catch(e=>{if(cache.get(key)===entry)cache.delete(key);throw e});
 cache.set(key,entry);while(cache.size>200)cache.delete(cache.keys().next().value);
 return entry.promise;
}
function remember(m){
 const type=typeOf(m),id=m.imdb?.id,season=type==='series'?Number(m.tmdb?.season):null;
 if(!type||!/^tt\d+$/.test(id||'')||!validSlug(m.slug)||!asian(m))return;
 if(type==='series'&&(!Number.isSafeInteger(season)||season<1))return;
 const key=type+':'+id,arr=links.get(key)||[];
 const item={slug:m.slug,season};
 links.set(key,[...arr.filter(x=>x.slug!==item.slug),item].slice(-12));
 while(links.size>10000)links.delete(links.keys().next().value);
}
function restore(saved){
 if(!saved||typeof saved!=='object'||Array.isArray(saved))return;
 for(const [key,arr] of Object.entries(saved).slice(0,10000)){
  if(!/^(movie|series):tt\d+$/.test(key)||!Array.isArray(arr))continue;
  const good=arr.filter(x=>x&&validSlug(x.slug)&&(key.startsWith('movie:')?x.season===null:Number.isSafeInteger(x.season)&&x.season>0)).slice(-12);
  if(good.length)links.set(key,good);
 }
}
async function detail(slug){
 return cached('detail:'+slug,async()=>{
  const results=await Promise.allSettled(['/v1/api/phim/','/phim/'].map(async prefix=>{
   const j=await json(prefix+encodeURIComponent(slug)),m=j.data?.item||j.movie;
   if(!m||m.slug!==slug)throw Error('invalid movie detail');
   return {...m,episodes:m.episodes||j.episodes||[]};
  }));
  const good=results.filter(x=>x.status==='fulfilled').map(x=>x.value);
  if(!good.length)throw results[0].reason;
  return good;
 });
}
function episodeNumber(e){
 for(const value of [e.name,e.slug]){
  const m=String(value||'').trim().match(/^(?:(?:tập|tap|episode|ep)[\s-]*)?0*(\d+)$/i);
  if(m)return Number(m[1]);
 }
 return null;
}
function streamsFor(m,req){
 if(m.imdb?.id!==req.id||typeOf(m)!==req.type||!asian(m))return [];
 if(req.type==='series'&&Number(m.tmdb?.season)!==req.season)return [];
 const streams=[],seen=new Set();
 for(const server of Array.isArray(m.episodes)?m.episodes:[]){
  for(const ep of Array.isArray(server.server_data)?server.server_data:[]){
   const full=/^(full|hoàn tất|hoan tat)$/i.test(String(ep.name||ep.slug||'').trim());
   if(req.type==='movie'?!full:episodeNumber(ep)!==req.episode)continue;
   let u;try{u=new URL(ep.link_m3u8)}catch{continue}
   if(u.protocol!=='https:'||u.username||u.password||!u.pathname.endsWith('.m3u8')||seen.has(u.href))continue;
   seen.add(u.href);
   const domestic=u.hostname==='kvp726.com'||u.hostname.endsWith('.kvp726.com');
   streams.push({name:'RoPhimHD · '+(m.quality||'HLS'),title:[m.name,server.server_name,domestic?'Yêu cầu mạng Việt Nam':null,req.type==='series'?'Mùa '+req.season+' · Tập '+req.episode:'Phim lẻ'].filter(Boolean).join('\n'),url:u.href,behaviorHints:{notWebReady:true,...(domestic?{countryWhitelist:['vnm']}:{}),bingeGroup:'rophimhd-'+String(server.server_name||'default')}});
  }
 }
 return streams;
}
async function streams(type,id,getMeta){
 const req=parseRequest(type,id);if(!req)return [];
 try{
  return await cached('stream:'+type+':'+id,async()=>{
   const key=type+':'+req.id;
   let candidates=(links.get(key)||[]).filter(x=>type==='movie'||x.season===req.season);
   if(!candidates.length){
    const m=await getMeta(type,req.id);if(!m)return [];
    for(const name of [...new Set([m.name,m.originalName].filter(Boolean))].slice(0,2)){
     const j=await json('/v1/api/tim-kiem?keyword='+encodeURIComponent(name)+'&limit=24');
     for(const item of j.data?.items||j.items||[]){if(item.imdb?.id===req.id&&typeOf(item)===type)remember(item)}
    }
    candidates=(links.get(key)||[]).filter(x=>type==='movie'||x.season===req.season);
   }
   const results=await Promise.allSettled(candidates.slice(0,4).map(async x=>(await detail(x.slug)).flatMap(m=>streamsFor(m,req))));
   if(results.length&&results.every(x=>x.status==='rejected'))throw results[0].reason;
   const all=results.filter(x=>x.status==='fulfilled').flatMap(x=>x.value);
   const unique=[...new Map(all.map(x=>[x.url,x])).values()];
   lastStream=unique.length?'ok '+new Date().toISOString():'no exact IMDb/season/episode match';
   return unique;
  });
 }catch(e){lastStream='error '+e.message;console.error('ROPHIM STREAM',e.message);return []}
}
async function refresh({mapTitle,meta,decorate,isAsian,isVietnam,merge,mapLimit}){
 const found=new Map();let errors=0;
 for(const country of COUNTRIES){
  const pages=country==='viet-nam'?3:1;
  for(let page=1;page<=pages;page++){
   try{
    const j=await json('/v1/api/quoc-gia/'+country+'?page='+page+'&limit=24'),items=j.data?.items||j.items||[];
    if(!items.length)break;
    for(const m of items)if(validSlug(m.slug)&&typeOf(m)&&asian(m)){found.set(m.slug,m);remember(m)}
   }catch(e){errors++;console.error('ROPHIM CATALOG',country,e.message);break}
  }
 }
 if(!found.size)throw Error('no catalog data; retained previous entries');
 const good=(await mapLimit([...found.values()],8,async m=>{
  const type=typeOf(m),it={name:m.name,original:m.origin_name,year:m.year};
  if(/^tt\d+$/.test(m.imdb?.id||'')){
   const cm=await meta(type,m.imdb.id);
   return cm&&isAsian(cm)?decorate(type,m.imdb.id,m.name,m.year,cm):null;
  }
  return mapTitle(type,it,false);
 })).filter(Boolean);
 if(!good.length)throw Error('no verified Asian IMDb metadata; retained previous entries');
 let added=0;
 for(const type of ['movie','series']){
  const a=good.filter(x=>x.type===type);added+=merge(type,a);merge(type==='movie'?'vnMovie':'vnSeries',a.filter(isVietnam));
 }
 const status='ok via phimapi.com; scanned '+found.size+', mapped '+good.length+', added '+added+(errors?', failed pages '+errors:'');
 console.log('ROPHIM SYNC',status);
 return {added,status};
}
module.exports={refresh,streams,restore,snapshot:()=>Object.fromEntries(links),health:()=>({indexedTitles:links.size,lastStream}),parseRequest,streamsFor,episodeNumber,remember};
