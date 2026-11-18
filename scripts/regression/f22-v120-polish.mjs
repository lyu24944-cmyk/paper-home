import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import sharp from 'sharp'
import { createLocalCmsStore } from '../local-cms-store.mjs'
import { validateSnapshot, writeSnapshotManifest } from '../public-snapshot.mjs'
import {
  browserExecutable,
  browserTestArgs,
  browserTestHeadless,
  browserTestTimeout,
  browserTestUrl,
  freePort,
  isolatedLocalEnv,
} from '../test-runtime.mjs'

const rootDir = fileURLToPath(new URL('../../', import.meta.url))
const canonicalTmp = fs.realpathSync.native(os.tmpdir())
process.env.TEMP = canonicalTmp
process.env.TMP = canonicalTmp

function decodeBasicEntities(raw) {
  return raw
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
}

function parseTagAttrs(tag) {
  const attrs = {}
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let match
  while ((match = attrRe.exec(tag)) !== null) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? ''
  }
  return attrs
}

function getMetaRawContent(html, keyAttr, keyValue) {
  const metaRe = /<meta\b[^>]*>/gi
  let match
  while ((match = metaRe.exec(html)) !== null) {
    const attrs = parseTagAttrs(match[0])
    if (attrs[keyAttr.toLowerCase()] === keyValue) {
      return attrs.content ?? null
    }
  }
  return null
}

function hasFontPreload(html, expectedHref) {
  const linkRe = /<link\b[^>]*>/gi
  let match
  while ((match = linkRe.exec(html)) !== null) {
    const attrs = parseTagAttrs(match[0])
    if (
      attrs.rel === 'preload' &&
      attrs.as === 'font' &&
      decodeBasicEntities(attrs.href || '') === expectedHref
    ) {
      return true
    }
  }
  return false
}

const repoCottagePath = path.join(rootDir, 'site-content', 'cottage.json')
const repoCottageRawBefore = fs.readFileSync(repoCottagePath, 'utf8')
const repoCottageBefore = JSON.parse(repoCottageRawBefore)
assert.equal(Array.isArray(repoCottageBefore.projects), true)
assert.equal(repoCottageBefore.projects.length, 0, 'repo site-content/cottage.json must start with projects: []')

const tmpRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(canonicalTmp, 'paper-home-f22-')))
let server = null
let browser = null

