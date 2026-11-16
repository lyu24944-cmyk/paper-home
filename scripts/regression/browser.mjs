import {browserExecutable,browserTestArgs} from '../test-runtime.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createLocalCmsStore } from '../local-cms-store.mjs'

export const root = fileURLToPath(new URL('../../', import.meta.url))
export async function startBrowserTest({lan=false}={}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-home-browser-'))
  process.env.PAPER_HOME_FORCE_LOCAL = '1'
  process.env.LOCAL_CMS_DATA_DIR = dataDir
  if(lan){process.env.LOCAL_CMS_ALLOW_LAN='1';process.env.LOCAL_CMS_PIN='regression-pin-only'}
  else {delete process.env.LOCAL_CMS_ALLOW_LAN;delete process.env.LOCAL_CMS_PIN}
  const store = createLocalCmsStore(root, { dataDir })
  await store.seedNeutralSample()
  const probe = net.createServer()
  await new Promise(r => probe.listen(0, '127.0.0.1', r))
  const port = probe.address().port
  await new Promise(r => probe.close(r))
  const { createServer } = await import('vite')
  const server = await createServer({ root, server: { host: lan?'0.0.0.0':'127.0.0.1', port, strictPort: true } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ ...browserExecutable(), headless: true, args: browserTestArgs() })
    const ip=lan?(Object.values(os.networkInterfaces()).flat().find(x=>x.family==='IPv4'&&!x.internal&&x.address.startsWith('10.'))?.address || Object.values(os.networkInterfaces()).flat().find(x=>x.family==='IPv4'&&!x.internal)?.address):'127.0.0.1'
    return { browser, store, dataDir, url: `http://${ip}:${port}/?qa=1&quality=low`, close: async () => { await browser.close(); await server.close() } }
  } catch (err) { await browser?.close(); await server.close(); throw err }
}

export async function idle(page) {
  await page.waitForFunction(() => !!document.querySelector('.home-app') && !document.querySelector('.loading-note') && !document.querySelector('.traveling'), null, { timeout: 90000 })
}
