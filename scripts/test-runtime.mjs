import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import {fileURLToPath} from 'node:url'

export function browserExecutable() {
  if(process.env.QA_CHROME_PATH){
    if(!fs.existsSync(process.env.QA_CHROME_PATH))throw new Error('QA_CHROME_PATH does not exist')
    return {executablePath:process.env.QA_CHROME_PATH}
  }
  const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe'
  return process.platform==='win32'&&fs.existsSync(chrome)?{executablePath:chrome}:{}
}
export async function freePort() {
  const server=net.createServer()
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
  const port=server.address().port
  await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))
  return port
}
export function isolatedLocalEnv(dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'paper-home-test-'))) {
  return {...process.env,PAPER_HOME_FORCE_LOCAL:'1',LOCAL_CMS_DATA_DIR:dataDir,LOCAL_CMS_ALLOW_LAN:'',LOCAL_CMS_PIN:''}
}
export function prepareTestVideo(outputDir) {
  const fixture=fs.readFileSync(new URL('./fixtures/tiny.mp4',import.meta.url))
  const boxes=new Set()
  for(let offset=0;offset<fixture.length;){
    const size=fixture.readUInt32BE(offset)
    if(size<8||offset+size>fixture.length)throw new Error('Invalid tracked MP4 box')
    boxes.add(fixture.subarray(offset+4,offset+8).toString());offset+=size
  }
  if(!['ftyp','moov','mdat'].every(box=>boxes.has(box)))throw new Error('Incomplete tracked MP4 fixture')
  const padding=Buffer.alloc(8*1024*1024-fixture.length)
  padding.writeUInt32BE(padding.length);padding.write('free',4)
  const dir=outputDir instanceof URL?fileURLToPath(outputDir):outputDir
  fs.mkdirSync(dir,{recursive:true})
  const target=path.join(dir,'test-chunked-8m.mp4')
  fs.writeFileSync(target,Buffer.concat([fixture,padding]))
  return target
}

const children=new Set()
process.once('exit',()=>{for(const child of children)child.kill()})
export function trackProcess(child){children.add(child);child.once('exit',()=>children.delete(child));return child}
export async function stopProcess(child){
  if(!child||child.exitCode!==null)return
  await new Promise(resolve=>{const timer=setTimeout(resolve,5000);child.once('exit',()=>{clearTimeout(timer);resolve()});child.kill()})
}
