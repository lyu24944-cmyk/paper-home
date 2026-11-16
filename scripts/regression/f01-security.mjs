import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { createServer } from 'vite'
import { localCmsPlugin } from '../local-cms-plugin.mjs'
import { createLocalCmsStore } from '../local-cms-store.mjs'

process.env.LOCAL_CMS_ALLOW_LAN = '1'
process.env.LOCAL_CMS_PIN = 'regression-only-pin'
const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'paper-home-f01-')))
fs.writeFileSync(path.join(root, 'index.html'), '<p>public home</p>')
fs.writeFileSync(path.join(root, '.env.local'), 'PRIVATE_TEST_VALUE=regression-sentinel')
const dataDir = path.join(root, 'local-data')
const store = createLocalCmsStore(root, { dataDir })
store.mutate('project.save_draft', { expectedVersion:0,title: 'PRIVATE_DRAFT_SENTINEL' })
fs.symlinkSync(dataDir, path.join(root, 'alias'), 'junction')
const probe = net.createServer()
await new Promise(r => probe.listen(0, '127.0.0.1', r))
const port = probe.address().port
await new Promise(r => probe.close(r))
const server = await createServer({
  configFile: false, root, envDir: path.join(root, 'empty-env'),
  plugins: [localCmsPlugin({ rootDir: root, dataDir })],
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { host: '127.0.0.1', port, strictPort: true, allowedHosts: true },
})
try {
  await server.listen()
  const base = `http://127.0.0.1:${server.httpServer.address().port}`
  for (const url of ['/local-data/cottage.json', '/local-data%2fcottage.json', '/alias/cottage.json', `/@fs/${dataDir.replaceAll('\\', '/')}/cottage.json`, '/.env.local']) {
    const res = await fetch(base + url)
    const body = await res.text()
    assert([403, 404].includes(res.status), `F01 private static path returned ${res.status}: ${url}`)
    assert(!body.includes('PRIVATE_DRAFT_SENTINEL') && !body.includes('regression-sentinel'))
  }
  assert.equal((await fetch(base + '/')).status, 200)
  const pub = await (await fetch(base + '/__local-cms/public-content')).json()
  assert.equal(pub.projects.length, 0)
  const plugins = [path.join(root, 'public', 'private-data'), path.join(root, 'dist', 'private-data')]
  for (const invalid of plugins) assert.throws(() => localCmsPlugin({ rootDir: root, dataDir: invalid }), /数据目录|private|public|output/i)
  console.log('F01 PASS: private static aliases denied; public page/API available; unsafe data directories rejected')
} finally {
  await server.close()
}
