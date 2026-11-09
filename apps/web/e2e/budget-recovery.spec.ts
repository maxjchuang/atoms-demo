import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
test.beforeEach(async () => { test.skip(process.env.ATOMS_E2E_REAL === '1', 'Explicit synthetic recovery Mock only; no model/user-source execution.'); await mkdir('review-artifacts/budget-recovery', { recursive: true }); });
async function setup(page: Page, scenario = 'eligible', activity = true) {
  await page.goto('/'); await expect(page.getByLabel('应用需求', { exact: true })).toBeVisible();
  const subject = await page.evaluate(async scenario => {
    const post = async (path: string, body: unknown) => { const result = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `test_${crypto.randomUUID()}` }, body: JSON.stringify(body) }); if (!result.ok) throw new Error(`Mock setup ${result.status}`); return result.json(); };
    await post('/api/v1/sessions', { code: 'atoms-demo-2026' }); const project = await post('/api/v1/projects', { title: '预算续作 Mock' });
    const { runId } = await post('/__mock/budget-recovery/seed', { projectId: project.id, scenario }); return { projectId: project.id as string, runId: runId as string };
  }, scenario);
  await page.goto(`/#/projects/${subject.projectId}`); await page.reload(); await expect(page.getByRole('tab', { name: '项目对话', exact: true })).toBeVisible();
  if (activity) { await page.getByRole('tab', { name: /构建活动/ }).click(); await expect(page.getByTestId('budget-recovery')).toBeVisible(); } return subject;
}
const panel = (page: Page) => page.getByTestId('budget-recovery');
const continueButton = (page: Page) => panel(page).getByRole('button', { name: '消耗1次构建额度，追加预算并继续', exact: true });
async function stats(page: Page, runId: string) { return page.evaluate(async id => (await fetch(`/__mock/budget-recovery/${id}/stats`)).json(), runId); }

