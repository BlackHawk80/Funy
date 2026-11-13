'use strict';

const BaseProvider = require('./base');
const { getText, getJson, parseEpNum, detectAudio, cached, mapImageUrl } = require('../utils');
const { decodeNativeId } = require('./k20');
const { CONFIG, PROVIDERS } = require('../config');
const { KKphimProvider } = require('./kkphim');
const { normTitle } = require('../utils');
const { wrappedVideoOffset } = require('../hls-proxy');

// VNStream guest adapter. The helpers below are retained for the disabled NguonC module.
// Only accept the same title, year and media type; never substitute by slug alone.
async function matchingFallback(detail, slug) {
  const other = await new KKphimProvider(PROVIDERS.kkphim).detail(slug);
  if (!other || other.type !== detail.type || !detail.year || Number(other.year) !== Number(detail.year)) return null;
  const a = normTitle(detail.originalName || detail.name);
  const b = normTitle(other.originalName || other.name);
  if (!a || a !== b) return null;
  if (detail.imdbId && other.imdbId && detail.imdbId !== other.imdbId) return null;
  return other;
}

async function playableHls(url, headers = {}, allowWrapped = false) {
  if (!/^https?:\/\//i.test(url || '')) return false;
  return cached(`playable:${allowWrapped}:${url}`, 120000, async () => {
    try {
      let target = url;
      for (let depth = 0; depth < 3; depth++) {
        const res = await fetch(target, { headers, signal: AbortSignal.timeout(12000) });
        if (!res.ok) return false;
        const text = await res.text();
        if (!text.trimStart().startsWith('#EXTM3U')) return false;
        const line = text.split(/\r?\n/).find(l => l.trim() && !l.startsWith('#'));
        if (!line) return false;
        const next = new URL(line.trim(), res.url || target).href;
        if (text.includes('#EXT-X-STREAM-INF')) { target = next; continue; }
        const seg = await fetch(next, { headers, signal: AbortSignal.timeout(12000) });
        if (!seg.ok || !seg.body) return false;
        const reader = seg.body.getReader(); let bytes = Buffer.alloc(0);
        try {
          while (bytes.length < 8192) { const {value,done}=await reader.read(); if(done) break; bytes=Buffer.concat([bytes,Buffer.from(value)]); }
        } finally { await reader.cancel(); }
        // Reject HTML challenges and image-wrapped segments, even with HTTP 200.
        return (allowWrapped && /(^|\.)streamvsmov\.com$/i.test(new URL(next).hostname) && wrappedVideoOffset(bytes) >= 0) || (bytes[0] === 0x47 && bytes[188] === 0x47 && bytes[376] === 0x47) ||
          ['ftyp','styp','moof'].includes(bytes.toString('ascii',4,8));
      }
    } catch { return false; }
    return false;
  });
}


function guestEpisode(stream) {
  const name = String(stream.name || '');
  const label = `${name} ${stream.title || ''} ${stream.behaviorHints?.filename || ''}`;
  const se = label.match(/(?:^|[^a-z0-9])S(\d+)E(\d+)(?=$|[^0-9])/i);
  const ep = name.match(/(?:tập|tap|episode|ep)\s*0*(\d+)/i) || name.match(/^0*(\d+)$/);
  if (!ep && !se) return null;
  return { season: se ? Number(se[1]) : 1, episode: ep ? Number(ep[1]) : Number(se[2]) };
}

class VnstreamProvider extends BaseProvider {
  async request(url) {
    try {
      const r = await fetch(url, { headers: this.headers, signal: AbortSignal.timeout(20000) });
      if (!r.ok) { console.warn('[VNStream guest]',r.status,new URL(url).pathname); return null; }
      return await r.json();
    } catch(e) { console.warn('[VNStream guest]',e.name); return null; }
  }
  native(slug, type = 'series') { return decodeNativeId(slug) || {id:slug,type}; }
  normalize(meta, type) {
    return {...meta, type, slug:require('./k20').encodeNativeId(type,meta.id),
      originalName:String(meta.description || '').split(' / ')[1] || meta.name,
      year:parseInt(meta.year || meta.releaseInfo,10) || undefined,
      background:meta.background || meta.banner || meta.poster};
  }
  toMeta(item) {
    return {...item, id:this.prefix+item.slug, releaseInfo:item.releaseInfo == null ? undefined : String(item.releaseInfo)};
  }
  async fetchCatalog(type, catalog, extra={}) {
    const parts=[];
    for(const key of ['search','genre','skip']) if(extra[key] !== undefined && extra[key] !== '') parts.push(`${key}=${encodeURIComponent(extra[key])}`);
    const data=await this.request(`${this.cfg.apiUrl}/catalog/${type}/${catalog}${parts.length ? '/'+parts.join('&') : ''}.json`);
    return (data?.metas || []).filter(m=>m.id).map(m=>this.normalize(m,type));
  }
  async listCatalog(kind,extra={}) {
    const type=kind==='bo' ? 'series' : 'movie';
    const filters=kind==='hanh-dong' ? {...extra,genre:'Hành Động'} : extra;
    return (await this.fetchCatalog(type,extra.search ? 'vnstream-vietsub' : 'vnstream-top',filters)).map(m=>this.toMeta(m));
  }
  async search(q) {
    return (await Promise.all(['movie','series'].map(type=>this.fetchCatalog(type,'vnstream-vietsub',{search:q})))).flat();
  }
  async rawStreams(native) {
    return await cached(`vn-guest-v2:streams:${native.type}:${native.id}`,60000,async()=>{
      const d=await this.request(`${this.cfg.apiUrl}/stream/${native.type}/${encodeURIComponent(native.id)}.json`);
      return (d?.streams || []).filter(s=>/^https?:\/\//i.test(s.url || ''));
    }) || [];
  }
  async detail(slug,type='series') {
    const native=this.native(slug,type);
    const d=await this.request(`${this.cfg.apiUrl}/meta/${native.type}/${encodeURIComponent(native.id)}.json`);
    if(!d?.meta) return null;
    const meta=this.normalize(d.meta,native.type);
    const videos=[]; const seen=new Set();
    if(native.type==='series') {
      for(const stream of await this.rawStreams(native)) {
        const ep=guestEpisode(stream);if(!ep || seen.has(`${ep.season}:${ep.episode}`))continue;
        seen.add(`${ep.season}:${ep.episode}`);
        videos.push({id:`${this.prefix}${slug}:${ep.season}:${ep.episode}`,title:`Tập ${ep.episode}`,...ep});
      }
      videos.sort((a,b)=>a.season-b.season || a.episode-b.episode);
    }
    return {...meta,slug,videos};
  }
  buildMeta(d) {
    if(!d)return null;
    const {slug,originalName,year,...meta}=d;
    return {...meta,id:this.prefix+slug,releaseInfo:d.releaseInfo == null ? undefined : String(d.releaseInfo)};
  }
  async streamsFromSlug(slug,type,season=1,episode=1) {
    const native=this.native(slug,type);
    let list=await this.rawStreams(native);
    if(native.type==='series') list=list.filter(s=>{const e=guestEpisode(s);return e && e.season===Number(season) && e.episode===Number(episode)});
    return list.map(s=>{
      const mapped={...s,name:`VNStream Guest · ${s.name || 'Full'}`,title:s.description || s.title || s.name};
      Object.defineProperty(mapped,'_providerId',{value:this.id,enumerable:false});return mapped;
    });
  }
  async resolveStream(options) {
    const hits=await this.fetchCatalog(options.type==='series'?'series':'movie','vnstream-vietsub',{search:options.title});
    for(const item of this.matchCandidates(hits,options).slice(0,3)) {
      const streams=await this.streamsFromSlug(item.slug,options.type,options.season,options.episode);
      if(streams.length)return streams;
    }
    return [];
  }
}
module.exports = { VnstreamProvider, guestEpisode, matchingFallback, playableHls };
