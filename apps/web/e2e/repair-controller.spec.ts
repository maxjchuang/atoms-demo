import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
test.beforeEach(async () => { test.skip(process.env.ATOMS_E2E_REAL === '1', 'Synthetic Mock only; no model or live writes.'); });
const panel = (page: Page) => page.getByTestId('delivery-report');
async function post(page: Page, path: string, body: unknown) {
  return page.evaluate(async ({ path, body }) => { const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `test_${crypto.randomUUID()}` }, body: JSON.stringify(body) }); if (!response.ok) throw new Error(await response.text()); return response.json(); }, { path, body });
}
async function setup(page: Page, scenario: string, phase?: string) {
  await page.goto('/'); await expect(page.getByRole('button', { name: '开启体验' })).toBeVisible();
  await post(page, '/api/v1/sessions', { code: 'atoms-demo-2026' });
  const project = await post(page, '/api/v1/projects', { title: 'Synthetic repair controller review' });
  const { run } = await post(page, `/api/v1/projects/${project.id}/runs`, { prompt: '[long-wait] synthetic only', mode: 'build' });
  await post(page, '/__mock/delivery/seed', { projectId: project.id, scenario, ...(phase ? { controllerPhase: phase, controllerMessage: 'Mock executor: failed clean behavior, returning to repair of the frozen plan.' } : { stopRun: true }) });
  return { projectId: project.id as string, runId: run.id as string };
}
async function open(page: Page, projectId: string) { await page.goto(`/#/projects/${projectId}`); await page.reload(); await expect(page.getByRole('button', { name: '交付报告', exact: true })).toBeVisible(); }
async function report(page: Page) { await page.getByRole('button', { name: '交付报告', exact: true }).click(); await expect(panel(page)).toBeVisible(); }

test('historical clean behavior failure is readable without overwriting latest planning failure or inventing a version', async ({ page }) => {
  const first = await setup(page, 'clean-behavior-failed');
  const { run: latest } = await post(page, `/api/v1/projects/${first.projectId}/runs`, { prompt: '[long-wait] new synthetic planning', mode: 'build' });
  await post(page, '/__mock/delivery/seed', { projectId: first.projectId, subjectId: first.runId, scenario: 'clean-behavior-failed' });
  await post(page, '/__mock/delivery/seed', { projectId: first.projectId, subjectId: latest.id, scenario: 'planning-failure', stopRun: true });
  await open(page, first.projectId); await report(page);
  await expect(panel(page)).toHaveAttribute('data-subject-id', latest.id); await expect(panel(page)).toContainText('尚无执行尝试');
  const writes: string[] = []; page.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()); });
  await page.getByLabel('报告对象', { exact: true }).selectOption(`runs:${first.runId}`);
  await expect(panel(page)).toHaveAttribute('data-subject-id', first.runId);
  await expect(panel(page)).toContainText('历史任务报告'); await expect(panel(page).locator('.candidate-case-summary')).toContainText('通过');
  const clean = panel(page).getByTestId('clean-verification'); await expect(clean).toContainText('1 项失败');
  await expect(clean).toContainText('dx=20, dy=0, tolerance=4'); await expect(clean).toContainText('dx=29, dy=174');
  await expect(clean).toContainText('独立源码 ZIP 行为复验'); await expect(page.getByTitle('应用预览', { exact: true })).toHaveCount(0);
  await expect(page.locator('.current-run-strip')).toContainText('Synthetic plan validation failed');
  expect(writes).toEqual([]); expect(await panel(page).evaluate(element => getComputedStyle(element).fontSize)).toBe('14px'); expect(await clean.locator('small').first().evaluate(element => getComputedStyle(element).fontSize)).toBe('12px'); await clean.scrollIntoViewIfNeeded(); await mkdir('review-artifacts/repair-controller', { recursive: true });
  await page.screenshot({ path: 'review-artifacts/repair-controller/history-clean-failure-1440-mock.png' });
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await clean.scrollIntoViewIfNeeded(); await page.screenshot({ path: 'review-artifacts/repair-controller/history-clean-failure-390-mock.png', fullPage: true });
});

