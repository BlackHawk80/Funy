'use strict';
const http=require('http'),{URL}=require('url');
const fs=require('fs'),path=require('path');
const SEED=require('./seed-v013.json');
const rophim=require('./rophim-source');
const nguonc=require('./nguonc-source');
const CACHE=path.join(__dirname,'catalog-cache.json');
const SYNC_MS=6*3600e3;
let syncDeadline=0;
const PORT=Number(process.env.PORT||10000);
const CIN='https://v3-cinemeta.strem.io';
const ZONA='https://zonaparfum.com';
const ASIA=['china','hong kong','taiwan','macao','macau','south korea','korea','japan','thailand','vietnam','viet nam','philippines','indonesia','malaysia','singapore','india','pakistan','bangladesh','nepal','sri lanka','mongolia','cambodia','laos','myanmar','brunei','bhutan','maldives','kazakhstan','uzbekistan','kyrgyzstan','tajikistan','turkmenistan','afghanistan'];
const LANG=['chinese','mandarin','cantonese','korean','japanese','thai','vietnamese','tagalog','filipino','indonesian','malay','hindi','tamil','telugu','bengali','urdu'];
const CATS=[
 {type:'movie',id:'asia-movie-v013',name:'Châu Á - Phim lẻ',key:'movie'},
 {type:'series',id:'asia-series-v013',name:'Châu Á - Phim bộ',key:'series'},
 {type:'movie',id:'vn-movie-v013',name:'Việt Nam - Phim lẻ',key:'vnMovie'},
 {type:'series',id:'vn-series-v013',name:'Việt Nam - Phim bộ',key:'vnSeries'}
];
const manifest={id:'community.asian.movies.v013',version:'0.17.0',name:'Asian Movies v0.17.0',
 description:'Danh mục phim Châu Á và Việt Nam, dùng IMDb ID. Tự đồng bộ iQIYI, ZonaParfum, RoPhimHD (phimapi.com) và NguonC mỗi 6 giờ; giữ dữ liệu cũ khi nguồn lỗi. Nguồn RoPhimHD HLS cho phim khớp IMDb và mùa/tập.',
 resources:[{name:'catalog',types:['movie','series']},{name:'stream',types:['movie','series'],idPrefixes:['tt']}],types:['movie','series'],idPrefixes:['tt'],
 catalogs:CATS.map(x=>({type:x.type,id:x.id,name:x.name,extra:[{name:'search',isRequired:false},{name:'skip',isRequired:false}]}))
};
let STATE={movie:SEED.movie||[],series:SEED.series||[],vnMovie:SEED.vnMovie||[],vnSeries:SEED.vnSeries||[]};
let syncing=null,lastAttempt=0,lastSuccess=0;
let status={nguonc:'awaiting live sync',iqiyi:'seed',zona:'seed',rophim:'awaiting live sync',lastSuccess:'never'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function send(res,s,o){res.writeHead(s,{'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*','access-control-allow-headers':'*','cache-control':'no-store'});res.end(JSON.stringify(o))}
function clean(s=''){return String(s).replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim()}
function norm(s=''){return clean(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/đ/g,'d').replace(/\b(?:phan|season)\s*\d+\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim()}
function score(q,c){const a=norm(q),b=norm(c);if(!a||!b)return 0;if(a===b)return 1;if(a.includes(b)||b.includes(a))return .9;const A=new Set(a.split(' ')),B=new Set(b.split(' '));let n=0;for(const x of A)if(B.has(x))n++;return n/Math.max(A.size,B.size)}
function kind(type,x){const q=String(x.qid||x.q||'').toLowerCase();return type==='series'?(q.includes('tvseries')||q.includes('tvminiseries')||q.includes('tv series')||q.includes('tv mini')):(q==='movie'||q.includes('feature')||q.includes('tv movie')||q.includes('video'))}
async function getJson(url,timeout=12000){
 if(syncDeadline&&Date.now()>syncDeadline)throw Error('sync time limit');
 const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);
 try{const r=await fetch(url,{headers:{accept:'application/json','user-agent':'Mozilla/5.0'},signal:c.signal});if(!r.ok)throw Error('HTTP '+r.status);return await r.json()}finally{clearTimeout(t)}
}
async function getText(url,timeout=12000){
 if(syncDeadline&&Date.now()>syncDeadline)throw Error('sync time limit');
 const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);
 try{const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36','accept-language':'vi-VN,vi;q=0.9,en;q=0.7','accept':'text/html,*/*'},signal:c.signal});if(!r.ok)throw Error('HTTP '+r.status);return await r.text()}finally{clearTimeout(t)}
}
async function mapLimit(a,n,fn){const out=new Array(a.length);let i=0;async function w(){while(true){const k=i++;if(k>=a.length||(syncDeadline&&Date.now()>syncDeadline))return;out[k]=await fn(a[k])}}await Promise.all(Array.from({length:Math.min(n,a.length)},w));return out}
function isAsian(m){const c=String(m.country||'').toLowerCase(),l=String(m.language||'').toLowerCase();return ASIA.some(x=>c.includes(x))||LANG.some(x=>l.includes(x))}
function isVietnam(m){const c=String(m.country||'').toLowerCase(),l=String(m.language||'').toLowerCase();return c.includes('vietnam')||c.includes('viet nam')||l.includes('vietnamese')}
async function meta(type,id){
 try{const j=await getJson(CIN+'/meta/'+type+'/'+id+'.json',7000);return j&&j.meta||null}catch{return null}
}
function decorate(type,id,name,srcYear,m){
 return {id,type,name:name||m.name,poster:m.poster||('https://images.metahub.space/poster/medium/'+id+'/img'),posterShape:'poster',background:m.background,description:m.description,releaseInfo:m.releaseInfo||srcYear,imdbRating:m.imdbRating,genres:m.genres,runtime:m.runtime,language:m.language,country:m.country};
}
function merge(key,items){
 const records=new Map((STATE[key]||[]).map(x=>[x.id,x]));let added=0;
 for(const x of items){
  if(!x||!/^tt\d+$/.test(x.id||'')||x.type!==(key.toLowerCase().includes('movie')?'movie':'series')||!isAsian(x)||(key.startsWith('vn')&&!isVietnam(x)))continue;
  if(!records.has(x.id))added++;
  // Updating metadata must not move an existing title across pagination boundaries.
  records.set(x.id,{...records.get(x.id),...x});
 }
 STATE[key]=[...records.values()];return added;
}
async function suggest(type,it){
 for(const q of [it.original,it.name].filter(Boolean)){
  try{
   const j=await getJson('https://v3.sg.media-imdb.com/suggestion/x/'+encodeURIComponent(q)+'.json',7000),a=Array.isArray(j.d)?j.d:[],y=Number(it.year||0);
   const c=a.filter(x=>/^tt\d+$/.test(x.id||'')&&kind(type,x)).map(x=>({x,s:Math.max(score(q,x.l||''),score(it.name,x.l||''),score(it.original,x.l||'')),yd:y&&x.y?Math.abs(Number(x.y)-y):0})).filter(z=>z.s>=.85&&(z.yd<=1||!y||!z.x.y)).sort((a,b)=>(b.s-a.s)||(a.yd-b.yd));
   if(c[0]&&(!c[1]||c[0].s>c[1].s||c[0].yd<c[1].yd))return c[0].x;
  }catch{}
 }
 return null;
}
async function mapTitle(type,it,requireVietnam=false){
 const x=await suggest(type,it);if(!x)return null;
 const m=await meta(type,x.id);if(!m)return null;
 if(requireVietnam?!isVietnam(m):!isAsian(m))return null;
 return decorate(type,x.id,it.name,it.year,m);
}
function collectIq(v,out,seen){
 if(!v||typeof v!=='object')return;
 if(Array.isArray(v)){for(const x of v)collectIq(x,out,seen);return}
 const kv=v.kv_pair||{},title=typeof v.title==='string'?v.title.trim():'',qid=String(kv.qipu_id||kv.album_id||kv.tv_id||'');
 if(title&&qid&&(kv.loc_suffix_album||kv.album_id||kv.channel_id)){
  if(!seen.has(qid)){seen.add(qid);out.push({name:title,original:title,year:String(kv.year||'').match(/\d{4}/)?.[0]||''})}
 }
 for(const x of Object.values(v))if(x&&typeof x==='object')collectIq(x,out,seen);
}
async function iqPage(type,pn){
 const p=new URLSearchParams({app_k:'appk_pcw',app_lm:'sg',app_t:'i18nvideo',app_v:'3.1.5',card_v:'v1',dev_os:'pc',dev_ua:'Mozilla/5.0',lang:'vi_vn',mod:'sg',net_sts:'1',page_st:type==='movie'?'movie_web':'drama_web',platform_id:'47',psp_cki:'',psp_status:'-1',psp_uid:'',qyid:'00000000000000000000000000000000',req_sn:String(Date.now()),req_times:'1',secure_p:'pcw',secure_v:'1',sid:'NaN',timezone:'GMT+8',pg_size:'4',channel_id:type==='movie'?'1':'2',customized:'1',pg_num:String(pn)});
 return await getJson('https://api.iq.com/page/pcw_common?'+p.toString(),12000);
}
async function refreshIq(){
 let added=0,seenTotal=0,mappedTotal=0;
 for(const type of ['movie','series']){
  const found=[],seen=new Set();
  for(let pn=1;pn<=5;pn++){const j=await iqPage(type,pn);if(j.code!==0)throw Error('iQIYI code '+j.code);collectIq(j,found,seen)}
  const uniq=found.slice(0,180);
  if(!uniq.length)throw Error('iQIYI returned no titles');
  const good=(await mapLimit(uniq,12,x=>mapTitle(type,x,false))).filter(Boolean);
  const d=new Map();for(const x of good)if(!d.has(x.id))d.set(x.id,x);
  const arr=[...d.values()];seenTotal+=uniq.length;mappedTotal+=arr.length;added+=merge(type,arr);
  console.log('V013 IQ',type,'found',uniq.length,'asian',arr.length,'total',STATE[type].length);
 }
 if(!mappedTotal)throw Error('iQIYI: no verified Asian titles; retained catalog');
 status.iqiyi='ok found '+seenTotal+', asian '+mappedTotal+', added '+added;
 return added;
}
function parseZona(html){
 const out=[];
 for(const m of html.matchAll(/<li class="item no-margin-left1 cinema-card-item">([\s\S]*?)<\/li>/gi)){
  const b=m[1],url=(b.match(/class="card-img-link" href="([^"]+)"/i)||[])[1]||'';
  const ta=(b.match(/<h3 class="name-title">[\s\S]*?<a[^>]*title="([^"]+)"/i)||[])[1]||'';
  const name=clean((b.match(/<h3 class="name-title">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)||[])[1]||'');
  const original=clean((b.match(/<span class="original-title-home">([\s\S]*?)<\/span>/i)||[])[1]||'');
  const episode=clean((b.match(/<span class="badge-episode">([\s\S]*?)<\/span>/i)||[])[1]||'');
  const y=(ta.match(/(19|20)\d{2}\s*$/)||[])[0]||'';
  if(url&&name)out.push({url,name,original,episode,year:y.trim()});
 }
 return out;
}
async function zonaItems(country,pages){
 const out=[],seen=new Set();
 for(let p=1;p<=pages;p++){
  try{
   const u=ZONA+'/quoc-gia/'+country+(p>1?'/page/'+p:'');
   const a=parseZona(await getText(u,12000));
   if(!a.length)break;
   for(const x of a)if(!seen.has(x.url)){seen.add(x.url);out.push(x)}
  }catch(e){console.log('V013 ZONA page error',country,p,e.message);break}
 }
 return out;
}
async function mapZonaItem(it,isVN){
 const pref=/tập/i.test(it.episode)?['series','movie']:['movie','series'];
 for(const type of pref){const x=await mapTitle(type,it,isVN);if(x)return x}
 return null;
}
async function refreshZona(){
 const configs=[['viet-nam',9,true],['trung-quoc',1,false],['han-quoc',1,false],['nhat-ban',1,false],['thai-lan',1,false],['hong-kong',1,false],['dai-loan',1,false],['philippines',1,false]];
 let added=0,scanned=0,mapped=0,vnMapped=0;
 for(const [country,pages,isVN] of configs){
  if(syncDeadline&&Date.now()>syncDeadline)throw Error('sync time limit');
  const items=await zonaItems(country,pages);scanned+=items.length;
  const good=(await mapLimit(items,10,x=>mapZonaItem(x,isVN))).filter(Boolean);mapped+=good.length;
  const mv=good.filter(x=>x.type==='movie'),sr=good.filter(x=>x.type==='series');
  added+=merge('movie',mv)+merge('series',sr);
  if(isVN){vnMapped=good.length;merge('vnMovie',mv);merge('vnSeries',sr)}
  console.log('V013 ZONA',country,'items',items.length,'mapped',good.length,'movie',mv.length,'series',sr.length);
  await sleep(150);
 }
 if(!scanned||!mapped)throw Error('ZonaParfum: no verified titles; retained catalog');
 status.zona='ok scanned '+scanned+', mapped '+mapped+', VN '+vnMapped+', added '+added;
 return added;
}
async function sync(){
 if(syncing)return syncing;
 syncing=(async()=>{
  lastAttempt=Date.now();syncDeadline=lastAttempt+8*60e3;let total=0,ok=0;
  try{const r=await nguonc.refresh({mapTitle,meta,isAsian,isVietnam,merge,mapLimit});total+=r.added;status.nguonc=r.status;ok++}catch(e){status.nguonc='error '+e.message;console.log('NGUONC ERROR',e.message)}
  try{const r=await rophim.refresh({mapTitle,meta,decorate,isAsian,isVietnam,merge,mapLimit});total+=r.added;status.rophim=r.status;ok++}catch(e){status.rophim='error '+e.message;console.log('ROPHIM ERROR',e.message)}
  try{total+=await refreshIq();ok++}catch(e){status.iqiyi='error '+e.message;console.log('V013 IQ ERROR',e.message)}
  try{total+=await refreshZona();ok++}catch(e){status.zona='error '+e.message;console.log('V013 ZONA ERROR',e.message)}
  if(ok){lastSuccess=Date.now();status.lastSuccess=new Date(lastSuccess).toISOString()}
  await saveState();
  console.log('SYNC DONE','added',total,'asia',STATE.movie.length,STATE.series.length,'vn',STATE.vnMovie.length,STATE.vnSeries.length);
 })().finally(()=>{syncing=null;syncDeadline=0});
 return syncing;
}
function maybeSync(){if(!syncing&&Date.now()-lastAttempt>SYNC_MS)sync().catch(()=>{})}
function extra(raw=''){return Object.fromEntries(new URLSearchParams(raw))}
function list(key,raw){const e=extra(raw);let a=(STATE[key]||[]).slice();if(e.search){const q=norm(e.search);a=a.filter(x=>norm(x.name||'').includes(q))}const skip=Math.max(0,Math.floor(Number(e.skip||0)||0));return a.slice(skip,skip+50)}
let storageStatus='snapshot';
const {redisGet,redisSet}=require('./catalog-storage');
async function restoreState(){
 const seed={...STATE};STATE={movie:[],series:[],vnMovie:[],vnSeries:[]};
 for(const key of Object.keys(STATE))merge(key,seed[key]||[]);
 let cached=null;
 try{cached=JSON.parse(fs.readFileSync(CACHE,'utf8'));storageStatus='local cache'}catch{}
 try{const remote=await redisGet();if(remote){cached=JSON.parse(remote);storageStatus='redis'}}catch(e){storageStatus='redis unavailable; using snapshot/cache';console.error('Restore:',e.message)}
 if(cached){nguonc.restore(cached.nguoncLinks);rophim.restore(cached.rophimLinks);for(const key of Object.keys(STATE))merge(key,cached.catalogs?.[key]||[]);if(cached.lastSuccess)status.lastSuccess=cached.lastSuccess}
}
async function saveState(){
 const body=JSON.stringify({catalogs:STATE,nguoncLinks:nguonc.snapshot(),rophimLinks:rophim.snapshot(),lastSuccess:status.lastSuccess,savedAt:new Date().toISOString()});
 try{fs.writeFileSync(CACHE+'.tmp',body);fs.renameSync(CACHE+'.tmp',CACHE)}catch(e){console.error('Cache:',e.message)}
 try{if(await redisSet(body))storageStatus='redis';else storageStatus='local cache; deploy fallback is committed snapshot'}catch(e){storageStatus='redis unavailable; local cache';console.error('Persist:',e.message)}
}
const server=http.createServer(async(req,res)=>{try{
 if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-headers':'*'});return res.end()}
 const u=new URL(req.url,'http://x');if(process.env.DISABLE_SYNC!=='1')maybeSync();
 if(u.pathname==='/manifest.json')return send(res,200,manifest);
 if(u.pathname==='/'||u.pathname==='/health')return send(res,200,{ok:true,version:manifest.version,counts:{movie:STATE.movie.length,series:STATE.series.length,vnMovie:STATE.vnMovie.length,vnSeries:STATE.vnSeries.length},syncing:!!syncing,lastAttempt:lastAttempt?new Date(lastAttempt).toISOString():'never',lastSuccess:status.lastSuccess,sourceStatus:{nguonc:status.nguonc,iqiyi:status.iqiyi,zona:status.zona,rophim:status.rophim},storage:storageStatus,nguonc:nguonc.health(),rophim:rophim.health()});
 const stream=u.pathname.match(/^\/stream\/(movie|series)\/([^/]+)\.json$/);
 if(stream){
  let id;try{id=decodeURIComponent(stream[2])}catch{return send(res,400,{streams:[]})}
  const metadata=new Map();
  const lookup=(type,imdb)=>{
   const key=type+':'+imdb;if(metadata.has(key))return metadata.get(key);
   const value=(async()=>{const local=STATE[type].find(x=>x.id===imdb),remote=await meta(type,imdb);
    if(!isAsian(remote||local||{}))return null;
    return local?{...local,originalName:remote?.name}:remote;
   })();metadata.set(key,value);return value;
  };
  const results=await Promise.allSettled([rophim.streams(stream[1],id,lookup),nguonc.streams(stream[1],id,lookup)]);
  const combined=results.filter(x=>x.status==='fulfilled').flatMap(x=>x.value);
  return send(res,200,{streams:[...new Map(combined.map(x=>[x.url,x])).values()]});
 }
 const m=u.pathname.match(/^\/catalog\/(movie|series)\/([^/]+)(?:\/([^/]+))?\.json$/);
 if(!m)return send(res,404,{error:'not_found'});
 const [,type,id,raw='']=m,c=CATS.find(x=>x.type===type&&x.id===id);
 return send(res,200,{metas:c?list(c.key,raw):[]});
}catch(e){console.error(e);return send(res,500,{error:'server_error'})}});
async function start(){await restoreState();server.listen(PORT,'0.0.0.0',()=>{
 console.log(manifest.name,'live',PORT,'seed',STATE.movie.length,STATE.series.length,'VN',STATE.vnMovie.length,STATE.vnSeries.length);
 if(process.env.DISABLE_SYNC!=='1'){setTimeout(()=>sync().catch(console.error),1500);setInterval(()=>sync().catch(console.error),SYNC_MS).unref()}
});}
if(require.main===module)start().catch(e=>{console.error(e);process.exit(1)});
module.exports={manifest,extra,norm,isAsian,isVietnam,merge,list,start,server};