import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import {createServer} from 'vite'
import {localCmsPlugin} from '../local-cms-plugin.mjs'
import {createLocalCmsStore} from '../local-cms-store.mjs'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'paper-home-f18-')),dataDir=path.join(root,'private')
const store=createLocalCmsStore(root,{dataDir});await store.seedNeutralSample()
const asset=Object.values(store.readDb().assets)[0],bytes=fs.readFileSync(path.join(store.mediaDir,asset.displayPath))
const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r))
const server=await createServer({root,configFile:false,plugins:[localCmsPlugin({rootDir:root,dataDir})],server:{host:'127.0.0.1',port,strictPort:true},optimizeDeps:{noDiscovery:true}})
try{
 await server.listen();const url=`http://127.0.0.1:${port}/__local-cms/media/admin/${asset.id}/display`
 for(const [range,status,start,end] of [['bytes=-10',206,bytes.length-10,bytes.length-1],['bytes=-999999999999999999999',206,0,bytes.length-1],['bytes=0-0',206,0,0],['bytes=3-',206,3,bytes.length-1],['bytes=0-9999999',206,0,bytes.length-1],['bytes=1-2,3-4',200,0,bytes.length-1],['bytes=-0',416],['bytes=9999999-',416],['bytes=3-2',416]]){
  const response=await fetch(url,{headers:{Range:range}});assert.equal(response.status,status,range)
  if(status!==416)assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes.subarray(start,end+1),range)
 }
 console.log('F18 PASS: closed/open/suffix ranges, 416 bounds and multi-range full response')
}finally{await server.close();fs.rmSync(root,{recursive:true,force:true})}
