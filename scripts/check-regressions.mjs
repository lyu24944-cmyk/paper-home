import fs from 'node:fs'
import {spawn} from 'node:child_process'

const cases=['f01-security','f02-cleanup','f03-lazy','f04-trees','f04-browser','f05-f07-routing','f08-session','f09-cancel','f10-focus','f11-versions','f12-sync','f13-import','f14-cache','f15-export','f15-build','f15-atomic-io','f16-lan','f16-lan-ui','f17-orphans','f17-cleanup-ui','f18-range','f19-fixture','f20-gates','f21-sources','f21-git','gpu-resources','f22-v120-polish']
const records=[]
const collectFailures=process.argv.includes('--collect-failures')
fs.mkdirSync('.qa/regression',{recursive:true})
for(const name of cases){
  const start=Date.now()
  const code=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[`scripts/regression/${name}.mjs`],{stdio:'inherit',windowsHide:true})
    child.once('error',reject);child.once('exit',resolve)
  })
  records.push({name,exitCode:code,durationMs:Date.now()-start})
  fs.writeFileSync('.qa/regression/results.json',JSON.stringify(records,null,2))
  if(code!==0&&!collectFailures)process.exit(code||1)
}
if(records.some(row=>row.exitCode!==0))process.exitCode=1
