import { test, expect } from '@playwright/test';

const real = process.env.ATOMS_E2E_REAL === '1';
for (const viewport of [{ width: 1440, height: 1000 }, { width: 1366, height: 768 }]) {
  test(`readable typography and contained layout at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    test.skip(real, 'Mock-only deterministic layout test; live audit uses GET/session only.');
    await page.setViewportSize(viewport); await page.goto('/');
    await expect(page.locator('.hero h1')).toHaveCSS('font-size', '36px');
    await expect(page.locator('.hero h1')).toHaveCSS('line-height', '45px');
    await expect(page.getByLabel('应用需求')).toHaveCSS('font-size', '16px');
    await page.getByRole('button', { name: '开启体验' }).click();
    await page.getByLabel('体验码', { exact: true }).fill('atoms-demo-2026');
    await page.getByRole('button', { name: '进入创作空间' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.getByLabel('应用需求').fill('构建便签墙，验证字体与布局。');
    await page.getByRole('button', { name: '开始构建', exact: true }).click();
    await expect(page.locator('.run-card-top > strong')).toHaveText('已交付', { timeout: 20000 });
    await page.locator('.activity-details summary').click();
    for (const selector of ['.message p', '.run-card-top strong', '.feedback-card .current-activity p', '.output-tabs button', '.workspace-composer textarea']) {
      await expect(page.locator(selector).first()).toHaveCSS('font-size', '14px');
    }
    for (const selector of ['.execution-times', '.api-sync', '.execution-timeline strong', '.execution-timeline p']) {
      await expect(page.locator(selector).first()).toHaveCSS('font-size', '12px');
    }
    const result = await page.evaluate(() => ({
      width: innerWidth, scroll: document.documentElement.scrollWidth, scale: visualViewport!.scale,
      overflow: ['.composer-bottom', '.output-toolbar', '.conversation-panel'].filter(selector => {
        const element = document.querySelector<HTMLElement>(selector)!;
        return element.scrollWidth > element.clientWidth + 1;
      }),
      textarea: document.querySelector('.workspace-composer textarea')!.getBoundingClientRect().toJSON(),
      composer: document.querySelector('.workspace-composer .composer')!.getBoundingClientRect().toJSON(),
    }));
    expect(result.scale).toBe(1); expect(result.scroll).toBeLessThanOrEqual(viewport.width + 1);
    expect(result.overflow).toEqual([]);
    expect(result.textarea.right).toBeLessThanOrEqual(result.composer.right);
    expect(result.textarea.left).toBeGreaterThanOrEqual(result.composer.left);
    await page.locator('.feedback-card').scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath(`typography-workspace-${viewport.width}.png`) });
  });
}
