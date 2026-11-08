import { test, expect } from '@playwright/test';

test('existing real project: preview interaction, source and refresh recovery without a model call', async ({ page }) => {
  const projectId = process.env.ATOMS_E2E_EXISTING_PROJECT;
  test.skip(process.env.ATOMS_E2E_REAL !== '1' || !projectId, 'Requires an existing real-service project ID; never creates a run.');
  await page.goto('/');
  await page.getByRole('button', { name: '开启体验' }).click();
  await page.getByLabel('体验码', { exact: true }).fill(process.env.ATOMS_DEMO_CODE ?? 'atoms-demo-2026');
  await page.getByRole('button', { name: '进入创作空间' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.goto(`/#/projects/${projectId}`);
  await expect(page.locator('.output-panel iframe')).toBeVisible();
  const preview = page.frameLocator('iframe[title="应用预览"]');
  await expect(preview.locator('body')).not.toBeEmpty();
  // The selected fixture project must expose one of these meaningful add actions.
  const add = preview.getByRole('button', { name: /新增便签|添加便签|新建便签|新增|添加|New note|Add note/i }).first();
  await expect(add).toBeVisible();
  await add.click();
  await page.screenshot({ path: test.info().outputPath('existing-workspace.png'), fullPage: true });
  const url = await page.locator('iframe').getAttribute('src');
  await page.reload();
  await expect(page.locator('iframe')).toHaveAttribute('src', url!);
  await expect(preview.locator('body')).not.toBeEmpty();
  await page.getByRole('button', { name: '代码', exact: true }).click();
  await expect(page.locator('.file-tree button').first()).toBeVisible();
  await expect(page.locator('.source-view pre')).not.toHaveText('');
  await page.getByRole('button', { name: '版本', exact: true }).click();
  await expect(page.locator('.version-card').first()).toBeVisible();
  await expect(page.getByText('独立 Mock 模式', { exact: false })).toBeHidden();
});
