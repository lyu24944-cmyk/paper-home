import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {spawn} from 'node:child_process'
const baseline=process.env.QA_BASELINE_DIST,current=process.env.QA_CURRENT_DIST||'.qa/regression/perf-current'
assert.ok(baseline,'Set QA_BASELINE_DIST to a preserved pre-fix build')
const snapshot=dir=>JSON.parse(fs.readFileSync(path.join(dir,'local-snapshot/cottage.json'),'utf8'))
const before=snapshot(baseline),after=snapshot(current)
for(const field of ['projects','notes','profile','siteSettings'])assert.deepEqual(after[field],before[field],'Performance inputs differ: '+field)
const results={baseline:[],current:[],criteria:{fpsMinimumRatio:.9,p95MaximumRatio:1.1}},out='.qa/regression/performance'
fs.mkdirSync(out,{recursive:true})
for(let i=1;i<=3;i++)for(const [name,dist] of [['baseline',baseline],['current',current]]){
  const label=`f04-${name}-${i}`
  console.log(`Measuring ${name} ${i}/3 (2560x1440, high, DPR 1, headed; no concurrent GPU task)`)
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['scripts/window-performance.mjs',label],{windowsHide:true,env:{...process.env,QA_URL:'',QA_DIST_DIR:path.resolve(dist),QA_WIDTH:'2560',QA_HEIGHT:'1440',QA_DPR:'1',QA_QUALITY:'high',QA_HEADFUL:'1'},stdio:['ignore','pipe','pipe']})
    let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);child.once('error',reject);child.once('exit',code=>resolve({code,output}))
  })
  fs.writeFileSync(path.join(out,label+'.log'),result.output)
  assert.equal(result.code,0,`Performance ${label} failed; inspect its log`)
  const data=JSON.parse(fs.readFileSync(`.qa/polish/${label}/window-performance-2560-high-dpr1.json`,'utf8'))
  assert.deepEqual(data.errors,[]);assert.equal(data.visibility,'visible')
  assert.ok(Number.isFinite(data.summary.averageFPS)&&data.summary.averageFPS>0)
  results[name].push({summary:data.summary,renderer:data.snapshot.renderer,triangles:data.snapshot.sceneTriangles,phases:data.phases})
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2))
}
assert.ok([...results.baseline,...results.current].every(x=>x.renderer===results.baseline[0].renderer),'All runs must use the same GPU renderer')
const median=list=>list.toSorted((a,b)=>a-b)[1]
results.medians=Object.fromEntries(['baseline','current'].map(name=>[name,{averageFPS:median(results[name].map(x=>x.summary.averageFPS)),p95ms:median(results[name].map(x=>x.summary.p95ms))}]))
results.fpsRatio=results.medians.current.averageFPS/results.medians.baseline.averageFPS
results.p95Ratio=results.medians.current.p95ms/results.medians.baseline.p95ms
results.passed=results.fpsRatio>=.9&&results.p95Ratio<=1.1
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2))
console.log(JSON.stringify({medians:results.medians,fpsRatio:results.fpsRatio,p95Ratio:results.p95Ratio,passed:results.passed},null,2))
assert.ok(results.passed,'Tree performance exceeds the agreed regression budget')