test('nonfinal clean failure stays a running repair, repair source and prior evidence survive, publication requires actual Version', async ({ page }) => {
  const subject = await setup(page, 'clean-repair-loop', 'repairing'); await open(page, subject.projectId);
  await page.getByRole('tab', { name: '构建活动', exact: true }).click();
  await expect(page.locator('[aria-label="本轮验证修复进展"]')).toContainText('只代表该尝试');
  await expect(page.locator('[aria-label="本轮验证修复进展"]')).toContainText('剩余预算暂未提供');
  await report(page); await expect(panel(page)).toContainText('过程报告'); await expect(panel(page).getByTestId('clean-verification')).toContainText('1 项失败');
  await expect(page.getByTitle('应用预览', { exact: true })).toHaveCount(0);
  await post(page, '/__mock/delivery/seed', { projectId: subject.projectId, scenario: 'clean-repair-complete', controllerPhase: 'publishing', controllerMessage: 'Mock executor: repaired source passed clean verification, awaiting host publication.' });
  await expect(panel(page).locator('.delivery-attempt')).toHaveCount(2); await expect(panel(page)).toContainText('尚未发布');
  await expect(panel(page).getByTestId('clean-verification')).toContainText('0 项失败');
  await panel(page).locator('.retained-evidence summary').click(); await expect(panel(page).locator('.retained-evidence')).toContainText('evidence_clean_previous');
  const previous = panel(page).locator('.retained-evidence article').filter({ hasText: 'evidence_clean_previous' }); await previous.getByRole('button', { name: '查看证据', exact: true }).click(); await expect(previous.locator('pre')).toContainText('dx=29, dy=174');
  await expect(page.getByTitle('应用预览', { exact: true })).toHaveCount(0);
  await post(page, '/__mock/delivery/seed', { projectId: subject.projectId, scenario: 'clean-repair-complete', finishFakeRun: true });
  await expect(panel(page)).toContainText('此版本已发布');
  await page.getByRole('button', { name: '预览', exact: true }).click(); await expect(page.getByTitle('应用预览', { exact: true })).toBeVisible();
});

test('late historical Run report cannot replace the newly selected latest report', async ({ page }) => {
  const first = await setup(page, 'clean-behavior-failed');
  const { run } = await post(page, `/api/v1/projects/${first.projectId}/runs`, { prompt: '[long-wait] synthetic latest', mode: 'build' });
  await post(page, '/__mock/delivery/seed', { projectId: first.projectId, subjectId: first.runId, scenario: 'clean-behavior-failed', delayMs: 1300 });
  await post(page, '/__mock/delivery/seed', { projectId: first.projectId, subjectId: run.id, scenario: 'planning-failure', stopRun: true });
  await open(page, first.projectId); await report(page);
  const select = page.getByLabel('报告对象', { exact: true }); await select.selectOption(`runs:${first.runId}`); await expect(panel(page)).toHaveAttribute('data-subject-id', first.runId);
  await select.selectOption(`runs:${run.id}`); await expect(panel(page)).toContainText('尚无执行尝试');
  await page.waitForTimeout(1600); await expect(panel(page)).toHaveAttribute('data-subject-id', run.id); await expect(panel(page)).toContainText('尚无执行尝试'); await expect(panel(page)).not.toContainText('dx=29');
});

test('project switch fences an in-flight report and readonly activity opens the exact task', async ({ page }) => {
  const first = await setup(page, 'clean-behavior-failed');
  await post(page, '/__mock/delivery/seed', { projectId: first.projectId, scenario: 'clean-behavior-failed', delayMs: 1300 });
  const project = await post(page, '/api/v1/projects', { title: 'Other synthetic project' });
  const { run } = await post(page, `/api/v1/projects/${project.id}/runs`, { prompt: '[long-wait] synthetic other', mode: 'build' });
  await post(page, '/__mock/delivery/seed', { projectId: project.id, scenario: 'planning-failure', stopRun: true });
  await open(page, first.projectId); await report(page);
  await page.goto(`/#/projects/${project.id}`); await page.getByRole('tab', { name: '构建活动', exact: true }).click();
  await expect(page.locator('.feedback-card')).toContainText('当前没有可预览版本');
  const writes: string[] = []; page.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()); });
  await page.getByRole('button', { name: '查看此任务交付报告', exact: true }).click(); await expect(panel(page)).toHaveAttribute('data-subject-id', run.id);
  await expect(panel(page)).toContainText('尚无执行尝试'); await page.waitForTimeout(1600);
  await expect(panel(page)).toHaveAttribute('data-subject-id', run.id); await expect(panel(page)).not.toContainText('dx=29'); expect(writes).toEqual([]);
});


test('not-run clean cases remain distinct from missing results and long goal expands only on request', async ({ page }) => {
  const subject = await setup(page, 'clean-cases-not-run'); await open(page, subject.projectId);
  await page.getByRole('tab', { name: '构建活动', exact: true }).click();
  const progress = page.locator('[aria-label="本轮验证修复进展"]');
  await expect(progress).toContainText('剩余预算暂未提供'); await expect(progress).toContainText('剩余预算暂未提供');
  await expect(progress.getByText(/END OF FULL GOAL/)).not.toBeVisible();
  await progress.getByText('查看本轮完整目标', { exact: true }).click(); await expect(progress.getByText(/END OF FULL GOAL/)).toBeVisible();
  await report(page); const clean = panel(page).getByTestId('clean-verification');
  await expect(clean).toContainText('0 项结果未返回'); await expect(clean).toContainText('实际返回 6 项结果'); await expect(clean.locator('.case-result')).toHaveCount(6); await expect(clean).toContainText('6 项已返回但未通过或未运行');
  await expect(clean).toContainText('干净安装未通过');
});
