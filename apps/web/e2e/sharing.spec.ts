import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
test.beforeEach(async () => { test.skip(process.env.ATOMS_E2E_REAL === '1', 'Sharing synthetic Mock tests only; external proof uses a separate allowlisted audit.'); await mkdir('review-artifacts/m3-mock', { recursive: true }); });
async function configure(page: Page, scenario = 'configured', extras = {}) { await page.evaluate(async body => { await fetch('/__mock/sharing/seed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }, { scenario, ...extras }); }
async function setup(page: Page, scenario = 'configured', hasVersion = true) {
  await page.goto('/'); await expect(page.getByLabel('应用需求', { exact: true })).toBeVisible();
  const subject = await page.evaluate(async hasVersion => {
    const post = async (path: string, body: unknown) => { const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `test_${crypto.randomUUID()}` }, body: JSON.stringify(body) }); if (!response.ok) throw new Error(`Seed ${response.status}`); return response.json(); };
    await post('/api/v1/sessions', { code: 'atoms-demo-2026' });
    const project = await post('/api/v1/projects', { title: '分享体验 Mock 评审' });
    if (hasVersion) {
      await post(`/api/v1/projects/${project.id}/runs`, { prompt: '构建便签墙', mode: 'build' });
      for (let i = 0; i < 9; i++) await fetch(`/api/v1/projects/${project.id}/events?after=0`);
      await post('/__mock/delivery/seed', { projectId: project.id, scenario: 'partial' });
    }
    return { projectId: project.id as string };
  }, hasVersion);
  await configure(page, scenario);
  await page.goto(`/#/projects/${subject.projectId}`); await page.reload(); await expect(page.getByRole('button', { name: '分享当前应用' })).toBeVisible();
  return subject;
}
async function counters(page: Page, projectId: string) {
  return page.evaluate(async projectId => {
    const workspace = await (await fetch(`/api/v2/projects/${projectId}/workspace`)).json(), session = await (await fetch('/api/v2/session')).json();
    return { projectRevision: workspace.execution.project.revision, latestRunId: workspace.execution.latestRun?.id, versionId: workspace.execution.currentVersion?.id, messageIds: workspace.messages.map((item: { id: string }) => item.id), conversationRevision: workspace.conversationRevision, quota: session.session.quota, coordinationQuota: session.coordinationQuota };
  }, projectId);
}
const dialog = (page: Page) => page.getByTestId('sharing-dialog');
async function open(page: Page) { await page.getByRole('button', { name: '分享当前应用' }).click(); await expect(dialog(page).getByRole('heading', { name: '分享与体验' })).toBeVisible(); }

test('actual browser clipboard copy binds a published version, preserves partial and creates no messages/Runs/quota usage', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { projectId } = await setup(page), before = await counters(page, projectId);
  const writes: string[] = []; page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/')) writes.push(new URL(request.url()).pathname); });
  await open(page); await expect(dialog(page).getByTestId('delivery-summary')).toContainText('部分交付');
  await expect(dialog(page)).toContainText('外部浏览器验收尚未记录'); await expect(dialog(page)).toContainText('没有项目级存储隔离');
  await dialog(page).getByRole('button', { name: '复制应用链接', exact: true }).click(); await expect(dialog(page).locator('.sharing-result')).toContainText('链接已复制');
  const link = await dialog(page).getByLabel('固定版本的临时预览链接').inputValue();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  expect(link).toMatch(/^https:\/\/preview-demo\.example\.test\/p\//);
  await expect(dialog(page)).toContainText('新链接不会延长已发出的旧链接');
  expect(await counters(page, projectId)).toEqual(before); expect(writes).toEqual([`/api/sharing/v1/projects/${projectId}/resolve`]);
  expect(await dialog(page).evaluate(el => getComputedStyle(el).fontSize)).toBe('14px');
  expect(await dialog(page).locator('.sharing-limits').evaluate(el => getComputedStyle(el).fontSize)).toBe('12px');
  await page.screenshot({ path: 'review-artifacts/m3-mock/share-partial.png', mask: [dialog(page).locator('.sharing-link input')] });
});

test('build invitation is exact workbench root with no code/session, not preview/source access', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']); await setup(page); await open(page);
  await dialog(page).getByRole('button', { name: '邀请体验构建', exact: true }).click(); await expect(dialog(page)).toContainText('对方仍需另行取得体验码');
  await dialog(page).getByRole('button', { name: '复制工作台入口', exact: true }).click(); await expect(dialog(page).locator('.sharing-result')).toContainText('链接已复制');
  expect(await dialog(page).getByLabel('工作台入口（不含体验码）').inputValue()).toBe('https://workbench-demo.example.test/');
  await expect(dialog(page)).toContainText('null 不代表永久有效'); await expect(dialog(page)).toContainText('不会自动登录');
  await page.screenshot({ path: 'review-artifacts/m3-mock/build-invitation.png', mask: [dialog(page).locator('.sharing-link input')] });
});

