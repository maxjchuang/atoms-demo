import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Read-only local audit: GET plus session redemption, never create a Run. The
// saved "before" measurements were captured before the typography adjustment.
const phase = process.argv[2] ?? 'after';
assert.match(phase, /^[a-z0-9_-]+$/);
if (phase === 'before' && existsSync('typography/before-measurements.json')) throw new Error('The original before measurement is immutable; use another audit label.');
const baseUrl = process.env.ATOMS_WEB_URL ?? 'http://localhost:5173';
const projectId = process.env.ATOMS_TYPOGRAPHY_PROJECT ?? process.argv[3];
assert.match(projectId ?? '', /^project_[a-z0-9_-]+$/, 'Set ATOMS_TYPOGRAPHY_PROJECT to an existing completed project.');
const output = resolve('review-artifacts/typography', phase);
await mkdir(output, { recursive: true }); await mkdir('typography', { recursive: true });
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ?? (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const result = [];
const homeSelectors = { headline: '.hero h1', body: '.hero-description', sidebar: '.nav-item', workspaceSwitch: '.workspace-switch', composer: '.hero .composer textarea', composerMode: '.mode-select select', section: '.section-heading h2' };
const workspaceSelectors = { message: '.message.assistant p', feedbackTitle: '.run-card-top strong', feedbackBody: '.feedback-card .current-activity p', elapsed: '.execution-times', apiSync: '.api-sync', timelineTitle: '.execution-timeline strong', timelineBody: '.execution-timeline p', tabs: '.output-tabs button', composer: '.workspace-composer textarea' };

async function measure(page, selectors) {
  const values = {};
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  const document = await cdp.send('DOM.getDocument');
  for (const [name, selector] of Object.entries(selectors)) {
    const locator = page.locator(selector).first();
    if (!await locator.count()) { values[name] = null; continue; }
    const value = await locator.evaluate((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const rgba = (color) => {
        const numbers = color.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1];
        return [numbers[0], numbers[1], numbers[2], numbers[3] ?? 1];
      };
      const chain = []; let current = element;
      while (current) { chain.unshift(current); current = current.parentElement; }
      let background = [255, 255, 255];
      for (const node of chain) { const c = rgba(getComputedStyle(node).backgroundColor); background = background.map((v, i) => c[i] * c[3] + v * (1 - c[3])); }
      const contrast = (color) => {
        const c = rgba(color); const foreground = background.map((v, i) => c[i] * c[3] + v * (1 - c[3]));
        const light = (rgb) => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
        const a = light(foreground), b = light(background); return Number(((Math.max(a, b) + .05) / (Math.min(a, b) + .05)).toFixed(2));
      };
      return { fontSize: style.fontSize, lineHeight: style.lineHeight, fontFamily: style.fontFamily, fontWeight: style.fontWeight,
        color: style.color, effectiveBackground: background, contrast: contrast(style.color),
        placeholderContrast: element instanceof HTMLTextAreaElement ? contrast(getComputedStyle(element, '::placeholder').color) : null,
        width: rect.width, height: rect.height };
    });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: document.root.nodeId, selector });
    const fonts = nodeId ? (await cdp.send('CSS.getPlatformFontsForNode', { nodeId })).fonts : [];
    values[name] = { ...value, renderedFonts: fonts.map(({ familyName, postScriptName, isCustomFont }) => ({ familyName, postScriptName, isCustomFont })) };
  }
  await cdp.detach(); return values;
}
async function layout(page) {
  return page.evaluate(() => {
    const widths = ['.composer-bottom', '.output-toolbar', '.conversation-panel', '.main'].map(selector => {
      const element = document.querySelector(selector);
      return element ? { selector, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth } : null;
    }).filter(Boolean);
    const clipped = [...document.querySelectorAll('.new-project,.mode-select,.send-button,.output-tabs button,.output-actions a')].flatMap(element => {
      const rect = element.getBoundingClientRect(); const style = getComputedStyle(element);
      if (!rect.width || !rect.height || style.display === 'none') return [];
      return rect.left < -1 || rect.right > innerWidth + 1 || element.scrollWidth > element.clientWidth + 1 ? [element.className || element.textContent] : [];
    });
    const textarea = document.querySelector('.composer textarea');
    const parent = textarea?.closest('.composer');
    const field = textarea?.getBoundingClientRect(), container = parent?.getBoundingClientRect();
    return { innerWidth, innerHeight, devicePixelRatio, visualScale: visualViewport.scale, cssZoom: getComputedStyle(document.documentElement).zoom,
      pageScrollWidth: document.documentElement.scrollWidth, widths, clipped,
      composerFits: !!field && !!container && field.left >= container.left && field.right <= container.right + 1 && field.height >= 46 };
  });
}
function checkLayout(value) {
  assert.equal(value.visualScale, 1); assert.equal(value.cssZoom, '1');
  assert.ok(value.pageScrollWidth <= value.innerWidth + 1, 'Page must not overflow horizontally');
  assert.deepEqual(value.clipped, [], 'Controls must not clip'); assert.ok(value.composerFits);
  value.widths.forEach(item => assert.ok(item.scrollWidth <= item.clientWidth + 1, `${item.selector} overflows horizontally`));
}
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 1366, height: 768 }]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const forbidden = [];
    await page.route('**/api/v1/**', route => {
      const request = route.request(); const path = new URL(request.url()).pathname;
      if (request.method() !== 'GET' && !(request.method() === 'POST' && path === '/api/v1/sessions')) { forbidden.push(path); return route.abort(); }
      return route.continue();
    });
    await page.goto(baseUrl); await page.locator('.hero h1').waitFor();
    const home = await measure(page, homeSelectors); const homeLayout = await layout(page); checkLayout(homeLayout);
    await page.screenshot({ path: `${output}/dashboard-${viewport.width}.png` });
    await page.getByRole('button', { name: '开启体验' }).click();
    await page.getByLabel('体验码', { exact: true }).fill(process.env.ATOMS_DEMO_CODE ?? 'atoms-demo-2026');
    await page.getByRole('button', { name: '进入创作空间' }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.goto(`${baseUrl}/#/projects/${projectId}`); await page.locator('.feedback-card').waitFor();
    await page.locator('.activity-details summary').click(); await page.locator('.execution-timeline li.check').last().waitFor();
    const workspace = await measure(page, workspaceSelectors); const workspaceLayout = await layout(page); checkLayout(workspaceLayout);
    await page.locator('.feedback-card').evaluate(element => {
      const scroller = element.closest('.conversation-scroll');
      if (scroller) scroller.scrollTop += element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 10;
    });
    await page.screenshot({ path: `${output}/workspace-${viewport.width}.png` });
    assert.deepEqual(forbidden, []);
    if (phase === 'after') {
      assert.equal(home.headline.fontSize, '36px'); assert.equal(home.headline.lineHeight, '45px');
      assert.ok(parseFloat(home.composer.fontSize) >= 16);
      for (const name of ['message', 'feedbackTitle', 'feedbackBody', 'tabs', 'composer']) assert.ok(parseFloat(workspace[name].fontSize) >= 14, `${name} font too small`);
      for (const name of ['elapsed', 'apiSync', 'timelineTitle', 'timelineBody']) assert.ok(parseFloat(workspace[name].fontSize) >= 12, `${name} font too small`);
      for (const [name, metric] of Object.entries({ ...home, ...workspace })) if (metric) assert.ok(metric.contrast >= 4.5, `${name} text contrast ${metric.contrast} is too low`);
      assert.ok(home.composer.placeholderContrast >= 4.5);
    }
    result.push({ site: 'local', viewport, homeLayout, workspaceLayout, home, workspace }); await page.close();
  }
  const report = { recordedAt: new Date().toISOString(), label: phase, runtimeMutations: 0, modelCalls: 0, measurements: result };
  await writeFile(`typography/${phase}-measurements.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ label: phase, viewports: result.map(value => value.viewport), checks: 'passed', modelCalls: 0, output, report: `typography/${phase}-measurements.json` }, null, 2));
} finally { await browser.close(); }
