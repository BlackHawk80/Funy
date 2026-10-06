'use strict';
const API='https://phim.nguonc.com';
const {parseRequest,episodeNumber}=require('./rophim-source');
const links=new Map(),cache=new Map();
let lastRequest='not requested',lastStream='not requested',blockedUntil=0;
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/đ/g,'d').replace(/[^a-z0-9]+/g,' ').trim();
const countries=new Set(['viet nam','vietnam','trung quoc','han quoc','nhat ban','thai lan','hong kong','hongkong','dai loan','an do','philippines','indonesia','malaysia','singapore','campuchia','lao','myanmar','mong co','nepal','pakistan','bangladesh','sri lanka']);
const validSlug=s=>typeof s==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)&&s.length<240;
function group(m,name){return Object.values(m.category||{}).filter(x=>norm(x?.group?.name)===norm(name)).flatMap(x=>Array.isArray(x.list)?x.list.map(v=>v.name):[])}
const asian=m=>group(m,'Quốc gia').some(c=>countries.has(norm(c)));
const yearOf=m=>Number(group(m,'Năm')[0])||0;
function typeOf(m){const a=group(m,'Định dạng').map(norm);return a.includes('phim le')?'movie':a.includes('phim bo')?'series':null}
function seasonOf(m){
 const n=Number(m.tmdb?.season);if(Number.isSafeInteger(n)&&n>0)return n;
 const matches=[...String(m.name+' '+(m.original_name||'')).matchAll(/(?:phần|phan|season)\s*(\d+)/gi)].map(x=>Number(x[1]));
 return matches.length&&new Set(matches).size===1&&matches[0]>0?matches[0]:null;
}
function exact(m,meta,type){
 const year=Number(String(meta?.releaseInfo||meta?.year||'').match(/\d{4}/)?.[0]);
 const names=[meta?.name,meta?.originalName].filter(Boolean).map(norm);
 return !!meta&&typeOf(m)===type&&asian(m)&&year>0&&year===yearOf(m)&&[m.name,m.original_name].filter(Boolean).some(n=>names.includes(norm(n)));
}
async function json(path){
 if(Date.now()<blockedUntil)throw Error('HTTP 403; retry after cooldown');
 const old=cache.get(path);if(old&&old.until>Date.now())return old.data;
 const c=new AbortController(),timer=setTimeout(()=>c.abort(),10000);
 try{
  const r=await fetch(API+path,{signal:c.signal,headers:{accept:'application/json'}});
  lastRequest='HTTP '+r.status+' at '+new Date().toISOString();
  if(r.status===403)blockedUntil=Date.now()+5*60e3;
  if(!r.ok)throw Error('HTTP '+r.status);
  if(!r.headers.get('content-type')?.includes('application/json'))throw Error('Expected JSON, received non-JSON response');
  const d=await r.json();if(d.status!=='success')throw Error('upstream rejected request');
  cache.set(path,{until:Date.now()+5*60e3,data:d});while(cache.size>200)cache.delete(cache.keys().next().value);
  return d;
 }catch(e){lastRequest='error '+e.message;throw e}finally{clearTimeout(timer)}
}
async function detail(slug){
 if(!validSlug(slug))throw Error('Invalid slug');
 const m=(await json('/api/film/'+encodeURIComponent(slug))).movie;
 if(!m||m.slug!==slug)throw Error('Invalid detail response');return m;
}
function remember(m,meta,type){
 if(!validSlug(m.slug)||!/^tt\d+$/.test(meta?.id||'')||!exact(m,meta,type))return false;
 const item={slug:m.slug,name:m.name,original:m.original_name||'',year:yearOf(m),season:type==='series'?seasonOf(m):null};
 const key=type+':'+meta.id;links.set(key,[...(links.get(key)||[]).filter(x=>x.slug!==m.slug),item].slice(-12));
 while(links.size>10000)links.delete(links.keys().next().value);return true;
}
function restore(saved){
 if(!saved||typeof saved!=='object'||Array.isArray(saved))return;
 for(const [key,items] of Object.entries(saved).slice(0,10000)){
  if(!/^(movie|series):tt\d+$/.test(key)||!Array.isArray(items))continue;
  const valid=items.filter(x=>x&&validSlug(x.slug)&&typeof x.name==='string'&&typeof x.original==='string'&&Number.isSafeInteger(x.year)&&x.year>1800&&(x.season===null||Number.isSafeInteger(x.season)&&x.season>0)).slice(-12);
  if(valid.length)links.set(key,valid);
 }
}
function streamsFor(m,req,record){
 if(!req||!record||m.slug!==record.slug||!exact(m,{name:record.name,originalName:record.original,year:record.year},req.type))return [];
 if(req.type==='series'&&(seasonOf(m)!==req.season||record.season!==req.season))return [];
 const out=[],seen=new Set();
 for(const server of Array.isArray(m.episodes)?m.episodes:[])for(const ep of Array.isArray(server.items)?server.items:[]){
  if(req.type==='movie'?!/^(full|hoàn tất|hoan tat)$/i.test(String(ep.name||'').trim()):episodeNumber({name:ep.name})!==req.episode)continue;
  let u;try{u=new URL(ep.m3u8||ep.link_m3u8)}catch{continue}
  if(u.protocol!=='https:'||u.username||u.password||!u.pathname.endsWith('.m3u8')||seen.has(u.href))continue;
  seen.add(u.href);out.push({name:'NguonC · HLS',title:[m.name,server.server_name,req.type==='series'?'Mùa '+req.season+' · Tập '+req.episode:'Phim lẻ'].filter(Boolean).join('\n'),url:u.href,behaviorHints:{notWebReady:true,bingeGroup:'nguonc-'+String(server.server_name||'default')}});
 }
 return out;
}
async function streams(type,id,getMeta){
 const req=parseRequest(type,id);if(!req)return [];
 try{
  const key=type+':'+req.id;
  let candidates=(links.get(key)||[]).filter(x=>type==='movie'||x.season===req.season);
  if(!candidates.length){
   const meta=await getMeta(type,req.id);if(!meta)return [];
   for(const name of [...new Set([meta.originalName,meta.name].filter(Boolean))].slice(0,2)){
    const data=await json('/api/films/search?keyword='+encodeURIComponent(name)+'&page=1');
    for(const item of (data.items||[]).slice(0,6)){
     if(!validSlug(item.slug)||![item.name,item.original_name].some(n=>norm(n)===norm(name)))continue;
     const m=await detail(item.slug);remember(m,{...meta,id:req.id},type);
    }
   }
   candidates=(links.get(key)||[]).filter(x=>type==='movie'||x.season===req.season);
  }
  const results=await Promise.allSettled(candidates.slice(0,4).map(async x=>streamsFor(await detail(x.slug),req,x)));
  if(results.length&&results.every(x=>x.status==='rejected'))throw results[0].reason;
  const out=[...new Map(results.filter(x=>x.status==='fulfilled').flatMap(x=>x.value).map(s=>[s.url,s])).values()];
  lastStream=out.length?'ok '+out.length:'no verified direct HLS / exact season and episode';return out;
 }catch(e){lastStream='error '+e.message;return []}
}
async function refresh({mapTitle,meta,isAsian,isVietnam,merge,mapLimit}){
 const found=new Map();
 // Two bounded pages of recent updates; fail early on an unavailable source.
 for(let page=1;page<=2;page++){
  const data=await json('/api/films/phim-moi-cap-nhat?page='+page);
  if(!Array.isArray(data.items)||!data.items.length)break;
  for(const m of data.items)if(validSlug(m.slug))found.set(m.slug,m);
 }
 if(!found.size)throw Error('no catalog data; retained previous entries');
 const good=(await mapLimit([...found.values()].slice(0,48),4,async item=>{
  try{
   const m=await detail(item.slug),type=typeOf(m);if(!type||!asian(m)||!yearOf(m))return null;
   const mapped=await mapTitle(type,{name:m.name,original:m.original_name,year:yearOf(m)},false);
   if(!mapped)return null;
   const cm=await meta(type,mapped.id);if(!cm||!isAsian(cm))return null;
   if(!remember(m,{...cm,id:mapped.id},type))return null;
   return mapped;
  }catch{return null}
 })).filter(Boolean);
 if(!good.length)throw Error('no exact Asian IMDb title/year matches; retained previous entries');
 let added=0;for(const type of ['movie','series']){
  const a=good.filter(m=>m.type===type);added+=merge(type,a);merge(type==='movie'?'vnMovie':'vnSeries',a.filter(isVietnam));
 }
 return {added,status:'ok scanned '+found.size+', verified '+good.length+', added '+added};
}
module.exports={refresh,streams,restore,snapshot:()=>Object.fromEntries(links),health:()=>({indexedTitles:links.size,lastRequest,lastStream}),streamsFor,remember,exact,asian,typeOf,yearOf,seasonOf};