test('clipboard denial is manual copy with no fabricated success and keyboard escape restores focus', async ({ page }) => {
  await setup(page); await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new DOMException('Denied', 'NotAllowedError'); } } }));
  await open(page); await dialog(page).getByRole('button', { name: '复制应用链接', exact: true }).click();
  await expect(dialog(page).locator('.sharing-result')).toContainText('手动复制'); await expect(dialog(page).locator('.sharing-result')).not.toContainText('链接已复制');
  await dialog(page).getByRole('button', { name: '选中链接', exact: true }).click();
  expect(await dialog(page).locator('input').evaluate(el => { const input = el as HTMLInputElement; return input.selectionStart === 0 && input.selectionEnd === input.value.length; })).toBe(true);
  await page.screenshot({ path: 'review-artifacts/m3-mock/clipboard-denied.png', mask: [dialog(page).locator('.sharing-link input')] });
  await page.keyboard.press('Escape'); await expect(dialog(page)).toHaveCount(0); await expect(page.getByRole('button', { name: '分享当前应用' })).toBeFocused();
});

for (const scenario of ['local', 'unavailable']) test(`${scenario} never presents a usable public copy button`, async ({ page }) => {
  await setup(page, scenario); await open(page);
  await expect(dialog(page)).toContainText(scenario === 'local' ? '仅本机可访问' : '公网入口暂不可用');
  await expect(dialog(page).getByRole('button', { name: '复制应用链接', exact: true })).toBeDisabled(); await expect(dialog(page).locator('.sharing-link')).toHaveCount(0);
  await dialog(page).getByRole('button', { name: '邀请体验构建', exact: true }).click(); await expect(dialog(page).getByRole('button', { name: '复制工作台入口', exact: true })).toBeDisabled();
});

test('no version offers only build invitation and never resolves latest implicitly', async ({ page }) => {
  await setup(page, 'configured', false); await open(page); await expect(dialog(page)).toContainText('尚无已发布版本'); await expect(dialog(page).getByRole('button', { name: '复制应用链接', exact: true })).toBeDisabled();
  await dialog(page).getByRole('button', { name: '邀请体验构建', exact: true }).click(); await expect(dialog(page).getByRole('button', { name: '复制工作台入口', exact: true })).toBeEnabled();
});

