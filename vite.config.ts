import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { localCmsPlugin } from './scripts/local-cms-plugin.mjs'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const forceLocalEnvDir = process.env.PAPER_HOME_FORCE_LOCAL === '1'
  ? path.join(rootDir, '.qa', 'empty-env')
  : undefined
if (forceLocalEnvDir) {
  fs.mkdirSync(forceLocalEnvDir, { recursive: true })
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), localCmsPlugin({ rootDir, mode })],
  base: './',
  ...(forceLocalEnvDir ? { envDir: forceLocalEnvDir } : {}),
  define: {
    __LOCAL_SNAPSHOT_EXPORT__: JSON.stringify(mode === 'local-export'),
  },
  server: {
    watch: {
      ignored: ['**/.qa/**', '**/bak/**', '**/local-data/**'],
    },
  },
}))
