import fs from 'node:fs/promises';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';
const folder=new URL('../public/assets/realistic/',import.meta.url);
let manifest;
try{manifest=JSON.parse(await fs.readFile(new URL('manifest.json',folder),'utf8'))}catch{
 const result=spawnSync(process.execPath,['scripts/assets.mjs'],{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);
 manifest=JSON.parse(await fs.readFile(new URL('manifest.json',folder),'utf8'));
}
let bytes=0;
for(const entry of manifest.served){const data=await fs.readFile(new URL(entry.filename,folder));const hash=crypto.createHash('sha256').update(data).digest('hex');if(hash!==entry.sha256)throw Error('Asset checksum mismatch: '+entry.filename);bytes+=data.length}
console.log(`Verified ${manifest.served.length} local assets, ${(bytes/1048576).toFixed(2)} MiB; no runtime external requests.`);
