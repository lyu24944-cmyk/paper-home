import {spawnSync} from 'node:child_process'
const files=['admin-mutate','admin-content','public-content','media-sign','media-cleanup'].map(name=>`supabase/functions/${name}/index.ts`)
const probe=spawnSync('deno',['--version'],{stdio:'ignore',windowsHide:true})
const command=probe.status===0?'deno':process.platform==='win32'?'npx.cmd':'npx'
const args=probe.status===0?['check',...files]:['--yes','deno','check',...files]
const result=spawnSync(command,args,{stdio:'inherit',windowsHide:true,shell:process.platform==='win32'&&command.endsWith('.cmd')})
process.exit(result.status??1)
