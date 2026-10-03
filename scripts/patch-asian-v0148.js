'use strict';

const fs = require('fs');
const path = require('path');

const target = path.join(process.cwd(), 'asian-v013.js');

if (!fs.existsSync(target)) {
  console.error('[v0.14.8] Missing asian-v013.js');
  process.exit(1);
}

let src = fs.readFileSync(target, 'utf8');
const before = src;

src = src.replace(/\nconst motchilla=require\(['"]\.\/motchilla['"]\);\s*\nmotchilla\.install\(manifest\);\s*/m, '\n');
src = src.replace(/\n\s*if\(await motchilla\.route\(u\.pathname,res,send\)\)return;\s*/m, '\n');

src = src.replace(/version:\s*['"]0\.13\.0['"],\s*name:\s*['"]Asian Movies v0\.13['"]/, "version:'0.14.8',name:'Asian Movies v0.14.8'");
src = src.replace(/version:\s*['"]0\.14\.\d+['"],\s*name:\s*['"]Asian Movies v0\.14(?:\.\d+)?(?:[^'"]*)?['"]/, "version:'0.14.8',name:'Asian Movies v0.14.8'");

src = src.replace(/description:\s*['"][^'"]*['"],\s*\n\s*resources:/, "description:'Phim Châu Á + Việt Nam. Motchilla/THVLi đã được loại bỏ khỏi runtime. Catalog dùng IMDb ID chuẩn; RoPhim được giữ ở mức catalog đã kiểm chứng, còn nguồn phát do các addon stream đã cài trong Stremio xử lý.',\n resources:");

src = src.replace(/Motchill(?:a)?\/?ZonaParfum/gi, 'ZonaParfum');
src = src.replace(/\s*\+\s*Motchilla/gi, '');
src = src.replace(/Bổ sung phim Việt Nam từ Motchilla[^.]*\.?/gi, '');
src = src.replace(/version:\s*['"]0\.13\.0['"]/g, "version:'0.14.8'");

if (src === before) {
  console.warn('[v0.14.8] No source changes detected; refusing silent no-op.');
  process.exit(2);
}

fs.writeFileSync(target, src);

for (const file of ['motchilla.js', 'motchilla-seed.json']) {
  try {
    fs.rmSync(path.join(process.cwd(), file), { force: true });
  } catch (err) {
    console.warn('[v0.14.8] Could not remove', file, err.message);
  }
}

console.log('[v0.14.8] Runtime patched: Motchilla removed, manifest normalized.');