test('default chat immediately shows typed budget cause and limit without opening activity or creating work', async ({ page }) => {
  const { runId } = await setup(page, 'eligible', false);
  await expect(page.getByRole('tab', { name: '项目对话', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.current-run-strip')).toContainText('后续请求预留超过剩余输入 Token预算'); await expect(page.locator('.current-run-strip')).toContainText('本段上限 65,536');
  await expect(page.locator('.current-run-strip')).not.toContainText('DSH execution aborted'); await expect(panel(page)).toHaveCount(0); expect((await stats(page, runId)).postCount).toBe(0);
});

test('typed cause replaces generic abort summary, unknown settlement stays unknown; explicit fixed budget reserves one linked successor', async ({ page }) => {
  const { runId, projectId } = await setup(page); await expect(panel(page)).toContainText('已观察下界：至少 50,000'); await expect(panel(page)).toContainText('最终已结算：未知'); await expect(panel(page)).toContainText('预留不等于这些 Token 已被消费');
  await expect(page.getByLabel('任务过程反馈')).toContainText('后续请求预留超过剩余输入 Token预算'); await page.getByText('原执行错误（历史记录）', { exact: true }).click(); await expect(page.getByLabel('任务过程反馈')).toContainText('DSH execution aborted');
  await expect(panel(page)).toContainText('65,536 / 输出 24,576'); await expect(panel(page)).toContainText('8 个模型步骤、15 分钟、2 轮修复'); await expect(panel(page)).toContainText('不会自动修正验收语义');
  await continueButton(page).click(); await expect(panel(page)).toContainText('后续任务已建立'); await expect(panel(page)).toContainText('原任务仍为失败记录'); expect((await stats(page, runId)).postCount).toBe(1);
  const source = await page.evaluate(async id => (await fetch(`/api/v1/runs/${id}`)).json(), runId); expect(source.status).toBe('failed'); expect(source.error.message).toContain('DSH execution aborted');
  const snapshot = await page.evaluate(async id => (await fetch(`/api/v1/projects/${id}/workspace`)).json(), projectId); expect(snapshot.latestRun.id).not.toBe(runId);
  await page.screenshot({ path: 'review-artifacts/budget-recovery/successor.png' });
});

for (const scenario of ['plan-review', 'steps', 'missing-source', 'stop-unconfirmed', 'no-quota', 'legacy']) test(`${scenario} never offers an inferred paid token continuation`, async ({ page }) => {
  const { runId } = await setup(page, scenario); await expect(panel(page)).not.toContainText('正在读取权威'); await expect(continueButton(page)).toHaveCount(0); expect((await stats(page, runId)).postCount).toBe(0);
  if (scenario === 'plan-review') { await expect(panel(page)).toContainText('验收计划需要重新审阅'); await expect(panel(page)).toContainText('不能付额继续原计划'); await panel(page).getByRole('button', { name: /返回项目对话审阅需求/ }).click(); await expect(page.getByRole('tab', { name: '项目对话' })).toHaveAttribute('aria-selected', 'true'); }
  if (scenario === 'legacy') await expect(panel(page)).toContainText('未记录可信的细分预算诊断');
});

test('response loss and reload reconcile existing successor without new request/key or duplicate spend', async ({ page }) => {
  const { runId } = await setup(page, 'response-lost'); await continueButton(page).click(); await expect(panel(page)).toContainText('提交结果尚未确认');
  await page.reload(); await expect(panel(page)).toContainText('该中止任务已创建过后续任务'); expect((await stats(page, runId)).postCount).toBe(1);
  await expect(panel(page)).toContainText('任务链起点'); await expect(continueButton(page)).toHaveCount(0);
});

test('gateway 408 preserves uncertain request and reload reconciles the already admitted successor', async ({ page }) => {
  const { runId } = await setup(page, 'gateway-408'); await continueButton(page).click(); await expect(panel(page)).toContainText('提交结果尚未确认');
  await page.reload(); await expect(panel(page)).toContainText('该中止任务已创建过后续任务'); expect((await stats(page, runId)).postCount).toBe(1);
});

test('stale offer requires reread and another deliberate click, never silently changes source authorization', async ({ page }) => {
  const { runId } = await setup(page, 'stale'); await continueButton(page).click(); await expect(panel(page).getByRole('alert')).toContainText('报价已变化');
  expect((await stats(page, runId)).postCount).toBe(1); await expect(continueButton(page)).toHaveCount(0);
  await panel(page).getByRole('button', { name: '重新读取预算状态' }).click(); await expect(continueButton(page)).toBeEnabled(); expect((await stats(page, runId)).postCount).toBe(1);
  await continueButton(page).click(); await expect(panel(page)).toContainText('后续任务已建立'); expect((await stats(page, runId)).postCount).toBe(2);
});

test('rapid duplicate activation dispatches one stable authorization while acceptance is pending', async ({ page }) => {
  const { runId } = await setup(page, 'slow-submit'); const writes: {path: string; key: string | undefined}[] = [];
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/')) writes.push({ path: new URL(request.url()).pathname, key: request.headers()['idempotency-key'] }); });
  await continueButton(page).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(panel(page)).toContainText('正在确认后续任务'); await expect(continueButton(page)).toHaveCount(0);
  await expect(panel(page)).toContainText('后续任务已建立'); expect((await stats(page, runId)).postCount).toBe(1);
  expect(writes).toHaveLength(1); expect(writes[0].path).toBe(`/api/budget-recovery/v1/runs/${runId}/continue`); expect(writes[0].key).toMatch(/^web_/);
});

test('leaving a project during continuation does not let a late receipt navigate or overwrite the new view', async ({ page }) => {
  await setup(page, 'slow-submit'); await continueButton(page).click();
  await page.getByRole('button', { name: '我的项目', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: '我的项目', exact: true })).toBeVisible(); await page.waitForTimeout(900);
  await expect(panel(page)).toHaveCount(0); expect(new URL(page.url()).hash).not.toMatch(/projects\//);
});

test('output-token diagnosis is distinct and readonly proposal baseline does not invent a published app', async ({ page }) => {
  await setup(page, 'output'); await expect(panel(page)).toContainText('输出 Token'); await expect(panel(page)).toContainText('本段上限：24,576'); await expect(page.getByLabel('任务过程反馈')).toContainText('输出 Token达到本段上限');
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) test(`budget cost and boundaries stay readable at ${viewport.width}`, async ({ page }) => {
  await page.setViewportSize(viewport); await setup(page); await expect(continueButton(page)).toBeEnabled(); await continueButton(page).scrollIntoViewIfNeeded();
  expect(await panel(page).evaluate(el => getComputedStyle(el).fontSize)).toBe('14px'); expect(await panel(page).locator('small').first().evaluate(el => getComputedStyle(el).fontSize)).toBe('12px'); expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: `review-artifacts/budget-recovery/offer-${viewport.width}.png` });
});
