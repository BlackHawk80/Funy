'use strict';
const {execFileSync}=require('node:child_process');
for(const file of ['asian-v013.js','catalog-storage.js'])execFileSync(process.execPath,['--check',file],{stdio:'inherit'});
const seed=require('./seed-v013.json');
for(const key of ['movie','series','vnMovie','vnSeries']){
 if(!Array.isArray(seed[key])||!seed[key].length)throw Error('Missing catalog snapshot: '+key);
 if(seed[key].some(x=>!/^tt\d+$/.test(x.id||'')))throw Error('Invalid IMDb ID in '+key);
}
console.log('Asian Movies build ready. Catalog snapshot:',Object.fromEntries(Object.entries(seed).map(([k,v])=>[k,v.length])));
