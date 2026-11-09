import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

test.beforeEach(() => test.skip(process.env.ATOMS_E2E_REAL === '1', 'Isolated Mock UI regression; never consumes real model quota.'));

async function seed(page: Page, scenario = 'complete', blocked = false) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '开启体验' })).toBeVisible();
  const id = await page.evaluate(async ({ scenario, blocked }) => {
    const post = async (path: string, body: unknown) => {
      const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(await response.text()); return response.json();
    };
    await post('/api/v1/sessions', { code: 'atoms-demo-2026' });
    const project = await post('/api/v1/projects', { title: '前端体验回归' });
    await post(`/api/v1/projects/${project.id}/runs`, { prompt: '构建便签墙', mode: 'build' });
    for (let i = 0; i < 9; i++) await fetch(`/api/v1/projects/${project.id}/events?after=0`);
    await post('/__mock/delivery/seed', { projectId: project.id, scenario });
    if (blocked) {
      const { run } = await post(`/api/v1/projects/${project.id}/runs`, { prompt: '修改应用并模拟失败', mode: 'build' });
      for (let i = 0; i < 7; i++) await fetch(`/api/v1/projects/${project.id}/events?after=0`);
      await post('/__mock/delivery/seed', { projectId: project.id, subjectId: run.id, scenario: 'blocked' });
    }
    return project.id as string;
  }, { scenario, blocked });
  await page.goto(`/#/projects/${id}`); await page.reload();
  await expect(page.getByLabel('项目消息', { exact: true })).toBeVisible();
  return id;
}

test('Enter sends once; Shift+Enter, input composition, repeat and empty Enter never send', async ({ page }) => {
  await seed(page);
  const field = page.getByLabel('项目消息', { exact: true });
  await page.getByLabel('消息模式').selectOption('ask');
  const sent: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && /\/api\/v2\/projects\/[^/]+\/messages$/.test(new URL(request.url()).pathname)) sent.push(request.postData() ?? ''); });
  await field.press('Enter');
  await field.fill('第一行'); await field.press('Shift+Enter'); await field.press('End'); await field.press('x');
  await expect(field).toHaveValue('第一行\nx');
  await field.fill('这个应用如何使用？');
  await field.dispatchEvent('compositionstart');
  await field.dispatchEvent('keydown', { key: 'Enter', code: 'Enter' });
  await field.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 });
  await field.dispatchEvent('compositionend');
  await field.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', repeat: true });
  await expect(field).toHaveValue('这个应用如何使用？');
  expect(sent).toHaveLength(0);
  await field.press('Enter');
  await expect.poll(() => sent.length).toBe(1);
  await expect(field).toHaveValue('');
  await expect(page.locator('.conversation-item .message.user p').filter({ hasText: /^这个应用如何使用？$/ })).toHaveCount(1);
  await field.press('Enter'); expect(sent).toHaveLength(1);
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 1366, height: 768 }]) test(`blocked and partial summaries leave room for preview at ${viewport.width}`, async ({ page }) => {
  await page.setViewportSize(viewport); await seed(page, 'projection-mixed', true);
  const summaries = page.getByTestId('delivery-summary');
  await expect(summaries).toHaveCount(2);
  await expect(summaries.first()).toContainText('部分交付');
  await expect(summaries.last()).toContainText('本次交付受阻，当前仍显示 V1');
  await expect(summaries.first()).toContainText('需人工判断');
  const geometry = await page.evaluate(() => {
    const summaries = [...document.querySelectorAll('.output-panel > .delivery-summary')].map(item => item.getBoundingClientRect().height);
    const preview = document.querySelector('.preview-area')!.getBoundingClientRect();
    return { summaryHeight: summaries.reduce((a, b) => a + b, 0), previewHeight: preview.height, overflow: document.documentElement.scrollWidth > innerWidth };
  });
  expect(geometry.summaryHeight).toBeLessThan(180);
  expect(geometry.previewHeight).toBeGreaterThan(viewport.height * .5);
  expect(geometry.overflow).toBe(false);
  await expect(page.locator('.completed-builds')).toHaveText('已完成1次构建');
  await expect(page.locator('.account')).toContainText('剩余');
  await expect(page.locator('.engine-badge')).toHaveCount(0);
  await expect(page.locator('.output-footer')).not.toContainText('React');
  await expect(page.locator('.build-note')).toContainText('描述你的想法，让 Atoms');
  await expect(page.locator('.conversation-panel')).not.toContainText(/Worker|React/);
  await mkdir('review-artifacts/usability', { recursive: true });
  await writeFile(`review-artifacts/usability/geometry-${viewport.width}.json`, JSON.stringify({ viewport, ...geometry }, null, 2));
  await page.screenshot({ path: `review-artifacts/usability/preview-${viewport.width}.png`, fullPage: true });
  await summaries.first().getByRole('button', { name: '查看交付报告' }).click();
  await expect(page.getByTestId('delivery-report').locator('.concrete-criterion')).toHaveCount(5);
  await expect(page.getByTestId('delivery-report')).toContainText('需人工判断');
});

test('compact summaries and completion count fit a 390px screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await seed(page, 'projection-mixed', true);
  await expect(page.locator('.completed-builds')).toHaveText('已完成1次构建');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(await page.locator('.preview-area').evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(200);
  await mkdir('review-artifacts/usability', { recursive: true });
  await page.getByTitle('应用预览', { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.frameLocator('iframe[title="应用预览"]').getByRole('button', { name: '新增便签' })).toBeVisible();
  await page.screenshot({ path: 'review-artifacts/usability/preview-390.png', fullPage: true });
});
