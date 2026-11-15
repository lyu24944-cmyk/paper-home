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

export default defineConfig(({ mode }) => {
  const lanMode = process.env.LOCAL_CMS_ALLOW_LAN === '1' && Boolean(process.env.LOCAL_CMS_PIN)
  const allowedHosts = lanMode ? true : ['localhost', '127.0.0.1', '[::1]']
  return {
    plugins: [react(), localCmsPlugin({ rootDir, mode })],
    base: './',
    ...(forceLocalEnvDir ? { envDir: forceLocalEnvDir } : {}),
    define: {
      __LOCAL_SNAPSHOT_EXPORT__: JSON.stringify(mode === 'local-export'),
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalized = id.replace(/\\/g, '/')
            if (!normalized.includes('/node_modules/')) return undefined
            if (normalized.includes('/node_modules/three/')) return 'three'
            if (normalized.includes('/node_modules/gsap/')) return 'gsap'
            if (
              normalized.includes('/node_modules/@supabase/') ||
              normalized.includes('/node_modules/tus-js-client/')
            ) {
              return 'supabase'
            }
            if (
              normalized.includes('/node_modules/react/') ||
              normalized.includes('/node_modules/react-dom/') ||
              normalized.includes('/node_modules/scheduler/') ||
              normalized.includes('/node_modules/@react-three/fiber/') ||
              normalized.includes('/node_modules/react-reconciler/')
            ) {
              return 'react-vendor'
            }
            return undefined
          },
        },
      },
    },
    server: {
      allowedHosts,
      watch: {
        ignored: ['**/.qa/**', '**/bak/**', '**/local-data/**'],
      },
    },
    preview: {
      allowedHosts,
    },
  }
})
