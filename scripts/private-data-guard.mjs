import fs from 'node:fs'
import path from 'node:path'

// Resolve existing ancestors as well: configuration may run before the data folder exists.
export function canonical(file) {
  let cursor = path.resolve(file)
  const tail = []
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor)
    if (parent === cursor) break
    tail.unshift(path.basename(cursor))
    cursor = parent
  }
  const resolved = path.join(fs.realpathSync.native(cursor), ...tail)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function inside(file, directory) {
  const relative = path.relative(directory, file)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

export function assertPrivateDataDirectory(dataDir, publicDir, outDir) {
  const target = canonical(dataDir)
  for (const forbidden of [publicDir, outDir].filter(Boolean)) {
    if (inside(target, canonical(forbidden))) throw new Error('CMS 私有数据目录不能放在 public 或构建输出目录内。')
  }
  // A public junction/symlink would otherwise be followed by Vite's public copy.
  const visit = (dir) => {
    if (!dir || !fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        const real = canonical(file)
        if (inside(real, target) || inside(target, real)) throw new Error('public 中的链接不能指向 CMS 私有数据目录。')
      } else if (entry.isDirectory()) visit(file)
    }
  }
  visit(publicDir)
}

export function installPrivateDataGuard(middlewares, servedRoot, dataDir) {
  middlewares.use((req, res, next) => {
    try {
      let pathname = (req.url || '/').split('?')[0]
      for (let i = 0; i < 8 && /%[0-9a-f]{2}/i.test(pathname); i++) pathname = decodeURIComponent(pathname)
      if (pathname.includes('\0') || pathname.includes('\\') || /%[0-9a-f]{2}/i.test(pathname)) throw new Error('Invalid path')
      const target = pathname.startsWith('/@fs/')
        ? pathname.slice('/@fs/'.length)
        : path.resolve(servedRoot, `.${pathname}`)
      if (inside(canonical(target), canonical(dataDir))) {
        res.statusCode = 403
        res.setHeader('Cache-Control', 'no-store')
        res.end('Private CMS data is only available through authenticated CMS routes.')
        return
      }
      next()
    } catch {
      res.statusCode = 403
      res.end('Forbidden file path')
    }
  })
}
