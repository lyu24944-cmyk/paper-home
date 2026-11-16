import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
const pending=[]
const exports={}
const api={signMediaUrlsApi:()=>new Promise(resolve=>pending.push(resolve))}
const code=ts.transpileModule(fs.readFileSync('src/lib/media.ts','utf8'),{compilerOptions:{target:9,module:1}}).outputText
new Function('exports','require',code)(exports,name=>name==='./api'?api:name==='../types/content'?{ApiError:class extends Error{}}:{})
const id='a',entry=url=>({displayUrl:url,thumbUrl:null,expiresAt:Date.now()+60000})
exports.seedSignedUrls({[id]:entry('public')},'public')
const old=exports.refreshSignedUrl(id,'admin',true)
exports.clearSignedUrlCache('admin')
const fresh=exports.refreshSignedUrl(id,'admin',true)
assert.equal(pending.length,2,'a cleared scope must start a new task')
pending[0]({signedUrls:{[id]:entry('old')},deniedIds:[]});await old
assert.equal(exports.getCachedUrl(id,'display','admin'),null,'an obsolete response must not refill cache')
const third=exports.refreshSignedUrl(id,'admin',true)
assert.equal(pending.length,2,'old finally must not remove a new task')
pending[1]({signedUrls:{[id]:entry('new')},deniedIds:[]});await Promise.all([fresh,third])
assert.equal(exports.getCachedUrl(id,'display','admin'),'new')
assert.equal(exports.getCachedUrl(id,'display','public'),'public')
console.log('F14 PASS: scoped epochs discard stale responses and preserve newer in-flight tasks')
