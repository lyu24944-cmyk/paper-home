import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const dir = '.qa/polish/after';
await fs.mkdir(dir, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
const errors = [], results = { viewports: [], operations: [], errors };
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
async function idle(place) { await page.waitForFunction(p => location.hash === '#' + p && !document.querySelector('.traveling') && !document.querySelector('.loading-note'), place, { timeout: 90000 }); await page.waitForTimeout(450); }
async function go(place) {
  if (await page.evaluate(() => location.hash) === '#' + place) return;
  await page.getByRole('button', { name: '小屋地图', exact: true }).click();
  await page.getByRole('button', { name: new RegExp('^' + { yard: '小院', hall: '走廊', gallery: '收藏展廊', study: '书房', blank: '空白房间' }[place]) }).click();
  await idle(place);
}
try {
  await page.goto('http://127.0.0.1:4319/?qa'); await idle('yard');
  for (const [width, height] of [[1440,900],[2560,1440],[768,1024],[390,844],[640,900],[390,650],[640,800]]) {
    await page.setViewportSize({ width, height }); await page.waitForTimeout(500);
    await go('yard'); await page.screenshot({ path: `${dir}/yard-${width}x${height}.png` });
    results.viewports.push({ width, height, overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), yard: await page.evaluate(() => window.__HOME_QA__) });
    await go('study'); await page.screenshot({ path: `${dir}/study-${width}x${height}.png` });
    await go('gallery'); await page.screenshot({ path: `${dir}/gallery-${width}x${height}.png` });
    if (width / height <= .8) {
      await page.getByRole('button', { name: '上一幅作品', exact: true }).click(); await page.waitForTimeout(300);
      await page.screenshot({ path: `${dir}/gallery-first-${width}x${height}.png` });
      assert(await page.getByRole('button', { name: '上一幅作品', exact: true }).isDisabled());
      await page.getByRole('button', { name: '展开《山间来信》', exact: true }).click();
      await page.getByRole('button', { name: '下一幅画作', exact: true }).click();
      assert(await page.getByRole('dialog', { name: '窗边的一天', exact: true }).isVisible());
      await page.screenshot({ path: `${dir}/artwork-${width}x${height}.png` });
      await page.getByRole('button', { name: '下一幅画作', exact: true }).click();
      assert(await page.getByRole('button', { name: '下一幅画作', exact: true }).isDisabled());
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '上一幅作品', exact: true }).click();
      results.operations.push(`single artwork, previous/next limits, modal switching and Escape ${width}x${height}`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await go('hall'); await page.screenshot({ path: `${dir}/hall-1440x900.png` });
  await go('study'); await page.getByRole('button', { name: '给生活留一扇窗', exact: true }).click();
  assert(await page.getByRole('dialog', { name: '给生活留一扇窗' }).isVisible()); await page.keyboard.press('Escape');
  await go('blank'); await page.screenshot({ path: `${dir}/blank-1440x900.png` });
  await go('yard'); await page.getByLabel('画面质量').selectOption('low'); await idle('yard');
  await go('study'); await page.screenshot({ path: `${dir}/study-low.png` });
  assert.equal(errors.length, 0, errors.join('\n')); assert(results.viewports.every(v => !v.overflow));
  results.passed = true;
} catch (e) { results.passed = false; results.failure = e.stack; await page.screenshot({ path: `${dir}/failure.png` }).catch(() => {}); process.exitCode = 1; }
finally { await fs.writeFile(`${dir}/visual-check.json`, JSON.stringify(results, null, 2)); await browser.close(); console.log(JSON.stringify({ passed: results.passed, operations: results.operations, errors, failure: results.failure }, null, 2)); }
