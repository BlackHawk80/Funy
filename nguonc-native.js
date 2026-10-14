'use strict';
const source=require('./nguonc-source');
const {episodeNumber}=require('./rophim-source');
const records=new Map();
let archivePage=1,lastSync='not run',lastPlayback='not requested';
const cats=[['movie','nguonc-asia-movie','NguonC · Châu Á - Phim lẻ',false],['series','nguonc-asia-series','NguonC · Châu Á - Phim bộ',false],['movie','nguonc-vn-movie','NguonC · Việt Nam - Phim lẻ',true],['series','nguonc-vn-series','NguonC · Việt Nam - Phim bộ',true]];
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/đ/g,'d').replace(/[^a-z0-9]+/g,' ').trim();
const vietnam=m=>source.group(m,'Quốc gia').some(x=>['viet nam','vietnam'].includes(norm(x)));
function accept(m){return !!m&&source.validSlug(m.slug)&&typeof m.name==='string'&&source.asian(m)&&!!source.typeOf(m)}
function ingest(m){if(!accept(m))return false;records.set(m.slug,m);while(records.size>10000)records.delete(records.keys().next().value);return true}
function preview(m){return {id:'nguonc:'+m.slug,type:source.typeOf(m),name:m.name,poster:m.poster_url||m.thumb_url,posterShape:'poster',releaseInfo:source.yearOf(m)?String(source.yearOf(m)):undefined,description:String(m.description||'').replace(/<[^>]*>/g,' ').trim(),genres:source.group(m,'Thể loại'),country:source.group(m,'Quốc gia').join(', ')}}
function catalog(type,id,raw=''){
 const c=cats.find(x=>x[0]===type&&x[1]===id);if(!c)return [];
 const e=new URLSearchParams(raw),q=norm(e.get('search')),skip=Math.max(0,Math.floor(Number(e.get('skip'))||0));
 return [...records.values()].filter(m=>source.typeOf(m)===type&&(!c[3]||vietnam(m))&&(!q||norm(m.name+' '+(m.original_name||'')).includes(q))).slice(skip,skip+50).map(preview);
}
function parse(type,id,stream=false){
 const m=String(id).match(/^nguonc:([a-z0-9]+(?:-[a-z0-9]+)*)(?::(\d+):(\d+))?$/);if(!m||!source.validSlug(m[1]))return null;
 if(!['movie','series'].includes(type)||type==='movie'&&m[2]||!stream&&m[2])return null;
 if(stream&&type==='series'&&(Number(m[2])!==1||!Number.isSafeInteger(Number(m[3]))||Number(m[3])<1))return null;
 return {slug:m[1],episode:Number(m[3])||null};
}
async function getMovie(type,slug,fresh=false){
 let m=records.get(slug);
 if(fresh||!m){try{m=await source.detail(slug);ingest(m)}catch(e){if(fresh||!m)throw e}}
 return accept(m)&&source.typeOf(m)===type?m:null;
}
async function meta(type,id){
 const req=parse(type,id);if(!req)return null;
 try{const m=await getMovie(type,req.slug);if(!m)return null;const result=preview(m);
 if(type==='series'){
 const episodes=new Map();for(const server of m.episodes||[])for(const ep of server.items||[]){const n=episodeNumber(ep);if(n>0)episodes.set(n,ep.name)}
 result.videos=[...episodes].sort(([a],[b])=>a-b).map(([n,title])=>({id:result.id+':1:'+n,title,season:1,episode:n,released:''}));
 }
 return result;}catch{return null}
}
async function streams(type,id,fallback){
 const req=parse(type,id,true);if(!req)return [];
 try{
 const m=await getMovie(type,req.slug,true);if(!m)return [];
 // Native IDs identify one source slug. Its episode list has a single local season.
 if(type==='series'&&!(m.episodes||[]).some(server=>(server.items||[]).some(ep=>episodeNumber(ep)===req.episode)))return [];
 const out=source.directStreams(m,{type,season:1,episode:req.episode});
 if(out.length){lastPlayback='direct '+out.length;return out}
 let others=[];try{others=await fallback(m,req.episode)}catch{}
 if(others.length){lastPlayback='verified alternative '+others.length;return others}
 const web=source.webStreams(m,{type,episode:req.episode});lastPlayback=web.length?'website fallback; no direct HLS/MP4':'no matching episode';return web;
 }catch(e){lastPlayback='unavailable: '+e.message;const saved=records.get(req.slug);return saved?source.webStreams(saved,{type,episode:req.episode}):[]}
}
async function refresh(){
 const found=new Map();let errors=0,successfulPages=0;
 const pages=[['/api/films/phim-moi-cap-nhat',1],['/api/films/phim-moi-cap-nhat',2],['/api/films/quoc-gia/viet-nam',1],['/api/films/quoc-gia/viet-nam',2]];
 for(let p=Math.max(3,archivePage);p<Math.max(3,archivePage)+4;p++)pages.push(['/api/films/quoc-gia/viet-nam',p]);
 let archiveEnd=false;
 for(const [path,page] of pages){try{const d=await source.json(path+'?page='+page);if(!Array.isArray(d.items))throw Error('invalid items');successfulPages++;if(path.includes('quoc-gia')&&page>=3&&!d.items.length)archiveEnd=true;for(const m of d.items)if(source.validSlug(m.slug))found.set(m.slug,m)}catch{errors++}}
 const items=[...found.values()];let i=0,accepted=0;
 await Promise.all(Array.from({length:4},async()=>{while(i<items.length){const item=items[i++];try{if(ingest(await source.detail(item.slug)))accepted++}catch{errors++}}}));
 if(successfulPages&&!errors)archivePage=archiveEnd?3:Math.max(3,archivePage)+4;
 lastSync=`scanned ${items.length}, Asian ${accepted}, errors ${errors}`;
 if(!successfulPages)throw Error('NguonC API unavailable; retained catalogs');
 return lastSync;
}
function snapshot(){return {archivePage,records:[...records.values()]}}
function restore(data){if(!data||!Array.isArray(data.records))return;for(const m of data.records.slice(0,10000))ingest(m);if(Number.isSafeInteger(data.archivePage)&&data.archivePage>0)archivePage=data.archivePage}
function health(){return {counts:Object.fromEntries(cats.map(c=>[c[1],[...records.values()].filter(m=>source.typeOf(m)===c[0]&&(!c[3]||vietnam(m))).length])),lastSync,lastPlayback,archivePage}}
module.exports={cats,catalog,meta,streams,refresh,snapshot,restore,health,ingest,parse};
