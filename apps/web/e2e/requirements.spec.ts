import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
test.beforeEach(async () => { test.skip(process.env.ATOMS_E2E_REAL === '1', 'Requirements deterministic Mock only; not model interpretation proof.'); await mkdir('review-artifacts/requirements', { recursive: true }); });
async function seed(page: Page, scenario = 'three-ask', options = {}) {
  await page.goto('/'); await expect(page.getByLabel('应用需求', { exact: true })).toBeVisible();
  const projectId = await page.evaluate(async ({ scenario, options }) => {
    const post = async (path: string, body: unknown) => { const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `test_${crypto.randomUUID()}` }, body: JSON.stringify(body) }); if (!response.ok) throw new Error(`Mock seed ${response.status}`); return response.json(); };
    await post('/api/v1/sessions', { code: 'atoms-demo-2026' }); const project = await post('/api/v1/projects', { title: '累计需求审阅 Mock' }); await post('/__mock/requirements/seed', { projectId: project.id, scenario, ...options }); return project.id as string;
  }, { scenario, options });
  await page.goto(`/#/projects/${projectId}`); await page.reload(); await expect(page.locator('.current-run-strip')).toBeVisible(); await page.locator('.requirements-audit>summary').click(); await expect(page.getByTestId('requirements-panel')).toBeVisible(); await expect(page.getByText('正在读取权威需求快照…',{exact:true})).toHaveCount(0); for(const summary of await page.locator('.complete-summary-review>summary').all()) await summary.click(); return projectId;
}
const panel = (page: Page) => page.locator('.coordination-scroll');
async function stats(page: Page, projectId: string) { return page.evaluate(async id => (await fetch(`/__mock/requirements/${id}/stats`)).json(), projectId); }
async function latestRun(page: Page, projectId: string) { return page.evaluate(async id => (await (await fetch(`/api/v1/projects/${id}/workspace`)).json()).latestRun, projectId); }

test('three ask sources retain original game, 3D and computer control as requested scope; unified acceptance uses only typed route', async ({ page }) => {
  const projectId = await seed(page); await expect(panel(page)).toContainText('首个版本，尚无已发布应用或源码');
  for (const text of ['做一个俄罗斯方块游戏', '要做成 3D 版的', '要支持电脑自动接管模式']) await expect(panel(page).locator('.requirement-entries')).toContainText(text);
  await expect(panel(page).locator('.requirement-entry > span').first()).toContainText('已提出 · 未授权'); await expect(panel(page).locator('.complete-goal')).toContainText('做一个俄罗斯方块游戏；要做成 3D 版的；要支持电脑自动接管模式'); expect(await latestRun(page, projectId)).toBeNull();
  await expect(page.getByRole('button', { name: '接受提案并创建构建', exact: true })).toHaveCount(0);
  const proposalId = (await stats(page, projectId)).proposals[0];
  const bypass = await page.evaluate(async proposalId => (await fetch(`/api/v2/proposals/${proposalId}/accept`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `test_${crypto.randomUUID()}`, 'X-Atoms-Coordination-Version': '0.2.0' }, body: JSON.stringify({ expectedRevision: 1, runMode: 'plan' }) })).status, proposalId);
  expect(bypass).toBe(409); expect(await latestRun(page, projectId)).toBeNull();
  const calls: string[] = []; page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/')) calls.push(new URL(request.url()).pathname); });
  await panel(page).getByRole('button', { name: '接受完整方案并创建构建', exact: true }).click(); await expect(panel(page)).toContainText('完整方案已明确接受');
  expect(calls).toHaveLength(1); expect(calls[0]).toMatch(/^\/api\/requirements\/v1\/proposals\/[^/]+\/accept$/); expect((await stats(page, projectId)).acceptPosts).toBe(1); expect(await latestRun(page, projectId)).not.toBeNull();
  await page.screenshot({ path: 'review-artifacts/requirements/accepted-complete.png' });
});

