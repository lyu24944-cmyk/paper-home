import {browserExecutable,freePort,isolatedLocalEnv,prepareTestVideo,trackProcess,stopProcess} from './test-runtime.mjs'
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createLocalCmsStore } from './local-cms-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dir = path.join(rootDir, '.qa', 'polish', 'after');
await fs.mkdir(dir, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.hdr': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
};

async function startSeededServer(tag) {
  if (process.env.QA_URL) return { url: process.env.QA_URL, close: () => {} };
  const seedDataDir = path.join(rootDir, '.qa', `${tag}-data`);
  const seedDistDir = path.join(rootDir, '.qa', `${tag}-dist`);
  await fs.rm(seedDataDir, { recursive: true, force: true });
  const store = createLocalCmsStore(rootDir, { dataDir: seedDataDir });
  await store.seedNeutralSample({ force: true });
  const extras = [
    { title: '示例作品 · 窗边光影实验', summary: '测试画廊切换与详情查看。', body: '用于验证作品室第二幅展品交互。', asset: '10000000-0000-4000-8000-000000000102' },
    { title: '示例作品 · 四时天色手稿', summary: '第三幅作品用于验证边界控制。', body: '用于验证作品室第三幅展品与左右边界。', asset: '10000000-0000-4000-8000-000000000101' },
  ];
  for (const item of extras) {
    const saved = await store.mutate('project.save_draft', {
      expectedVersion: 0,
      title: item.title,
      summary: item.summary,
      body: item.body,
      coverAssetId: item.asset,
      galleryAssetIds: [],
    });
    assert.equal(saved.status,200,'Seed project creation must succeed with version 0');
    const published=await store.mutate('project.publish', {
      id: saved.body.project.id,
      expectedVersion: saved.body.project.version,
    });
    assert.equal(published.status,200,'Seed publication must succeed');
  }
  const viteBin = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');
  execFileSync(process.execPath, [viteBin, 'build', '--mode', 'local-export', '--outDir', seedDistDir], {
    cwd: rootDir,
    env: { ...process.env, PAPER_HOME_FORCE_LOCAL: '1', LOCAL_CMS_DATA_DIR: seedDataDir },
    stdio: 'inherit',
  });
  const server = http.createServer((req, res) => {
    const cleanUrl = (req.url || '/').split('?')[0];
    let filePath = path.join(seedDistDir, cleanUrl === '/' ? 'index.html' : decodeURIComponent(cleanUrl));
    if (!fsSync.existsSync(filePath) || fsSync.statSync(filePath).isDirectory()) {
      filePath = path.join(seedDistDir, 'index.html');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.end(fsSync.readFileSync(filePath));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 4319;
  return { url: `http://127.0.0.1:${port}/?qa`, close: () => server.close() };
}

const serverHandle = await startSeededServer('polish');
const browser = await chromium.launch({ ...browserExecutable(), headless: process.env.QA_HEADFUL !== '1', args: ['--enable-webgl', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
const errors = [], results = { viewports: [], operations: [], errors };
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
async function idle(place) { await page.waitForFunction(p => location.hash === '#' + p && !document.querySelector('.traveling') && !document.querySelector('.loading-note'), place, { timeout: 90000 }); await page.waitForTimeout(450); }
async function go(place) {
  if (await page.evaluate(() => location.hash) === '#' + place) return;
  await page.getByRole('button', { name: '小屋地图', exact: true }).click();
  await page.getByRole('button', { name: new RegExp('^' + { yard: '小院', hall: '走廊', gallery: '作品室', study: '创作手记', blank: '关于我' }[place]) }).click();
  await idle(place);
}
try {
  await page.goto(serverHandle.url); await idle('yard');
  for (const [width, height] of [[1440,900],[2560,1440],[768,1024],[390,844],[640,900],[390,650],[640,800]]) {
    await page.setViewportSize({ width, height }); await page.waitForTimeout(500);
    await go('yard'); await page.screenshot({ path: `${dir}/yard-${width}x${height}.png` });
    results.viewports.push({ width, height, overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), yard: await page.evaluate(() => window.__HOME_QA__) });
    await go('study'); await page.screenshot({ path: `${dir}/study-${width}x${height}.png` });
    await go('gallery'); await page.screenshot({ path: `${dir}/gallery-${width}x${height}.png` });
    if (width / height <= .8) {
      await page.getByRole('button', { name: '上一件作品', exact: true }).click().catch(() => {});
      await page.waitForTimeout(300);
      const viewer = page.locator('.gallery-viewer');
      await page.screenshot({ path: `${dir}/gallery-first-${width}x${height}.png` });
      assert(await viewer.getByRole('button', { name: '上一件作品', exact: true }).isDisabled());
      await page.getByRole('button', { name: '展开《示例作品 · 我的本地小屋》', exact: true }).click();
      const projDialog = page.locator('dialog.project-detail-dialog[open]');
      await projDialog.waitFor();
      await projDialog.getByRole('button', { name: '下一件作品', exact: true }).click();
      assert(await projDialog.getByRole('heading', { name: '示例作品 · 窗边光影实验', exact: true }).isVisible());
      await page.screenshot({ path: `${dir}/artwork-${width}x${height}.png` });
      await projDialog.getByRole('button', { name: '下一件作品', exact: true }).click();
      assert(await projDialog.getByRole('heading', { name: '示例作品 · 四时天色手稿', exact: true }).isVisible());
      assert(await projDialog.locator('.detail-pager-count').textContent() === '3 / 3');
      await page.keyboard.press('Escape');
      assert(await viewer.getByRole('button', { name: '下一件作品', exact: true }).isDisabled());
      await viewer.getByRole('button', { name: '上一件作品', exact: true }).click();
      await page.waitForTimeout(150);
      await viewer.getByRole('button', { name: '上一件作品', exact: true }).click();
      await page.waitForTimeout(150);
      assert(await viewer.getByRole('button', { name: '上一件作品', exact: true }).isDisabled());
      results.operations.push(`single artwork, previous/next limits, modal switching and Escape ${width}x${height}`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await go('hall'); await page.screenshot({ path: `${dir}/hall-1440x900.png` });
  await go('study'); await page.locator('#room-directory').getByRole('button', { name: /如何把这座小屋变成你自己的/ }).click();
  const noteDialog = page.locator('dialog.note-detail-dialog[open]');
  await noteDialog.waitFor();
  assert(await noteDialog.getByRole('heading', { name: '如何把这座小屋变成你自己的' }).isVisible()); await page.keyboard.press('Escape');
  await go('blank'); await page.screenshot({ path: `${dir}/blank-1440x900.png` });
  await go('yard'); await page.getByRole('group', { name: '画面质量' }).getByRole('button', { name: '兼容画质' }).click(); await page.waitForTimeout(300); await idle('yard');
  await go('study'); await page.screenshot({ path: `${dir}/study-low.png` });
  assert.equal(errors.length, 0, errors.join('\n')); assert(results.viewports.every(v => !v.overflow));
  results.passed = true;
} catch (e) { results.passed = false; results.failure = e.stack; await page.screenshot({ path: `${dir}/failure.png` }).catch(() => {}); process.exitCode = 1; }
finally { await fs.writeFile(`${dir}/visual-check.json`, JSON.stringify(results, null, 2)); await browser.close(); serverHandle.close(); console.log(JSON.stringify({ passed: results.passed, operations: results.operations, errors, failure: results.failure }, null, 2)); }
