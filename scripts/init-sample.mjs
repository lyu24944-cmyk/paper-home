import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLocalCmsStore } from './local-cms-store.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const force = process.argv.includes('--force')

async function main() {
  const store = createLocalCmsStore(rootDir)
  const res = await store.seedNeutralSample({ force })
  if (res.skipped) {
    console.log(`[init:sample] ${res.reason} 如需重置覆盖可追加 --force。`)
    return
  }
  console.log(
    `[init:sample] 已写入中性示例到 local-data/（作品 ${res.projectCount} 件，手记 ${res.noteCount} 篇，图片 ${res.assetCount} 张）。`,
  )
  console.log('[init:sample] 运行 npm run dev 后即可在浏览器中查看、修改或删除示例内容。')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
