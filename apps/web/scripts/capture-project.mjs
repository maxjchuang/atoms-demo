import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';

const projectId = process.argv[2];
assert.match(projectId ?? '', /^project_[a-z0-9_-]+$/);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ?? (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1350 } });
  const blocked = [];
  await page.route('**/api/v1/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET' && !(request.method() === 'POST' && path === '/api/v1/sessions')) {
      blocked.push(`${request.method()} ${path}`); return route.abort();
    }
    return route.continue();
  });
  await page.goto(process.env.ATOMS_WEB_URL ?? 'http://localhost:5173');
  await page.getByRole('button', { name: '开启体验' }).click();
  await page.getByLabel('体验码', { exact: true }).fill(process.env.ATOMS_DEMO_CODE ?? 'atoms-demo-2026');
  await page.getByRole('button', { name: '进入创作空间' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.goto(`${process.env.ATOMS_WEB_URL ?? 'http://localhost:5173'}/#/projects/${projectId}`);
  await page.getByRole('tab', { name: '构建活动' }).click(); await expect(page.locator('.feedback-card')).toBeVisible();
  await expect(page.getByText('正在恢复执行历史…', { exact: true })).toBeHidden();
  await page.locator('.activity-details summary').click();
  await expect(page.locator('.execution-timeline li.file').first()).toBeVisible();
  const fileRows = await page.locator('.execution-timeline li.file').count();
  const checkRows = await page.locator('.execution-timeline li.check').count();
  assert.ok(fileRows > 0 && checkRows > 0, 'Existing project must have real file and check facts');
  await page.locator('.feedback-card').scrollIntoViewIfNeeded();
  await page.locator('.execution-timeline li.check').last().scrollIntoViewIfNeeded();
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/real-history-timeline.png', fullPage: true });
  assert.deepEqual(blocked, []);
  console.log(JSON.stringify({ projectId, fileRows, checkRows, modelCalls: 0, generatedRuns: 0,
    screenshot: 'test-results/real-history-timeline.png' }, null, 2));
} finally { await browser.close(); }
