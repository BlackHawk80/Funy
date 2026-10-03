'use strict';
const fs=require('fs');
const ROOT='https://asian-movies-v0121-auto.onrender.com';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function getJson(url,tries=10){
 let last;
 for(let i=0;i&lt;tries;i++){
  try{const r=await fetch(url,{headers:{accept:'application/json','user-agent':'Mozilla/5.0'}});if(r.ok)return await r.json();last=new Error('HTTP '+r.status)}catch(e){last=e}
  await sleep(1000+i*500);
 }
 throw last||new Error('fetch failed');
}
async function all(type,id){
 const out=[],seen=new Set();
 for(let skip=0;skip&lt;400;skip+=50){
  const j=await getJson(ROOT+'/catalog/'+type+'/'+id+(skip?'/skip='+skip:'')+'.json');
  const a=Array.isArray(j.metas)?j.metas:[];
  for(const m of a)if(m&amp;&amp;m.id&amp;!seen.has(m.id)){seen.add(m.id);out.push(m)}
  if(a.length&lt;50)break;
 }
 return out;
}
function clean(s=''){return String(s).replace(/&lt;[^&gt;]+&gt;/g,' ').replace(/&amp;amp;/g,'&amp;').replace(/&amp;#39;/g,"'").replace(/&amp;&quot;/g,'"').replace(/\s+/g,' ').trim()}
function norm(s=''){return clean(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b(?:phan|season)\s*\d+\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim()}
function score(q,c){const a=norm(q),b=norm(c);if(!a||!b)return 0;if(a===b)return 1;if(a.includes(b)||b.includes(a))return .9;const A=new Set(a.split(' ')),B=new Set(b.split(' '));let n=0;for(const x of A)if(B.has(x))n++;return n/Math.max(A.size,B.size)}
function kind(type,x){const q=String(x.qid||x.q||'').toLowerCase();return type==='series'?(q.includes('tvseries')||q.includes('tvminiseries')||q.includes('tv series')||q.includes('tv mini')):(q==='movie'||q.includes('feature')||q.includes('tv movie')||q.includes('video'))}
function parse(html){
 const out=[];
 for(const m of html.matchAll(/&lt;li class="item no-margin-left1 cinema-card-item"&gt;([\s\S]*?)&lt;\/li&gt;/gi)){
  const b=m[1],url=(b.match(/class="card-img-link" href="([^"]+)"/i)||[])[1]||'';
  const ta=(b.match(/&lt;h3 class="name-title"&gt;[\s\S]*?&lt;a[^&gt;]*title="([^"]+)"/i)||[])[1]||'';
  const name=clean((b.match(/&lt;h3 class="name-title"&gt;[\s\S]*?&lt;a[^&gt;]*&gt;([\s\S]*?)&lt;\/a&gt;/i)||[])[1]||'');
  const original=clean((b.match(/&lt;span class="original-title-home"&gt;([\s\S]*?)&lt;\/span&gt;/i)||[])[1]||'');
  const episode=clean((b.match(/&lt;span class="badge-episode"&gt;([\s\S]*?)&lt;\/span&gt;/i)||[])[1]||'');
  const y=(ta.match(/(19|20)\d{2}\s*$/)||[])[0]||'';
  if(url&amp;&amp;name)out.push({url,name,original,episode,year:y.trim()});
 }
 return out;
}
async function suggest(type,it){
 for(const q of [it.original,it.name].filter(Boolean)){
  try{
   const r=await fetch('https://v3.sg.media-imdb.com/suggestion/x/'+encodeURIComponent(q)+'.json',{headers:{'user-agent':'Mozilla/5.0','accept':'application/json'}});
   if(!r.ok)continue;const j=await r.json(),a=Array.isArray(j.d)?j.d:[],y=Number(it.year||0);
   const c=a.filter(x=>/^tt\d+$/.test(x.id||'')&amp;&amp;kind(type,x)).map(x=>({x,s:Math.max(score(q,x.l||''),score(it.name,x.l||''),score(it.original,x.l||'')),yd:y&amp;&amp;x.y?Math.abs(Number(x.y)-y):0})).filter(z=>z.s&gt;=.5&amp;&amp;(z.yd&lt;=1||!y||!z.x.y)).sort((a,b)=>(b.s-a.s)||(a.yd-b.yd));
   if(c[0])return c[0].x;
  }catch{}
 }
 return null;
}
async function mapVN(it){
 const pref=/tập/i.test(it.episode)?['series','movie']:['movie','series'];
 for(const type of pref){
  const x=await suggest(type,it);if(!x)continue;
  try{
   const r=await fetch('https://v3-cinemeta.strem.io/meta/'+type+'/'+x.id+'.json');if(!r.ok)continue;
   const j=await r.json(),m=j.meta;if(!m)continue;
   const c=String(m.country||'').toLowerCase(),l=String(m.language||'').toLowerCase();
   if(!c.includes('vietnam')&amp;!c.includes('viet nam')&amp;!l.includes('vietnamese'))continue;
   return {id:x.id,type,name:it.name,poster:m.poster||('https://images.metahub.space/poster/medium/'+x.id+'/img'),posterShape:'poster',background:m.background,description:m.description,releaseInfo:m.releaseInfo||it.year,imdbRating:m.imdbRating,genres:m.genres,runtime:m.runtime,language:m.language,country:m.country};
  }catch{}
 }
 return null;
}
async function mapLimit(a,n,fn){const out=new Array(a.length);let i=0;async function w(){while(true){const k=i++;if(k&gt;=a.length)return;out[k]=await fn(a[k])}}await Promise.all(Array.from({length:Math.min(n,a.length)},w));return out}
(async()=>{
 let movie=[],series=[];
 for(let attempt=0;attempt&lt;5;attempt++){
  try{movie=await all('movie','asia-movie-v0121');series=await all('series','asia-series-v0121');if(movie.length&gt;=40&amp;&amp;series.length&gt;=50)break}catch{}
  await sleep(6000);
 }
 if(movie.length&lt;20||series.length&lt;20)throw new Error('Asian seed incomplete '+movie.length+'/'+series.length);
 let items=[];
 try{
  for(let p=1;p&lt;=3;p++){
   const u='https://zonaparfum.com/quoc-gia/viet-nam'+(p&gt;1?'/page/'+p:'');
   const r=await fetch(u,{headers:{'user-agent':'Mozilla/5.0','accept-language':'vi-VN,vi;q=0.9'}});
   if(!r.ok)continue;items.push(...parse(await r.text()));
  }
 }catch(e){console.log('VN seed crawl error',e.message)}
 const seen=new Set();items=items.filter(x=>x.url&amp;!seen.has(x.url)&amp;&amp;(seen.add(x.url),1));
 const mapped=(await mapLimit(items,10,mapVN)).filter(Boolean);
 const vnMovie=mapped.filter(x=>x.type==='movie'),vnSeries=mapped.filter(x=>x.type==='series');
 fs.writeFileSync('seed-v013.json',JSON.stringify({movie,series,vnMovie,vnSeries}));
 console.log('SEED V013',movie.length,series.length,'VN',vnMovie.length,vnSeries.length);
})().catch(e=>{console.error(e);process.exit(1)});
