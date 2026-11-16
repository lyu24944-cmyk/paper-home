import fs from 'node:fs/promises';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';
import {validateAsset} from './asset-validation.mjs';
import {fileURLToPath} from 'node:url';
const folder=new URL('../public/assets/realistic/',import.meta.url);
const manifest=JSON.parse(await fs.readFile(new URL('manifest.json',folder),'utf8'));
let bytes=0;
for(const entry of manifest.served){const data=await fs.readFile(new URL(entry.filename,folder));const hash=crypto.createHash('sha256').update(data).digest('hex');if(hash!==entry.sha256)throw Error('Asset checksum mismatch: '+entry.filename);await validateAsset(entry.filename,data);bytes+=data.length}
const masks=spawnSync(process.execPath,[fileURLToPath(new URL('./regression/f04-trees.mjs',import.meta.url))],{stdio:'inherit'});
if(masks.status!==0)process.exit(masks.status||1);
console.log(`Verified checksums, decoding and canopy masks: ${manifest.served.length} local assets, ${(bytes/1048576).toFixed(2)} MiB.`);
