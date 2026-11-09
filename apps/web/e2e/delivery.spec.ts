import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const real = process.env.ATOMS_E2E_REAL === '1';
test.beforeEach(async () => { test.skip(real, 'M2 synthetic contract Mock only; never target a live model service.'); await mkdir('review-artifacts/m2', { recursive: true }); });
async function seed(page: Page, scenario = 'complete') {
  await page.goto('/'); await expect(page.getByRole('button', { name: '开启体验' })).toBeVisible();
  const subject = await page.evaluate(async scenario => {
    const post = async (path: string, body: unknown) => { const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `test_${crypto.randomUUID()}` }, body: JSON.stringify(body) }); if (!response.ok) throw new Error(await response.text()); return response.json(); };
    await post('/api/v1/sessions', { code: 'atoms-demo-2026' });
    const project = await post('/api/v1/projects', { title: '可信交付 Mock 评审' });
    const { run } = await post(`/api/v1/projects/${project.id}/runs`, { prompt: '构建一个便签墙', mode: 'build' });
    for (let i = 0; i < 9; i++) await fetch(`/api/v1/projects/${project.id}/events?after=0`);
    const workspace = await (await fetch(`/api/v1/projects/${project.id}/workspace`)).json();
    await post('/__mock/delivery/seed', { projectId: project.id, scenario });
    return { projectId: project.id as string, versionId: workspace.currentVersion.id as string, runId: run.id as string };
  }, scenario);
  await page.goto(`/#/projects/${subject.projectId}`); await page.reload();
  await expect(page.getByRole('button', { name: '交付报告', exact: true })).toBeVisible();
  return subject;
}
async function report(page: Page) { await page.getByRole('button', { name: '交付报告', exact: true }).click(); await expect(page.getByTestId('delivery-report')).toBeVisible(); }
async function configure(page: Page, projectId: string, scenario: string, subjectId?: string) { await page.evaluate(async body => { await fetch('/__mock/delivery/seed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }, { projectId, scenario, subjectId }); }
const panel = (page: Page) => page.getByTestId('delivery-report');

test('complete report, safe evidence, actual archive hash download and quality independent from lifecycle', async ({ page }) => {
  await seed(page); await expect(page.getByTestId('delivery-summary').first()).toContainText('约定验收完成'); await report(page);
  await expect(panel(page)).toContainText('此版本已发布'); await expect(panel(page)).toContainText('精确 ZIP 已完成干净安装与复验');
  await panel(page).getByText('基础检查详情与日志', { exact: true }).first().click();
  await panel(page).getByRole('button', { name: '查看证据', exact: true }).first().click();
  await expect(panel(page).locator('.delivery-evidence pre').first()).toContainText('MOCK EVIDENCE');
  expect(await page.evaluate(() => 'evidenceExecuted' in window)).toBe(false);
  const download = page.waitForEvent('download'); await panel(page).getByRole('button', { name: '下载已核对源码 ZIP' }).click(); expect((await download).suggestedFilename()).toMatch(/^source-/);
  await panel(page).evaluate(element => { element.scrollTop = 0; }); await mkdir('review-artifacts/m2', { recursive: true }); await page.screenshot({ path: 'review-artifacts/m2/complete-mock.png', fullPage: true });
});
for (const scenario of ['partial', 'optional-failure', 'manual', 'not-run']) test(`${scenario} publishes automatically with exact visible gaps and required preserved`, async ({ page }) => {
  await seed(page, scenario); const summary = page.getByTestId('delivery-summary').first(); await expect(summary).toContainText('部分交付'); await expect(summary.locator('.delivery-gaps')).toBeVisible();
  await expect(summary).toContainText(scenario === 'optional-failure' ? '可选' : '必需'); await expect(summary).toContainText(scenario === 'partial' ? '当前无法验证' : scenario === 'manual' ? '需人工判断' : scenario === 'not-run' ? '未运行' : '失败');
  await expect(page.getByRole('button', { name: /接受部分/ })).toHaveCount(0);
  if (scenario === 'partial') { await page.screenshot({ path: 'review-artifacts/m2/partial-preview-1440-mock.png' }); await page.setViewportSize({ width: 1366, height: 768 }); await expect(summary).toBeInViewport(); await page.screenshot({ path: 'review-artifacts/m2/partial-preview-1366-mock.png' }); await page.setViewportSize({ width: 1440, height: 1000 }); }
  await report(page); await expect(panel(page)).toContainText('此版本已发布');
  if (scenario === 'partial') await page.screenshot({ path: 'review-artifacts/m2/partial-mock.png', fullPage: true });
});

test('required failed run without a new Version retains prior iframe and independently readable failure', async ({ page }) => {
  const subject = await seed(page); const before = await page.getByTitle('应用预览', { exact: true }).getAttribute('src');
  const runId = await page.evaluate(async projectId => { const response = await fetch(`/api/v1/projects/${projectId}/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `test_${crypto.randomUUID()}` }, body: JSON.stringify({ prompt: '修改应用并模拟失败', mode: 'build' }) }); const { run } = await response.json(); for (let i = 0; i < 7; i++) await fetch(`/api/v1/projects/${projectId}/events?after=0`); return run.id as string; }, subject.projectId);
  await configure(page, subject.projectId, 'blocked', runId); await page.reload();
  await expect(page.getByTestId('delivery-summary').filter({ hasText: '交付受阻' })).toBeVisible(); await expect(page.getByTestId('delivery-summary').first()).toContainText('当前预览 V1 · 上次交付'); await expect(page.getByTestId('delivery-summary').filter({ hasText: '交付受阻' }).locator(':scope > div > strong')).toContainText('本次交付受阻，当前仍显示 V1'); await expect(page.getByTestId('delivery-summary').filter({ hasText: '交付受阻' })).toContainText('当前仍显示 V1'); expect(await page.getByTitle('应用预览', { exact: true }).getAttribute('src')).toBe(before);
  await page.screenshot({ path: 'review-artifacts/m2/blocked-preview-1440-mock.png' }); await page.setViewportSize({ width: 1366, height: 768 }); await expect(page.getByTitle('应用预览', { exact: true })).toBeInViewport(); await page.screenshot({ path: 'review-artifacts/m2/blocked-preview-1366-mock.png' }); await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByTestId('delivery-summary').filter({ hasText: '交付受阻' }).getByRole('button', { name: '查看交付报告' }).click();
  await expect(panel(page)).toContainText('失败断言'); await expect(panel(page)).toContainText('尚未发布'); await expect(panel(page)).not.toContainText('此版本已发布');
});

test('provisional and final unpublished never claim delivery or switch preview', async ({ page }) => {
  const subject = await seed(page, 'provisional'); await report(page); await expect(panel(page)).toContainText('过程报告'); await expect(panel(page)).toContainText('尚未发布');
  await configure(page, subject.projectId, 'unpublished'); await panel(page).getByRole('button', { name: '重新读取', exact: true }).click();
  await expect(panel(page)).toContainText('最终报告'); await expect(panel(page)).toContainText('尚未发布');
});

for (const scenario of ['planning-failure', 'source-changed', 'export-failure', 'cancelled']) test(`${scenario} remains blocked without an override or invented verification`, async ({ page }) => {
  await seed(page, scenario); await report(page); await expect(panel(page).getByRole('heading', { name: '交付受阻', exact: true })).toBeVisible();
  if (scenario === 'planning-failure') await expect(panel(page)).toContainText('尚无执行尝试');
  if (scenario === 'export-failure') await expect(panel(page)).toContainText('导出复验失败');
  await expect(panel(page).getByRole('button', { name: /强行|绕过|接受部分/ })).toHaveCount(0);
});

test('repair chain keeps failed and current attempt tied to the same frozen plan', async ({ page }) => {
  await seed(page, 'repair'); await report(page); await expect(panel(page).locator('.delivery-attempt')).toHaveCount(2);
  await expect(panel(page).locator('.delivery-attempt').first()).toContainText('失败'); await expect(panel(page).locator('.delivery-attempt').last()).toContainText('当前源码尝试');
  await expect(panel(page)).toContainText('约定验收完成'); await page.screenshot({ path: 'review-artifacts/m2/repair-mock.png', fullPage: true });
});

for (const scenario of ['evidence-missing', 'evidence-expired', 'evidence-corrupt', 'evidence-stale']) test(`${scenario} is an explicit content error, never fabricated evidence`, async ({ page }) => {
  await seed(page, scenario); await report(page); await panel(page).getByRole('button', { name: '查看证据', exact: true }).first().click(); await expect(panel(page).locator('.delivery-evidence [role=alert]').first()).toBeVisible();
  await expect(panel(page).locator('.delivery-evidence pre')).toHaveCount(0);
});

test('report outage stays an error; legacy restore is explicitly original evidence without rerun', async ({ page }) => {
  const subject = await seed(page, 'unavailable'); await report(page); await expect(panel(page).getByRole('alert')).toContainText('读取错误不等于历史未验证');
  await configure(page, subject.projectId, 'legacy'); await panel(page).getByRole('button', { name: '重新读取', exact: true }).click(); await expect(panel(page)).toContainText('历史版本 · 未验证');
  await configure(page, subject.projectId, 'complete');
  await page.evaluate(async subject => { const workspace = await (await fetch(`/api/v1/projects/${subject.projectId}/workspace`)).json(); await fetch(`/api/v1/projects/${subject.projectId}/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `test_${crypto.randomUUID()}` }, body: JSON.stringify({ versionId: subject.versionId, expectedProjectRevision: workspace.project.revision }) }); }, subject);
  await page.reload(); await expect(page.getByTestId('delivery-summary').first()).toContainText('复用原约定证据，未重跑'); await report(page); await expect(panel(page)).toContainText('复用原约定证据，未重跑');
});

test('diff handles empty baseline, HTML/SVG safely, long lines, binary/deletion and bounded pagination', async ({ page }) => {
  await seed(page); await page.getByRole('button', { name: '改动', exact: true }).click(); const diff = page.getByTestId('version-diff');
  await expect(diff).toContainText('首次交付，与空快照比较'); await expect(diff).toContainText('<script>untrusted source text only</script>');
  await expect(diff).toContainText('文件差异已截断'); expect(await page.evaluate(() => 'diffExecuted' in window)).toBe(false);
  await diff.getByRole('button', { name: '加载更多改动' }).click(); await expect(diff).toContainText('删除 · source/removed.ts'); await expect(diff).toContainText('二进制文件'); await expect(diff).toContainText('未显示不代表没有变化');
  await page.screenshot({ path: 'review-artifacts/m2/diff-mock.png', fullPage: true });
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 1366, height: 768 }]) test(`delivery layout at ${viewport.width} retains readable body and internal scroll`, async ({ page }) => {
  await page.setViewportSize(viewport); await seed(page, 'partial'); await report(page);
  const size = await panel(page).evaluate(element => ({ font: getComputedStyle(element).fontSize, overflow: document.documentElement.scrollWidth > innerWidth }));
  expect(size.font).toBe('14px'); expect(size.overflow).toBe(false); expect(await panel(page).locator('.criterion-row small').first().evaluate(element => getComputedStyle(element).fontSize)).toBe('12px'); await expect(page.getByRole('button', { name: '交付报告', exact: true })).toBeInViewport(); await page.getByRole('button', { name: '改动', exact: true }).click(); await expect(page.getByTestId('version-diff').locator('.diff-file').first()).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

 test('controlled regression is labelled as injected with attributable patch evidence', async ({ page }) => {
  await seed(page, 'controlled'); await report(page); await expect(panel(page)).toContainText('此报告包含受控回归'); await expect(panel(page)).toContainText('非模型自然错误');
  await expect(panel(page).getByRole('button', { name: '查看证据', exact: true })).not.toHaveCount(0);
});

test('pending preparation has no invented pass count or acceptance', async ({ page }) => {
  await seed(page, 'pending'); await expect(page.getByTestId('delivery-summary').first()).toContainText('尚无最终验收结论'); await report(page); await expect(panel(page)).toContainText('报告尚未生成'); await expect(panel(page).locator('.quality-title')).toHaveCount(0);
});

test('API invalid report never exposes unverified raw report as success', async ({ page }) => {
  await seed(page, 'invalid'); await report(page); await expect(panel(page)).toContainText('交付受阻'); await expect(panel(page)).toContainText('报告原文未被 API 信任'); await expect(panel(page).locator('.criterion-row')).toHaveCount(0);
});

test('delayed old version report cannot replace newly selected version or quality', async ({ page }) => {
  const subject = await seed(page);
  await page.evaluate(async subject => { const workspace = await (await fetch(`/api/v1/projects/${subject.projectId}/workspace`)).json(); await fetch(`/api/v1/projects/${subject.projectId}/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `test_${crypto.randomUUID()}` }, body: JSON.stringify({ versionId: subject.versionId, expectedProjectRevision: workspace.project.revision }) }); await fetch('/__mock/delivery/seed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: subject.projectId, subjectId: subject.versionId, scenario: 'blocked', delayMs: 1000 }) }); }, subject);
  await page.reload(); await page.getByRole('button', { name: '版本', exact: true }).click();
  await page.locator('.version-card').last().getByRole('button', { name: '查看交付报告' }).click();
  await page.getByRole('button', { name: '版本', exact: true }).click(); await page.locator('.version-card').first().getByRole('button', { name: '查看交付报告' }).click();
  await expect(panel(page).getByRole('heading', { name: '约定验收完成', exact: true })).toBeVisible();
  await page.waitForTimeout(1200); // allow the deliberately delayed prior request to finish or abort
  await expect(panel(page).getByRole('heading', { name: '约定验收完成', exact: true })).toBeVisible(); await expect(panel(page).getByRole('heading', { name: '交付受阻', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '改动', exact: true }).click(); await expect(page.getByTestId('version-diff')).toContainText('与选定/父版本比较'); await expect(page.getByTestId('version-diff')).toContainText('修改 · source/index.html');
});

test('authorized screenshot is displayed only from verified bytes, not a model URL', async ({ page }) => {
  await seed(page, 'screenshot'); await report(page); await panel(page).getByRole('button', { name: '查看截图', exact: true }).first().click();
  const image = panel(page).getByAltText('当前所选尝试的验证截图'); await expect(image).toBeVisible(); await expect(image).toHaveAttribute('src', /^blob:/);
});

for (const scenario of ['projection-mixed', 'projection-auto']) for (const viewport of [{ width: 1440, height: 1000 }, { width: 1366, height: 768 }]) test(`${scenario} groups leaves before canonical summaries at ${viewport.width}`, async ({ page }) => {
  await page.setViewportSize(viewport); await seed(page, scenario); const summary = page.getByTestId('delivery-summary').first();
  await expect(summary).toContainText(scenario === 'projection-mixed' ? '部分交付' : '约定验收完成');
  if (scenario === 'projection-mixed') {
    await expect(summary.locator('.concrete-gaps > li')).toHaveCount(3);
    await expect(summary.locator('.concrete-gaps > li').first()).toContainText('Required human verification subitem');
    await expect(summary.locator('.concrete-gaps')).toContainText('Human must review this concrete required subitem.');
    expect(await summary.innerText()).not.toMatch(/criterion_leaf|Host-owned aggregate/);
    await expect(summary).toContainText('已通过的自动子项不受影响');
  }
  await page.screenshot({ path: `review-artifacts/m2/${scenario}-preview-${viewport.width}-mock.png` });
  await report(page); await expect(panel(page).locator('.criterion-row')).toHaveCount(8);
  await expect(panel(page).locator('.concrete-criterion')).toHaveCount(5); await expect(panel(page).locator('.aggregate-criterion')).toHaveCount(3);
  expect(await panel(page).locator('.criterion-row').first().getAttribute('class')).toContain('concrete-criterion');
  expect(await panel(page).innerText()).not.toMatch(/Host-owned aggregate|criterion_leaf/);
  if (scenario === 'projection-mixed') {
    await expect(panel(page).locator('.aggregate-criterion').first()).toContainText('需人工判断');
    await expect(panel(page).locator('.aggregate-criterion').first()).toContainText('未运行');
    await panel(page).locator('.aggregate-criterion').first().getByText('完整目标与原始汇总依据', { exact: true }).click();
    await expect(panel(page).locator('.aggregate-criterion').first()).toContainText('Host-owned aggregate');
    await expect(panel(page).locator('.aggregate-criterion').first()).toContainText('criterion_leaf_manual'); await page.screenshot({ path: `review-artifacts/m2/${scenario}-audit-${viewport.width}-mock.png` });
    await panel(page).locator('.aggregate-criterion').first().getByText('完整目标与原始汇总依据', { exact: true }).click();
  } else await expect(panel(page).locator('.aggregate-criterion').first()).toContainText('通过');
  await expect(panel(page).locator('.delivery-attempt .case-result')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(await panel(page).evaluate(element => getComputedStyle(element).fontSize)).toBe('14px');
  await panel(page).evaluate(element => { element.scrollTop = 0; }); await page.screenshot({ path: `review-artifacts/m2/${scenario}-report-${viewport.width}-mock.png` });
});