try {
  // 1. Dynamic HTML meta & social preview card via isolated build:local
  const snapInputDir = path.join(tmpRoot, 'snapshot-input')
  const buildOutDir = path.join(tmpRoot, 'dist')
  const unusedDataDir = path.join(tmpRoot, 'unused-data')
  fs.mkdirSync(snapInputDir, { recursive: true })
  fs.mkdirSync(unusedDataDir, { recursive: true })
  fs.writeFileSync(
    path.join(snapInputDir, 'cottage.json'),
    JSON.stringify(
      {
        snapshot: true,
        exportedAt: new Date().toISOString(),
        projects: [],
        notes: [],
        profile: null,
        siteSettings: {
          homeName: '木叶小屋 & <Test>',
          plaqueTitle: '推门见山',
          plaqueSubtitle: '留一点时间，慢慢逛',
          yardHeading: '来家里坐坐。',
          yardSubtitle: '四时庭院与手记',
          defaultAtmosphere: 'daylight',
          defaultWeather: 'clear',
        },
        signedUrls: {},
      },
      null,
      2,
    ),
  )
  writeSnapshotManifest(snapInputDir, 'local')

  const viteBin = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js')
  execFileSync(
    process.execPath,
    [viteBin, 'build', '--mode', 'local-export', '--outDir', buildOutDir],
    {
      cwd: rootDir,
      env: {
        ...isolatedLocalEnv(unusedDataDir),
        PAPER_HOME_SNAPSHOT_DIR: snapInputDir,
        TEMP: canonicalTmp,
        TMP: canonicalTmp,
      },
      stdio: 'pipe',
    },
  )

  const socialPreviewPath = path.join(buildOutDir, 'social-preview.jpg')
  assert.equal(fs.existsSync(socialPreviewPath), true, 'dist/social-preview.jpg must exist in built output')
  const previewMeta = await sharp(socialPreviewPath).metadata()
  assert.equal(previewMeta.format, 'jpeg', 'dist/social-preview.jpg must decode as JPEG')
  assert.equal(previewMeta.width, 1280, 'dist/social-preview.jpg width must be 1280')
  assert.equal(previewMeta.height, 640, 'dist/social-preview.jpg height must be 640')

  const builtHtml = fs.readFileSync(path.join(buildOutDir, 'index.html'), 'utf8')
  const expectedEscapedTitle = '木叶小屋 &amp; &lt;Test&gt; · 推门见山'
  assert(
    builtHtml.includes(`<title>${expectedEscapedTitle}</title>`),
    `Expected escaped <title>${expectedEscapedTitle}</title> in dist/index.html`,
  )
  assert(!builtHtml.includes('<Test>'), 'dist/index.html must not contain unescaped <Test>')
  assert.equal(getMetaRawContent(builtHtml, 'property', 'og:title'), expectedEscapedTitle)
  assert.equal(getMetaRawContent(builtHtml, 'name', 'twitter:title'), expectedEscapedTitle)
  assert.equal(getMetaRawContent(builtHtml, 'property', 'og:description'), '四时庭院与手记')
  assert.equal(getMetaRawContent(builtHtml, 'name', 'twitter:description'), '四时庭院与手记')
  assert.equal(getMetaRawContent(builtHtml, 'name', 'description'), '四时庭院与手记')
  assert.equal(getMetaRawContent(builtHtml, 'property', 'og:image'), './social-preview.jpg')
  assert.equal(getMetaRawContent(builtHtml, 'name', 'twitter:card'), 'summary_large_image')
  assert.equal(
    hasFontPreload(builtHtml, './fonts/home-hand.ttf'),
    true,
    'dist/index.html must preload ./fonts/home-hand.ttf',
  )

  // 2. Launch isolated Local Studio + verify Markdown & XSS safety via Vite SSR
  const dataDir = path.join(tmpRoot, 'data')
  const exportOutDir = path.join(tmpRoot, 'exported-site')
  const store = createLocalCmsStore(rootDir, { dataDir })
  await store.seedNeutralSample()

  process.env.PAPER_HOME_FORCE_LOCAL = '1'
  process.env.LOCAL_CMS_DATA_DIR = dataDir
  process.env.PAPER_HOME_EXPORT_OUT_DIR = exportOutDir
  delete process.env.PAPER_HOME_SNAPSHOT_DIR
  delete process.env.LOCAL_CMS_ALLOW_LAN
  delete process.env.LOCAL_CMS_PIN

  const port = await freePort()
  const { createServer } = await import('vite')
  server = await createServer({
    root: rootDir,
    server: { host: '127.0.0.1', port, strictPort: true },
  })
  await server.listen()

  const { renderParagraphs } = await server.ssrLoadModule('/src/lib/text.tsx')
  const markdownFixture = [
    '## Heading',
    '### Subheading',
    'Paragraph with **bold**, *italic*, `inline`, and [safe](https://example.com).',
    '```js\nconst answer = 42\n```',
    '- list alpha\n- list beta',
    '1. ordered one\n2. ordered two',
    '> quote line one\n> quote line two',
    '---',
    'plain first line\nplain second line',
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '[xss](javascript:alert(1)) and [xss](data:text/html,1)',
  ].join('\n\n')

  const ssrHtml = renderToStaticMarkup(
    createElement('div', { className: 'detail-body' }, renderParagraphs(markdownFixture)),
  )
  assert(ssrHtml.includes('<h3 class="detail-heading">Heading</h3>'), 'SSR must render ## Heading as h3.detail-heading')
  assert(ssrHtml.includes('<h4 class="detail-subheading">Subheading</h4>'), 'SSR must render ### Subheading as h4.detail-subheading')
  assert(ssrHtml.includes('<strong>bold</strong>'), 'SSR must render **bold** as <strong>')
  assert(ssrHtml.includes('<em>italic</em>'), 'SSR must render *italic* as <em>')
  assert(ssrHtml.includes('<code class="detail-inline-code">inline</code>'), 'SSR must render `inline` code')
  assert(/<pre class="detail-code-block"><code>const answer = 42\n?<\/code><\/pre>/.test(ssrHtml), 'SSR must render fenced code block')
  assert(/<ul class="detail-list"><li>list alpha<\/li><li>list beta<\/li><\/ul>/.test(ssrHtml), 'SSR must render unordered list')
  assert(/<ol class="detail-list"><li>ordered one<\/li><li>ordered two<\/li><\/ol>/.test(ssrHtml), 'SSR must render ordered list')
  assert(ssrHtml.includes('<blockquote class="detail-quote">') && ssrHtml.includes('quote line one'), 'SSR must render blockquote')
  assert(/<hr class="detail-divider"\s*\/?>/.test(ssrHtml), 'SSR must render horizontal rule')
  assert(/<a\b[^>]*href="https:\/\/example\.com\/?"[^>]*>safe<\/a>/.test(ssrHtml), 'SSR must render safe https link')
  assert(/plain first line[\s\S]*?<br\s*\/?>[\s\S]*?plain second line/.test(ssrHtml), 'SSR must preserve single-newline <br> compatibility in plain paragraphs')
  assert(!/<script\b/i.test(ssrHtml), 'SSR must emit zero <script> elements')
  assert(!/<img\b/i.test(ssrHtml), 'SSR must emit zero <img> elements')
  assert(!/href="\s*(?:javascript|data):/i.test(ssrHtml), 'SSR must emit zero javascript: or data: href attributes')
  assert(ssrHtml.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'Raw <script> text must be escaped')
  assert(ssrHtml.includes('[xss](javascript:alert(1))'), 'Unsafe javascript: markdown link must stay plain text')
  assert(ssrHtml.includes('[xss](data:text/html,1)'), 'Unsafe data: markdown link must stay plain text')

  // 3. Cross-origin CSRF guard & Browser E2E (Toolbar + Preview + Visitor NoteDetailModal + One-Click Export)
  const baseUrl = `http://127.0.0.1:${port}`
  const evilRes = await fetch(`${baseUrl}/__local-cms/export-public`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://evil.example',
      'X-Local-Owner': '1',
    },
    body: '{}',
  })
  assert.equal(evilRes.status, 403, 'Cross-origin POST /__local-cms/export-public must return 403')
  assert.equal(fs.existsSync(exportOutDir), false, 'Rejected export-public must not create output directory')

  const unauthRes = await fetch(`${baseUrl}/__local-cms/export-public`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  assert.equal(unauthRes.status, 403, 'Unauthenticated POST /__local-cms/export-public must return 403')

  browser = await chromium.launch({
    ...browserExecutable(),
    headless: browserTestHeadless(),
    args: browserTestArgs(),
  })
  const page = await browser.newPage({
    viewport: { width: 1366, height: 860 },
    reducedMotion: 'reduce',
  })
  page.setDefaultTimeout(browserTestTimeout(15000))

  const consoleErrors = []
  const pageErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => pageErrors.push(err.message))

  await page.goto(browserTestUrl(`${baseUrl}/?qa=1&quality=low#study`))
  await page.waitForFunction(
    () =>
      location.hash === '#study' &&
      Boolean(document.querySelector('.home-app')) &&
      !document.querySelector('.loading-note') &&
      !document.querySelector('.traveling'),
    null,
    { timeout: 90000 },
  )

  // Enter Local Edit Mode inside Cottage Map
  await page.getByRole('button', { name: /小屋地图/ }).click()
  await page.getByRole('button', { name: '进入编辑模式', exact: true }).click()
  await page.getByText('本地编辑模式', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)

  // Open NoteEditorModal & format with MarkdownToolbar
  await page.getByRole('button', { name: '写手记' }).first().click()
  const ed = page.locator('dialog.cms-editor-dialog[open]')
  await ed.waitFor()

  const noteTitle = 'v1.2.0 排版工具栏与安全手记'
  await ed.getByLabel('手记标题（发布必填）').fill(noteTitle)

  const bodyField = ed.getByLabel('手记正文（发布必填）')
  assert.equal(await bodyField.isVisible(), true, 'NoteEditorModal must start in edit mode with textarea visible')
  await bodyField.focus()

  await ed.getByRole('button', { name: '小标题', exact: true }).click()
  let currentBody = await bodyField.inputValue()
  assert(currentBody.includes('## '), 'Clicking 小标题 must insert "## " prefix')
  if (currentBody.trim() === '##') {
    await bodyField.fill(`${currentBody}章节小标题`)
  }
  currentBody = await bodyField.inputValue()
  await bodyField.fill(`${currentBody}\n\n`)
  await bodyField.focus()
  await bodyField.evaluate((el) => {
    el.setSelectionRange(el.value.length, el.value.length)
  })
  await ed.getByRole('button', { name: '加粗', exact: true }).click()
  currentBody = await bodyField.inputValue()
  assert(/\*\*.+\*\*/.test(currentBody), 'Clicking 加粗 must insert bold Markdown markers')

  const extraBlocks = [
    '### 二级小节',
    '这里包含 *斜体*、`行内代码` 与 [安全链接](https://example.com)。',
    '```ts\nconst safe = true\n```',
    '- 清单项 A\n- 清单项 B',
    '1. 步骤一\n2. 步骤二',
    '> 一段安静的引用文字',
    '---',
    '纯文本第一行\n纯文本第二行',
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '[xss](javascript:alert(1)) [xss](data:text/html,1)',
  ].join('\n\n')
  await bodyField.fill(`${currentBody}\n\n${extraBlocks}`)

  // Toggle live preview -> verify rendered DOM & XSS safety -> toggle back to edit
  await ed.getByRole('button', { name: '排版预览', exact: true }).click()
  const previewBox = ed.locator('.markdown-preview-box.detail-body')
  await previewBox.waitFor()
  assert.equal(await ed.getByRole('button', { name: '小标题', exact: true }).isDisabled(), true)
  assert.equal(await previewBox.locator('h3.detail-heading').count(), 1)
  assert.equal(await previewBox.locator('h4.detail-subheading').count(), 1)
  assert.equal((await previewBox.locator('strong').count()) >= 1, true)
  assert.equal(await previewBox.locator('em').count(), 1)
  assert.equal(await previewBox.locator('code.detail-inline-code').count(), 1)
  assert.equal(await previewBox.locator('pre.detail-code-block code').count(), 1)
  assert.equal(await previewBox.locator('ul.detail-list li').count(), 2)
  assert.equal(await previewBox.locator('ol.detail-list li').count(), 2)
  assert.equal(await previewBox.locator('blockquote.detail-quote').count(), 1)
  assert.equal(await previewBox.locator('hr.detail-divider').count(), 1)
  assert.equal(await previewBox.locator('a.detail-inline-link').count(), 1)
  assert.equal((await previewBox.locator('p.detail-paragraph br').count()) >= 1, true)
  assert.equal(await previewBox.locator('script').count(), 0)
  assert.equal(await previewBox.locator('img').count(), 0)

  await ed.getByRole('button', { name: '返回编辑', exact: true }).click()
  assert.equal(await bodyField.isVisible(), true, 'Clicking 返回编辑 must restore textarea')

  await ed.getByRole('button', { name: '发布手记', exact: true }).click()
  await ed.getByText(/手记已发布到创作手记/).waitFor()
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('dialog.cms-editor-dialog[open]'))

  // Switch to visitor view and verify formatted <h3> & <strong> + XSS safety in NoteDetailModal
  await page.getByRole('button', { name: /小屋地图/ }).click()
  await page.getByRole('button', { name: '退出编辑（访客预览）', exact: true }).click()
  await page.getByRole('button', { name: '进入编辑模式', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)

  if (!(await page.locator('#room-directory').isVisible())) {
    await page.getByRole('button', { name: /手记目录/ }).click()
  }
  await page.locator('.article-list button', { hasText: noteTitle }).click()
  const detail = page.locator('dialog.note-detail-dialog[open] .detail-body')
  await detail.waitFor()
  assert.equal(await detail.locator('h3.detail-heading').count(), 1)
  assert.equal((await detail.locator('strong').count()) >= 1, true)
  assert.equal(await detail.locator('h4.detail-subheading').count(), 1)
  assert.equal(await detail.locator('pre.detail-code-block code').count(), 1)
  assert.equal(await detail.locator('ul.detail-list li').count(), 2)
  assert.equal(await detail.locator('ol.detail-list li').count(), 2)
  assert.equal(await detail.locator('blockquote.detail-quote').count(), 1)
  assert.equal(await detail.locator('hr.detail-divider').count(), 1)
  assert.equal(await detail.locator('script').count(), 0)
  assert.equal(await detail.locator('img').count(), 0)
  const hrefs = await detail.locator('a').evaluateAll((els) => els.map((a) => a.getAttribute('href') || ''))
  assert.equal(hrefs.length, 1)
  assert(hrefs[0].startsWith('https://example.com'), `Unexpected href in visitor NoteDetailModal: ${hrefs[0]}`)

  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('dialog.note-detail-dialog[open]'))

  // Re-enter edit mode in Cottage Map and click one-click 导出公开快照
  await page.getByRole('button', { name: /小屋地图/ }).click()
  await page.getByRole('button', { name: '进入编辑模式', exact: true }).click()
  await page.getByText('本地编辑模式', { exact: true }).waitFor()
  const exportRegion = page.getByRole('region', { name: '导出公开快照' })
  await exportRegion.waitFor()
  await exportRegion.getByRole('button', { name: '导出公开快照', exact: true }).click()
  await page.getByText(/已导出公开快照至/).waitFor()

  const pubContent = await (await fetch(`${baseUrl}/__local-cms/public-content`)).json()
  const exportedSnapshot = await validateSnapshot(exportOutDir, { requireManifest: true })
  assert.equal(exportedSnapshot.projects.length, pubContent.projects.length)
  assert.equal(exportedSnapshot.notes.length, pubContent.notes.length)
  assert.equal(exportedSnapshot.projects.length, 1)
  assert.equal(exportedSnapshot.notes.length, 2)
  assert(exportedSnapshot.notes.some((n) => n.title === noteTitle))

  // Confirm repo site-content/cottage.json remains untouched and empty
  const repoCottageRawAfter = fs.readFileSync(repoCottagePath, 'utf8')
  const repoCottageAfter = JSON.parse(repoCottageRawAfter)
  assert.equal(repoCottageRawAfter, repoCottageRawBefore, 'repo site-content/cottage.json must remain untouched')
  assert.equal(repoCottageAfter.projects.length, 0)

  assert.deepEqual(consoleErrors, [], `Console errors: ${consoleErrors.join('\n')}`)
  assert.deepEqual(pageErrors, [], `Page errors: ${pageErrors.join('\n')}`)

  console.log(
    `F22 PASS: Markdown & XSS safety, dynamic OG/Twitter meta + 1280x640 social preview, and Local Studio toolbar + one-click snapshot export verified (projects=${exportedSnapshot.projects.length}, notes=${exportedSnapshot.notes.length})`,
  )
} finally {
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
  fs.rmSync(tmpRoot, { recursive: true, force: true })
}
