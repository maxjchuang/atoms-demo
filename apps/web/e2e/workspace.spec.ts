import { test, expect } from '@playwright/test';

const real = process.env.ATOMS_E2E_REAL === '1';
const code = process.env.ATOMS_DEMO_CODE ?? 'atoms-demo-2026';
async function enter(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '开启体验' }).click();
  await page.getByLabel('体验码', { exact: true }).fill(code);
  await page.getByRole('button', { name: '进入创作空间' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

test('generation, refresh recovery, source, modification and rollback', async ({ page }) => {
  await page.goto('/');
  await page.screenshot({ path: test.info().outputPath('dashboard.png'), fullPage: true });
  await enter(page);
  await page.getByLabel('应用需求').fill('构建一个可以新增便签的灵感便签墙，刷新后保留内容。');
  if (real && process.env.ATOMS_E2E_PLAN === '1') await page.getByLabel('构建策略').selectOption('plan');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page).toHaveURL(/#\/projects\//);
  if (real && process.env.ATOMS_E2E_PLAN === '1') {
    await expect(page.getByRole('button', { name: '确认计划，继续本次构建' })).toBeVisible({ timeout: 120000 });
    await page.reload();
    await page.getByRole('button', { name: '确认计划，继续本次构建' }).click();
  }
  await expect(page.locator('.run-card-top > strong').filter({ hasText: /^已交付$/ })).toBeVisible({ timeout: real ? 240000 : 20000 });
  await page.reload();
  await expect(page.locator('.run-card-top > strong').filter({ hasText: /^已交付$/ })).toBeVisible();
  await expect(page.locator('iframe[title="应用预览"]')).toHaveAttribute('src', /.+/);
  if (!real) {
    const preview = page.frameLocator('iframe[title="应用预览"]');
    await expect(preview.getByRole('heading', { name: '灵感便签墙' })).toBeVisible();
    await preview.getByRole('button', { name: '新增便签' }).click();
    await expect(preview.locator('article')).toHaveCount(4);
  } else if (process.env.ATOMS_E2E_FAKE_RUNTIME === '1') {
    const preview = page.frameLocator('iframe[title="应用预览"]');
    await expect(preview.getByRole('heading', { name: '灵感便签墙' })).toBeVisible();
    const before = await preview.getByLabel('便签内容').count();
    await preview.getByRole('button', { name: '新建便签' }).click();
    await expect(preview.getByLabel('便签内容')).toHaveCount(before + 1);
    await preview.getByLabel('便签内容').last().fill('浏览器端到端验收：刷新后保留');
    await page.reload();
    await expect(preview.getByLabel('便签内容').last()).toHaveValue('浏览器端到端验收：刷新后保留');
  }
  await page.screenshot({ path: test.info().outputPath('workspace.png'), fullPage: true });
  await page.getByRole('button', { name: '代码', exact: true }).click();
  await expect(page.getByRole('button', { name: 'src/App.tsx' })).toBeVisible();
  await expect(page.locator('.source-view pre')).toContainText('export');
  await page.getByLabel('构建策略').selectOption('build');
  await page.getByLabel('项目消息').fill('增加便签搜索功能，并调整标题颜色。');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.locator('.run-card-top > strong').filter({ hasText: /^已交付$/ })).toBeHidden();
  await expect(page.locator('.run-card-top > strong').filter({ hasText: /^已交付$/ })).toBeVisible({ timeout: real ? 240000 : 20000 });
  await page.getByRole('button', { name: '版本', exact: true }).click();
  await expect(page.locator('.version-card')).toHaveCount(2);
  await page.getByRole('button', { name: '恢复此版本' }).click();
  await expect(page.locator('.version-card')).toHaveCount(3);
  await expect(page.locator('.version-card').first()).toContainText('当前版本');
});

test('plan confirmation persists across refresh; cancel waits for acknowledgement', async ({ page }) => {
  test.skip(real, 'Mock-only deterministic state transition test; real plan smoke is run separately.');
  await enter(page);
  await page.getByLabel('应用需求').fill('创建一个便签墙，先确认计划。');
  await page.getByLabel('构建策略').selectOption('plan');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('button', { name: '确认计划，继续本次构建' })).toBeVisible({ timeout: 15000 });
  await page.reload();
  await expect(page.getByRole('button', { name: '确认计划，继续本次构建' })).toBeVisible();
  await page.getByRole('button', { name: '确认计划，继续本次构建' }).click();
  await page.getByRole('button', { name: '停止构建' }).click();
  await expect(page.locator('.run-card-top > strong').filter({ hasText: /^已取消$/ })).toBeVisible({ timeout: 15000 });
});

test('failed iteration keeps the previous preview', async ({ page }) => {
  test.skip(real, 'Uses explicit Mock failure injection.');
  await enter(page);
  await page.getByLabel('应用需求').fill('创建便签墙。');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.locator('.run-card-top > strong').filter({ hasText: /^已交付$/ })).toBeVisible({ timeout: 20000 });
  const previous = await page.locator('iframe').getAttribute('src');
  await page.getByLabel('项目消息').fill('修改便签墙，模拟失败场景');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.locator('.run-card-top > strong').filter({ hasText: /^未能完成$/ })).toBeVisible({ timeout: 20000 });
  await expect(page.locator('iframe')).toHaveAttribute('src', previous!);
});
