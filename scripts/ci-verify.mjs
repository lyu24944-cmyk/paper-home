import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {createEmptyStoreData} from './local-cms-store.mjs'
import {isolatedLocalEnv} from './test-runtime.mjs'

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'paper-home-ci-'))
fs.writeFileSync(path.join(temp,'cottage.json'),JSON.stringify(createEmptyStoreData()))
const env=isolatedLocalEnv(temp),results=[]
const tsc='node_modules/typescript/bin/tsc',vite='node_modules/vite/bin/vite.js'
const steps=[['TypeScript',tsc,'--noEmit'],...['check-assets','camera-check','sound-verify','phase1-verify','phase2-verify','local-verify','cms-verify','polish-check','verify'].map(name=>[name,`scripts/${name}.mjs`]),['normal build',vite,'build','--outDir',path.join(temp,'normal-dist')],['isolated local build',vite,'build','--mode','local-export','--outDir',path.join(temp,'local-dist')],['edge cases','scripts/edge-cases.mjs'],['config types',tsc,'--noEmit','-p','tsconfig.config.json'],['Edge types','scripts/edge-typecheck.mjs'],['F01-F21 regressions','scripts/check-regressions.mjs'],['real Supabase','scripts/supabase-integration.mjs']]
const remainingOnly=process.argv.includes('--remaining')
const selectedSteps=remainingOnly?steps.slice(12).map(step=>step[0]==='F01-F21 regressions'?[...step,'--collect-failures']:step):steps
const resultsFile=remainingOnly?'.qa/ci-remaining-results.json':'.qa/ci-results.json'
if(remainingOnly)console.log('DIAGNOSTIC ONLY: remaining five gates; not the full 17-step release gate')
try{
  fs.mkdirSync('.qa',{recursive:true})
  for(const [name,...args] of selectedSteps){
    console.log('\nRunning:',name)
    const started=Date.now()
    const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{env,stdio:'inherit',windowsHide:true});child.once('error',reject);child.once('exit',resolve)})
    results.push({name,exitCode:code,durationMs:Date.now()-started})
    fs.writeFileSync(resultsFile,JSON.stringify(results,null,2))
    if(code!==0&&!remainingOnly)process.exit(code||1)
  }
  if(results.some(row=>row.exitCode!==0))process.exitCode=1
}finally{fs.rmSync(temp,{recursive:true,force:true})}
