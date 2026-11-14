import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';

const label = process.argv[2] || 'after';
const width = Number(process.env.QA_WIDTH || 2560), height = Number(process.env.QA_HEIGHT || 1440);
const dpr = Number(process.env.QA_DPR || 1), quality = process.env.QA_QUALITY || 'high';
const dir = `.qa/polish/${label}`;
await fs.mkdir(dir, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', `--window-size=${Math.min(width + 30, 2560)},${Math.min(height + 100, 1530)}`] });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.goto(`http://127.0.0.1:4319/?qa&quality=${quality}`);
await page.waitForFunction(() => !document.querySelector('.enter-button')?.disabled, { timeout: 120000 });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const test = window.__WINDOW_TEST__ = { start: performance.now(), phase: 'yard', frames: [], tasks: [], events: [], running: true };
  let previous = performance.now();
  const tick = now => {
    if (!test.running) return;
    const qa = window.__HOME_QA__;
    test.frames.push({ at: now - test.start, ms: now - previous, phase: test.phase, dpr: qa?.dpr, cpu: qa?.renderCPUms, calls: qa?.calls, transition: qa?.transition?.phase });
    previous = now; requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  test.observer = new PerformanceObserver(list => test.tasks.push(...list.getEntries().map(e => ({ at: e.startTime - test.start, ms: e.duration }))));
  test.observer.observe({ type: 'longtask', buffered: false });
  window.__HOME_QA__.start();
});
async function phase(name) { await page.evaluate(name => { window.__WINDOW_TEST__.phase = name; window.__WINDOW_TEST__.events.push({ name, at: performance.now() - window.__WINDOW_TEST__.start }); }, name); }
async function idle(place) { await page.waitForFunction(p => location.hash === '#' + p && !document.querySelector('.traveling'), place, { timeout: 60000 }); }
async function go(target, name) {
  await phase(name);
  await page.getByRole('button', { name: '小屋地图', exact: true }).click();
  await page.getByRole('button', { name: new RegExp('^' + { yard: '小院', hall: '走廊', gallery: '作品室', study: '创作手记', blank: '关于我' }[target]) }).click();
  await idle(target);
}
await page.waitForTimeout(4000);
await phase('entry');
await page.getByRole('button', { name: '敲敲门，进来坐坐' }).click();
await idle('hall');
await phase('walking');
await page.evaluate(() => {
  const el = document.querySelector('.home-app'), start = performance.now(), duration = 24000, max = el.scrollHeight - el.clientHeight;
  const tick = () => { const t = Math.min(1, (performance.now() - start) / duration); el.scrollTop = (.5 - .5 * Math.cos(t * Math.PI * 4)) * max; if (t < 1) requestAnimationFrame(tick); }; tick();
});
await page.waitForTimeout(24500);
await go('gallery', 'first-gallery');
await page.waitForTimeout(2000);
await go('study', 'first-study');
await page.waitForTimeout(2000);
await go('blank', 'first-blank');
await page.waitForTimeout(1500);
await go('yard', 'return-yard');
await go('study', 'repeat-study');
await go('hall', 'return-hall');
await page.waitForTimeout(1500);
const result = await page.evaluate(() => {
  const test = window.__WINDOW_TEST__; test.running = false; test.observer.disconnect(); delete test.observer;
  const summary = frames => {
    const sorted = frames.map(f => f.ms).sort((a, b) => a - b), total = sorted.reduce((a, b) => a + b, 0);
    const percentile = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
    return { samples: sorted.length, durationMs: total, averageFPS: sorted.length / (total / 1000), p50ms: percentile(.5), p95ms: percentile(.95), p99ms: percentile(.99), maxMs: sorted.at(-1), over33ms: sorted.filter(v => v > 33.333).length, over50ms: sorted.filter(v => v > 50).length, over100ms: sorted.filter(v => v > 100).length };
  };
  const phases = Object.fromEntries([...new Set(test.frames.map(f => f.phase))].map(name => [name, summary(test.frames.filter(f => f.phase === name))]));
  return { summary: summary(test.frames), phases, ...test, appMetrics: window.__HOME_QA__.stop(), snapshot: window.__HOME_QA__, browser: navigator.userAgent, visibility: document.visibilityState };
});
Object.assign(result, { headed: true, width, height, deviceScaleFactor: dpr, quality, errors, recording: false, screenshotsDuringMeasurement: false });
await fs.writeFile(`${dir}/window-performance-${width}-${quality}-dpr${dpr}.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ label, width, height, dpr, quality, summary: result.summary, phases: result.phases, renderer: result.snapshot.renderer, errors }, null, 2));
await browser.close();
