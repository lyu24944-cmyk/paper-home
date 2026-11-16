import fs from 'node:fs'
import path from 'node:path'

// Windows readers/virus scanners can briefly hold a just-created directory.
// Retry only sharing/permission failures; a persistent failure still rolls back.
function rename(from,to){
  for(let attempt=0;;attempt++){
    try{return fs.renameSync(from,to)}catch(error){
      if(attempt>=7||!['EPERM','EBUSY','EACCES'].includes(error.code))throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,25*2**Math.min(attempt,3))
    }
  }
}

export function atomicDirectory(targetInput, generate) {
  const target = path.resolve(targetInput), parent = path.dirname(target)
  if (target === parent) throw new Error('Unsafe output directory')
  fs.mkdirSync(parent,{recursive:true})
  const stage = fs.mkdtempSync(path.join(parent,'.snapshot-stage-'))
  const backup = stage+'-previous'
  let moved = false
  try {
    const result = generate(stage)
    if (fs.existsSync(target)) { rename(target,backup); moved=true }
    try { rename(stage,target) }
    catch(error) { if(moved)rename(backup,target);throw error }
    if(moved)fs.rmSync(backup,{recursive:true,force:true})
    return result
  } finally { fs.rmSync(stage,{recursive:true,force:true}) }
}

export async function atomicDirectoryAsync(targetInput, generate) {
  const target=path.resolve(targetInput),parent=path.dirname(target)
  if(target===parent)throw new Error('Unsafe output directory')
  fs.mkdirSync(parent,{recursive:true})
  const stage=fs.mkdtempSync(path.join(parent,'.snapshot-stage-')),backup=stage+'-previous'
  let moved=false
  try{
    const result=await generate(stage)
    if(fs.existsSync(target)){rename(target,backup);moved=true}
    try{rename(stage,target)}catch(error){if(moved)rename(backup,target);throw error}
    if(moved)fs.rmSync(backup,{recursive:true,force:true})
    return result
  }finally{fs.rmSync(stage,{recursive:true,force:true})}
}