test('dialog opened without a version remains invitation-only after the first version publishes', async ({ page }) => {
  const { projectId } = await setup(page, 'configured', false); await open(page);
  const writes: string[] = []; page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/resolve')) writes.push(request.postDataJSON().kind); });
  await page.evaluate(async projectId => {
    await fetch(`/api/v1/projects/${projectId}/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `test_${crypto.randomUUID()}` }, body: JSON.stringify({ prompt: 'Mock first published version for fixed-empty-target regression', mode: 'build' }) });
    for (let i = 0; i < 9; i++) await fetch(`/api/v1/projects/${projectId}/events?after=0`);
  }, projectId);
  await dialog(page).getByRole('button', { name: '重新读取', exact: true }).click();
  // GET without a version now describes a current publication; the captured UI
  // subject is still null, so no new publication becomes an implicit target.
  await expect(dialog(page).getByTestId('sharing-facts')).toContainText('链接最长有效');
  await expect(dialog(page).locator('.sharing-subject')).toContainText('尚无已发布版本');
  await expect(dialog(page).getByRole('button', { name: '复制应用链接', exact: true })).toBeDisabled();
  await expect(dialog(page).getByRole('button', { name: '新窗口打开', exact: true })).toBeDisabled();
  await expect(dialog(page).locator('.sharing-link')).toHaveCount(0); expect(writes).toEqual([]);
  await dialog(page).getByRole('button', { name: '邀请体验构建', exact: true }).click();
  await expect(dialog(page).getByRole('button', { name: '复制工作台入口', exact: true })).toBeEnabled();
});

for (const scenario of ['resolve-409', 'resolve-429', 'resolve-503', 'resolve-network', 'expired', 'foreign-subject', 'unsafe-origin']) test(`${scenario} does not expose a usable capability or fake success`, async ({ page }) => {
  await setup(page, scenario); await open(page); await dialog(page).getByRole('button', { name: '复制应用链接', exact: true }).click();
  await expect(dialog(page).getByRole('alert')).toBeVisible(); await expect(dialog(page).locator('.sharing-link')).toHaveCount(0); await expect(dialog(page).locator('.sharing-result')).not.toContainText('已复制');
  if (scenario === 'resolve-429') { await expect(dialog(page).getByRole('button', { name: '重新读取', exact: true })).toBeDisabled(); await expect(dialog(page)).toContainText('秒后重试'); }
});

test('short-lived link visibly expires; popup denial offers a validated manual open link', async ({ page }) => {
  await setup(page, 'short-expiry'); await open(page); await page.evaluate(() => { window.open = () => null; });
  await dialog(page).getByRole('button', { name: '新窗口打开', exact: true }).click();
  await expect(dialog(page).locator('.sharing-result')).toContainText('阻止了新窗口'); await expect(dialog(page).getByRole('link', { name: '打开已解析链接' })).toBeVisible();
  await expect(dialog(page)).toContainText('已到期，请重新获取', { timeout: 5000 }); await expect(dialog(page).getByRole('link', { name: '打开已解析链接' })).toHaveCount(0);
});

test('new published current version never silently changes an already open share subject', async ({ page }) => {
  const { projectId } = await setup(page); await open(page);
  const oldVersionId = (await counters(page, projectId)).versionId;
  await page.evaluate(async ({ projectId, oldVersionId }) => {
    const workspace = await (await fetch(`/api/v1/projects/${projectId}/workspace`)).json();
    await fetch(`/api/v1/projects/${projectId}/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `test_${crypto.randomUUID()}` }, body: JSON.stringify({ versionId: oldVersionId, expectedProjectRevision: workspace.project.revision }) });
  }, { projectId, oldVersionId });
  await expect(dialog(page)).toContainText('本窗口仍分享所选版本');
  const requests: { versionId: string }[] = []; page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/resolve')) requests.push(request.postDataJSON()); });
  await dialog(page).getByRole('button', { name: '复制应用链接', exact: true }).click(); await expect(dialog(page).locator('.sharing-link')).toBeVisible();
  expect(requests.at(-1)?.versionId).toBe(oldVersionId); expect((await counters(page, projectId)).versionId).not.toBe(oldVersionId);
});

test('401 reauthentication preserves share intention and does not replay a user message or Run', async ({ page }) => {
  const { projectId } = await setup(page, 'descriptor-401'); await open(page); await dialog(page).getByRole('button', { name: '重新输入体验码' }).click();
  await expect(page.getByRole('dialog', { name: '让想法开始生长' })).toBeVisible();
  await configure(page); await page.getByLabel('体验码', { exact: true }).fill('atoms-demo-2026'); await page.getByRole('button', { name: '进入创作空间' }).click();
  await expect(dialog(page)).toBeVisible(); await expect(dialog(page).getByRole('button', { name: '复制应用链接', exact: true })).toBeEnabled();
  expect((await counters(page, projectId)).quota.runsUsed).toBe(1);
});

test('rotation requires a fresh deliberate click and delayed closed dialog cannot copy', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']); await setup(page); await open(page);
  await configure(page, 'rotated'); await dialog(page).getByRole('button', { name: '复制应用链接', exact: true }).click(); await expect(dialog(page).getByRole('alert')).toContainText('部署入口已变化');
  await dialog(page).getByRole('button', { name: '重新读取', exact: true }).click(); await expect(dialog(page).getByRole('button', { name: '复制应用链接', exact: true })).toBeEnabled();
  await page.evaluate(() => navigator.clipboard.writeText('unchanged-before-delayed-response'));
  await configure(page, 'configured', { resolveDelayMs: 700 });
  await dialog(page).getByRole('button', { name: '关闭分享窗口' }).click(); await open(page);
  await dialog(page).getByRole('button', { name: '复制应用链接', exact: true }).click(); await dialog(page).getByRole('button', { name: '关闭分享窗口' }).click();
  await page.waitForTimeout(900); expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('unchanged-before-delayed-response'); await expect(dialog(page)).toHaveCount(0);
});

for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) test(`sharing dialog is readable and keyboard reachable at ${viewport.width}`, async ({ page }) => {
  await page.setViewportSize(viewport); await setup(page); await open(page); await expect(dialog(page).getByRole('button', { name: '复制应用链接', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false); expect(await dialog(page).evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false);
  expect(await dialog(page).evaluate(el => getComputedStyle(el).fontSize)).toBe('14px');
  await page.screenshot({ path: `review-artifacts/m3-mock/dialog-${viewport.width}.png` });
});