test('review shortcut only fills editable draft; explicit actual send is typed ask/plan with no Run or scope mutation', async ({ page }) => {
  const projectId = await seed(page), before = await stats(page, projectId);
  await panel(page).getByRole('button', { name: '整理完整需求（填写草稿，需发送）' }).click();
  await expect(page.locator('.requirements-draft-note')).toContainText('不新增/撤销产品要求'); expect((await stats(page, projectId)).reviewPosts).toBe(0);
  const draft = '  请把已有全部目标整理为完整方案，保留三维和电脑接管，仅供我审阅。\n'; await page.getByLabel('项目消息', { exact: true }).fill(draft); await expect(page.getByLabel('消息模式')).toBeDisabled();
  const calls: string[] = []; const sent: { body: unknown; key: string }[] = [];
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/')) { calls.push(new URL(request.url()).pathname); if (new URL(request.url()).pathname.endsWith('/review')) sent.push({ body: request.postDataJSON(), key: request.headers()['idempotency-key'] }); } });
  await page.getByRole('button', { name: '发送整理草稿', exact: true }).click(); await expect(page.locator('.requirements-draft-note')).toHaveCount(0);
  const after = await stats(page, projectId); expect(after.reviewPosts).toBe(1); expect(after.reviewBodies[0].input.content).toBe(draft); expect(after.entries).toEqual(before.entries); expect(after.snapshotRevision).toBe(before.snapshotRevision); expect(await latestRun(page, projectId)).toBeNull();
  expect(calls).toEqual([`/api/requirements/v1/projects/${projectId}/review`]);
  expect(sent).toHaveLength(1); await page.evaluate(async ({ projectId, sent }) => { const response = await fetch(`/api/requirements/v1/projects/${projectId}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Atoms-Requirements-Version': '0.1.0', 'Idempotency-Key': sent.key }, body: JSON.stringify(sent.body) }); if (!response.ok) throw new Error('Mock idempotent review failed'); }, { projectId, sent: sent[0] });
  expect((await stats(page, projectId)).reviewPosts).toBe(1); expect((await stats(page, projectId)).entries).toEqual(before.entries); expect(await latestRun(page, projectId)).toBeNull();
});

test('ordinary ask changes use original message endpoint and accumulate exact source; consult outcome adds none', async ({ page }) => {
  const projectId = await seed(page, 'empty', { ordinaryChanges: true, nextOutcome: 'change' });
  await page.getByLabel('消息模式').selectOption('ask');
  for (const text of ['先做一个作品集', '要支持中英双语', '增加可筛选项目列表']) { await page.getByLabel('项目消息', { exact: true }).fill(text); await page.getByRole('button', { name: '发送消息', exact: true }).click(); await expect(page.getByLabel('项目消息', { exact: true })).toHaveValue(''); }
  await expect(panel(page).locator('.requirement-entries')).toContainText('先做一个作品集'); await expect(panel(page).locator('.requirement-entries')).toContainText('增加可筛选项目列表');
  const data = await stats(page, projectId); expect(data.entries.map((entry: { text: string }) => entry.text)).toEqual(['先做一个作品集', '要支持中英双语', '增加可筛选项目列表']); expect(data.entries.every((entry: { authorization: string }) => entry.authorization === 'requested')).toBe(true); expect(await latestRun(page, projectId)).toBeNull();
  await page.evaluate(async projectId => { await fetch(`/__mock/requirements/${projectId}/outcome`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nextOutcome: 'consult' }) }); }, projectId);
  await page.getByLabel('项目消息', { exact: true }).fill('现在有哪些已提出的要求？'); await page.getByRole('button', { name: '发送消息', exact: true }).click(); await expect(page.getByLabel('项目消息', { exact: true })).toHaveValue('');
  expect((await stats(page, projectId)).entries).toEqual(data.entries); expect((await stats(page, projectId)).snapshotRevision).toBe(data.snapshotRevision); expect(await latestRun(page, projectId)).toBeNull();
});

test('slow review acknowledgement cannot return to the old project or clear a new dashboard draft', async ({ page }) => {
  const projectId = await seed(page, 'three-ask', { reviewDelayMs: 900 });
  await panel(page).getByRole('button', { name: '整理完整需求（填写草稿，需发送）' }).click();
  const response = page.waitForResponse(value => new URL(value.url()).pathname === `/api/requirements/v1/projects/${projectId}/review`);
  await page.getByRole('button', { name: '发送整理草稿', exact: true }).click(); await page.getByRole('button', { name: '我的项目', exact: true }).first().click();
  await page.getByRole('button', { name: 'Atoms Demo 首页' }).click(); const nextDraft = '新的项目草稿，不应被旧整理回执清空'; await page.getByLabel('应用需求', { exact: true }).fill(nextDraft);
  await response; await page.waitForTimeout(150); expect(new URL(page.url()).hash).not.toMatch(/projects\//); await expect(page.getByLabel('应用需求', { exact: true })).toHaveValue(nextDraft); await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
  expect((await stats(page, projectId)).reviewPosts).toBe(1); expect(await latestRun(page, projectId)).toBeNull();
});

test('slow review acknowledgement preserves a newer draft and its explicit review purpose in the same project', async ({ page }) => {
  const projectId = await seed(page, 'three-ask', { reviewDelayMs: 900 }); await panel(page).getByRole('button', { name: '整理完整需求（填写草稿，需发送）' }).click();
  const response = page.waitForResponse(value => new URL(value.url()).pathname === `/api/requirements/v1/projects/${projectId}/review`); await page.getByRole('button', { name: '发送整理草稿' }).click();
  const newer = '后续整理草稿：仍只核对现有要求，不执行。'; await page.getByLabel('项目消息', { exact: true }).fill(newer); await response; await expect(page.getByRole('button', { name: '发送整理草稿' })).toBeEnabled();
  await expect(page.getByLabel('项目消息', { exact: true })).toHaveValue(newer); await expect(page.locator('.requirements-draft-note')).toContainText('不新增/撤销产品要求'); expect((await stats(page, projectId)).reviewPosts).toBe(1); expect(await latestRun(page, projectId)).toBeNull();
});

test('review subject mismatch during navigation is refused rather than falling back to an ordinary message', async ({ page }) => {
  await seed(page); await panel(page).getByRole('button', { name: '整理完整需求（填写草稿，需发送）' }).click();
  const other = await page.evaluate(async () => (await (await fetch('/api/v1/projects', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `test_${crypto.randomUUID()}` }, body: JSON.stringify({ title: '另一个项目' }) })).json()).id as string);
  const writes: string[] = []; page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/')) writes.push(new URL(request.url()).pathname); });
  await page.evaluate(other => { const form = document.querySelector<HTMLFormElement>('.workspace-composer form'); location.hash = `/projects/${other}`; form?.requestSubmit(); }, other);
  await expect(page.getByLabel('项目消息', { exact: true })).toBeVisible(); await page.waitForTimeout(150); expect(writes).toEqual([]); expect(new URL(page.url()).hash).toBe(`#/projects/${other}`);
});

for (const scenario of ['suggestion', 'replacement', 'generic']) test(`${scenario} displays real API source states/exclusions without app-specific client merging`, async ({ page }) => {
  await seed(page, scenario);
  if (scenario === 'suggestion') { await expect(panel(page)).toContainText('建议 · 未确认'); await expect(panel(page)).toContainText('未采用的未确认建议'); }
  if (scenario === 'replacement') { await expect(panel(page)).toContainText('拟按用户来源替换'); await expect(panel(page)).toContainText('请用新的界面布局替换原来的布局要求'); }
  if (scenario === 'generic') { await expect(panel(page).locator('.complete-goal')).toContainText('制作作品集；需要双语切换；加入可筛选项目列表'); await expect(panel(page)).not.toContainText('俄罗斯方块'); }
});

test('stale summary remains visibly old and cannot accept against a newer authority', async ({ page }) => {
  const projectId = await seed(page, 'stale'); await expect(panel(page)).toContainText('历史需求快照或基线'); await expect(panel(page).getByRole('button', { name: '接受完整方案并创建构建' })).toBeDisabled(); expect((await stats(page, projectId)).acceptPosts).toBe(0); expect(await latestRun(page, projectId)).toBeNull();
});

test('missing published source cannot masquerade as an empty project or executable modify plan', async ({ page }) => {
  await seed(page, 'missing-source'); await expect(panel(page)).toContainText('源码当前不可用，不能授权修改'); await expect(panel(page).getByRole('button', { name: '接受完整方案并创建构建' })).toHaveCount(0);
});

for (const policy of ['latest', 'exact'] as const) for (const basis of ['published', 'empty'] as const) test(`summary copy separates ${policy} dispatch from ${basis} review basis without changing authorization`, async ({ page }) => {
  const projectId = await seed(page, basis === 'published' ? 'published' : 'three-ask');
  if (policy === 'exact') {
    await page.evaluate(async projectId => {
      const key = 'atoms_web_mock_requirements', data = JSON.parse(localStorage.getItem(key)!);
      const modulePath = '/src/requirements-api.ts'; const { requirementHash } = await import(modulePath);
      for (const summary of data[projectId].view.pendingSummaries) { summary.proposal.basePolicy = { kind: 'exact_version', expectedBaseVersionId: summary.snapshot.base.kind === 'empty_project' ? null : summary.snapshot.base.versionId }; summary.hash = await requirementHash(summary); }
      localStorage.setItem(key, JSON.stringify(data));
    }, projectId);
    await page.reload(); await page.locator('.complete-summary-review>summary').first().click();
  }
  const copy = panel(page).locator('.summary-baseline-copy').first();
  if (policy === 'latest') { await expect(copy).toContainText(basis === 'empty' ? '审阅时尚无已发布应用' : '审阅时基于已发布版本'); await expect(copy).toContainText('开始构建时使用届时最新成功版本，无则使用模板'); await expect(copy).not.toContainText('精确锁定'); }
  else { await expect(copy).toContainText(basis === 'empty' ? '精确锁定当前尚无已发布版本的状态' : '精确锁定已发布版本'); await expect(copy).toContainText('基线变化须重新审阅'); await expect(copy).not.toContainText('开始构建时使用届时最新成功版本'); }
  expect(await latestRun(page, projectId)).toBeNull(); expect((await stats(page, projectId)).acceptPosts).toBe(0);
});

test('published base is explicit and corrupt authority fails closed instead of restoring old accept', async ({ page }) => {
  await seed(page, 'published'); await expect(panel(page)).toContainText('基于已发布版本'); await expect(panel(page)).toContainText('源码可用'); await expect(panel(page)).not.toContainText('尚无已发布应用或源码');
  await seed(page, 'corrupt'); await expect(page.locator('.requirements-audit').getByRole('alert')).toContainText('指纹不一致'); await expect(panel(page).getByRole('button', { name: '接受完整方案并创建构建' })).toHaveCount(0); await expect(page.getByRole('button', { name: '接受提案并创建构建', exact: true })).toHaveCount(0);
});

test('budget PLAN_REVIEW_REQUIRED prepares review draft, never pays or creates a Run by navigation', async ({ page }) => {
  const projectId = await seed(page);
  await page.evaluate(async projectId => { await fetch('/__mock/budget-recovery/seed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, scenario: 'plan-review' }) }); }, projectId); await page.reload();
  await page.getByRole('tab', { name: /构建活动/ }).click(); const budget = page.getByTestId('budget-recovery'); await expect(budget).toContainText('验收计划需要重新审阅');
  await budget.getByRole('button', { name: /返回项目对话审阅需求/ }).click(); await expect(page.locator('.requirements-draft-note')).toBeVisible(); expect((await stats(page, projectId)).reviewPosts).toBe(0); await expect(page.getByRole('button', { name: '发送整理草稿' })).toBeEnabled();
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) test(`complete goal, source and pending acceptance are readable at ${viewport.width}`, async ({ page }) => {
  await page.setViewportSize(viewport); await seed(page); await panel(page).locator('.complete-goal').first().scrollIntoViewIfNeeded(); expect(await panel(page).evaluate(el => getComputedStyle(el).fontSize)).toBe('14px'); expect(await panel(page).locator('small').first().evaluate(el => getComputedStyle(el).fontSize)).toBe('12px'); expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false); await page.screenshot({ path: `review-artifacts/requirements/full-review-${viewport.width}.png` });
});
