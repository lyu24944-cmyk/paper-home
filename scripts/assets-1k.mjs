import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sharp from 'sharp'

export const TEXTURE_SURFACES = ['brick', 'roof', 'plaster', 'wood', 'stone', 'grass']
export const TEXTURE_SLOTS = ['color', 'normal', 'roughness']

const DEFAULT_OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/assets/realistic')

export async function rebuildRealisticManifest(outDir = DEFAULT_OUT_DIR) {
  const manifestPath = path.join(outDir, 'manifest.json')
  let manifest = { generated: new Date().toISOString(), records: [], served: [] }
  try {
    const existing = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    if (existing && typeof existing === 'object') {
      manifest = { ...manifest, ...existing }
    }
  } catch {
    // Initialize fresh manifest if missing.
  }

  const filenames = (await fs.readdir(outDir))
    .filter((name) => name !== 'manifest.json' && !name.startsWith('.'))
    .sort((a, b) => a.localeCompare(b))

  const served = []
  for (const filename of filenames) {
    const data = await fs.readFile(path.join(outDir, filename))
    served.push({
      filename,
      bytes: data.length,
      sha256: crypto.createHash('sha256').update(data).digest('hex'),
    })
  }

  manifest.generated = new Date().toISOString()
  manifest.served = served
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2))
  return { served, totalBytes: served.reduce((sum, entry) => sum + entry.bytes, 0) }
}

export async function generate1kTextures({ outDir = DEFAULT_OUT_DIR, updateManifest = true } = {}) {
  const generated = []
  let total1kBytes = 0

  for (const kind of TEXTURE_SURFACES) {
    for (const slot of TEXTURE_SLOTS) {
      const srcPath = path.join(outDir, `${kind}-${slot}.webp`)
      const destName = `${kind}-${slot}-1k.webp`
      const destPath = path.join(outDir, destName)
      const quality = slot === 'normal' ? 76 : 72
      await sharp(srcPath)
        .resize(1024, 1024, { fit: 'fill' })
        .webp({ quality, effort: 6 })
        .toFile(destPath)
      const stat = await fs.stat(destPath)
      total1kBytes += stat.size
      generated.push({ filename: destName, bytes: stat.size })
    }
  }

  const manifestSummary = updateManifest ? await rebuildRealisticManifest(outDir) : null
  return { generated, total1kBytes, manifestSummary }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isMain) {
  const { generated, total1kBytes, manifestSummary } = await generate1kTextures()
  console.log(
    `[assets:1k] Generated ${generated.length} 1K textures (${(total1kBytes / 1048576).toFixed(2)} MiB total).`,
  )
  for (const item of generated) {
    console.log(`  - ${item.filename}: ${(item.bytes / 1024).toFixed(1)} KiB`)
  }
  if (manifestSummary) {
    console.log(
      `[assets:1k] Updated manifest.json -> ${manifestSummary.served.length} served assets (${(manifestSummary.totalBytes / 1048576).toFixed(2)} MiB total).`,
    )
  }
}
