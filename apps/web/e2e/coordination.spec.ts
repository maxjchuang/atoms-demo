import { test, expect, type Page } from '@playwright/test';
import { CoordinationWorkspace, CoordinationSession } from '@atoms/contracts/conversation';

const real = process.env.ATOMS_E2E_REAL === '1';
test.beforeEach(() => { test.skip(real, 'Deterministic M1 coordination Mock tests never run against a live model service.'); });
async function login(page: Page) {
  await page.goto('/'); await page.getByRole('button', { name: '开启体验' }).click();
  await page.getByLabel('体验码', { exact: true }).fill('atoms-demo-2026');
  await page.getByRole('button', { name: '进入创作空间' }).click(); await expect(page.getByRole('dialog')).toBeHidden();
}
async function send(page: Page, text: string, mode: 'auto' | 'ask' | 'build' = 'auto') {
  await page.getByLabel('消息模式').selectOption(mode);
  const field = await page.getByLabel('项目消息', { exact: true }).count() ? page.getByLabel('项目消息', { exact: true }) : page.getByLabel('应用需求', { exact: true });
  await field.fill(text); await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByLabel('项目消息', { exact: true })).toBeVisible();
}
const projectId = (page: Page) => new URL(page.url()).hash.split('/').at(-1)!;
async function workspace(page: Page) {
  const id = projectId(page);
  return CoordinationWorkspace.parse(await page.evaluate(async id => (await fetch(`/api/v2/projects/${id}/workspace`)).json(), id));
}
async function account(page: Page) { return CoordinationSession.parse(await page.evaluate(async () => (await fetch('/api/v2/session')).json())); }
async function settled(page: Page) { await expect.poll(async () => (await workspace(page)).latestCoordinationTurn?.status, { timeout: 15000 }).toBe('completed'); }
const runStatus = (page: Page, value: string) => page.locator('.current-run-strip .run-card-top > strong').filter({ hasText: new RegExp(`^${value}$`) });

test('sharing consultation is read-only and host actions resolve real explanations', async ({ page }) => {
  await login(page); const before = await account(page);
  await send(page, '如何分享这个应用给别人？'); await settled(page);
  await expect(page.locator('.outcome-badge.consult')).toBeVisible();
  expect((await workspace(page)).execution.latestRun).toBeNull();
  await expect(page.locator('.behavior-boundary')).toHaveText(/暂无验收结果.*基础检查不等于功能验收/);
  expect((await account(page)).session.quota.runsUsed).toBe(before.session.quota.runsUsed);
  await page.getByRole('button', { name: '查看真实分享条件', exact: true }).click();
  await expect(page.locator('.host-action p')).toContainText('本机预览不等于公网部署');
  await send(page, '这个应用如何使用？', 'build'); await settled(page);
  expect((await workspace(page)).execution.latestRun).toBeNull();
  await page.screenshot({ path: test.info().outputPath('read-only-consult.png') });
});

test('ask proposal requires acceptance and reuses exactly one user message', async ({ page }) => {
  await login(page); await send(page, '把按钮改成蓝色', 'ask'); await settled(page);
  await expect(page.getByRole('button', { name: '接受提案并创建构建' })).toBeVisible();
  expect((await workspace(page)).execution.latestRun).toBeNull();
  await page.getByRole('button', { name: '接受提案并创建构建' }).click();
  await expect(runStatus(page, '已交付')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.message.user p').filter({ hasText: /^把按钮改成蓝色$/ })).toHaveCount(1);
  const snapshot = await workspace(page);
  expect(snapshot.messages.filter(message => message.role === 'user' && message.content === '把按钮改成蓝色')).toHaveLength(1);
  expect((await account(page)).session.quota.runsUsed).toBe(1);
  await page.getByRole('button', { name: '如何预览与分享？' }).click(); await settled(page);
  await expect(page.getByRole('button', { name: '打开当前签名预览' })).toBeVisible();
  const popupPromise = page.waitForEvent('popup'); await page.getByRole('button', { name: '打开当前签名预览' }).click();
  const popup = await popupPromise; await expect(popup.getByRole('heading', { name: '灵感便签墙' })).toBeVisible(); await popup.close();
});

test('message clarification survives refresh and short replies need explicit binding', async ({ page }) => {
  await login(page); await send(page, '优化一下'); await settled(page);
  await expect(page.locator('.message-clarification.open')).toBeVisible();
  expect((await workspace(page)).execution.latestRun).toBeNull();
  await page.reload(); await expect(page.locator('.message-clarification.open')).toBeVisible();
  let submitted: unknown;
  page.on('request', request => { if (request.method() === 'POST' && /\/api\/v2\/projects\/[^/]+\/messages$/.test(new URL(request.url()).pathname)) submitted = request.postDataJSON(); });
  const questionId = await page.locator('.message-clarification.open').getAttribute('data-clarification-id');
  await page.getByRole('button', { name: '只了解现有能力，不修改' }).click(); await settled(page);
  expect(submitted).toMatchObject({ input: { kind: 'selection' }, replyTo: { clarificationId: questionId, expectedRevision: 1 } });
  expect((await workspace(page)).execution.latestRun).toBeNull();
  await send(page, '好的'); await settled(page);
  await expect(page.locator('.message-clarification.open')).toHaveCount(1);
  expect((await workspace(page)).execution.latestRun).toBeNull();
  await page.getByRole('button', { name: '改为暖色配色，创建修改任务' }).click();
  await expect(runStatus(page, '已交付')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.message.user p').filter({ hasText: /^改为暖色配色，创建修改任务$/ })).toHaveCount(1);
});

test('consultation during a build does not mutate it; later explicit changes queue', async ({ page }) => {
  await login(page); await send(page, '创建便签墙 [long-wait]');
  await expect(runStatus(page, '正在构建')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.current-run-strip .strip-phase')).toContainText('编写代码');
  await expect(page.locator('.current-run-strip .strip-phase')).toContainText('总耗时');
  const original = (await workspace(page)).execution.activeRun!.id;
  await send(page, '如何分享这个应用给别人？'); await settled(page);
  expect((await workspace(page)).execution.activeRun?.id).toBe(original);
  expect((await account(page)).session.quota.runsUsed).toBe(1);
  await expect(page.locator('.message.assistant p').last()).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('consult-during-active-run.png') });
  await send(page, '增加搜索框'); await settled(page);
  await expect.poll(async () => (await workspace(page)).execution.queuedRuns.length).toBe(1);
  await expect(page.getByText('将在开始构建时使用最新成功版本。', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: '停止构建', exact: true }).click();
  await expect(runStatus(page, '已交付')).toBeVisible({ timeout: 20000 });
  expect((await account(page)).session.quota.runsUsed).toBe(2);
});

test('cancelling an answer is independent; already-dispatched receipt cannot cancel a build', async ({ page }) => {
  await login(page); await send(page, '[slow-answer] 解释当前项目');
  await expect(page.locator('.coordination-turn.processing')).toBeVisible();
  await page.getByRole('button', { name: '查看当前进度' }).click();
  await expect(page.locator('.outcome-badge.status')).toBeVisible();
  await page.getByRole('button', { name: '停止回答', exact: true }).click();
  await expect(page.getByText('本次回答已停止', { exact: true })).toBeVisible();
  expect((await workspace(page)).execution.latestRun).toBeNull();
  await send(page, '创建便签墙 [long-wait]'); await settled(page);
  await expect(runStatus(page, '正在构建')).toBeVisible({ timeout: 15000 });
  const before = await workspace(page), turn = before.latestCoordinationTurn!;
  const receipt = await page.evaluate(async turn => (await fetch(`/api/v2/coordination-turns/${turn.id}/cancel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Atoms-Coordination-Version': '0.2.0', 'Idempotency-Key': `race_${crypto.randomUUID()}` }, body: JSON.stringify({ expectedRevision: turn.revision }),
  })).json(), turn);
  expect(receipt.disposition).toBe('already_dispatched');
  expect((await workspace(page)).execution.activeRun?.status).toBe('running');
  await page.getByRole('button', { name: '停止构建', exact: true }).click();
});

test('exact proposal conflicts refresh read-only and require a new acceptance', async ({ page }) => {
  await login(page); await send(page, '创建便签墙'); await expect(runStatus(page, '已交付')).toBeVisible({ timeout: 20000 });
  await send(page, '基于当前版本增加搜索框', 'ask'); await settled(page);
  const first = (await workspace(page)).proposals.find(proposal => proposal.status === 'open')!;
  await send(page, '把背景改成深色'); await expect.poll(async () => (await workspace(page)).execution.currentVersion?.id, { timeout: 20000 }).not.toBe(first.contextUsed.contextVersionId);
  await expect(runStatus(page, '已交付')).toBeVisible({ timeout: 20000 });
  await page.locator(`[data-proposal-id="${first.id}"]`).getByRole('button', { name: '接受提案并创建构建' }).click();
  await expect(page.getByRole('button', { name: '刷新提案（只读重评）' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('exact-stale-proposal.png') });
  expect((await account(page)).session.quota.runsUsed).toBe(2);
  await page.getByRole('button', { name: '刷新提案（只读重评）' }).click(); await settled(page);
  await expect(page.locator('.change-proposal.open')).toHaveCount(1);
  expect((await account(page)).session.quota.runsUsed).toBe(2);
  await page.locator('.change-proposal.open').getByRole('button', { name: '接受提案并创建构建' }).click();
  await expect.poll(async () => (await account(page)).session.quota.runsUsed).toBe(3);
});

test('legacy history pagination and project memory corrections remain traceable across refresh', async ({ page }) => {
  await login(page);
  const project = await page.evaluate(async () => (await fetch('/api/v1/projects', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `seed_${crypto.randomUUID()}` }, body: JSON.stringify({ title: '历史与项目记忆' }) })).json());
  await page.evaluate(async id => { await fetch(`/__mock/v2/seed/${id}`, { method: 'POST', body: JSON.stringify({ kind: 'history' }) }); }, project.id);
  await page.goto(`/#/projects/${project.id}`); await expect(page.getByRole('button', { name: '加载更早消息' })).toBeVisible();
  await page.getByRole('button', { name: '加载更早消息' }).scrollIntoViewIfNeeded();
  const anchor = page.locator('.conversation-item').first();
  const anchorId = await anchor.getAttribute('data-message-id');
  const anchorTop = (await anchor.boundingBox())!.y;
  await page.getByRole('button', { name: '加载更早消息' }).click();
  await expect(page.locator('.conversation-item')).toHaveCount(65);
  await expect.poll(async () => Math.abs((await page.locator(`[data-message-id=\"${anchorId}\"]`).boundingBox())!.y - anchorTop)).toBeLessThan(3);
  await expect(page.getByText('旧历史消息 1', { exact: true })).toBeVisible();
  await expect(page.getByText('历史助手', { exact: true }).first()).toBeVisible();
  expect((await workspace(page)).execution.latestRun).toBeNull();
  expect((await account(page)).coordinationQuota.used).toBe(0);
  await send(page, '记住我的偏好：界面保持暖色', 'ask'); await settled(page);
  await send(page, '更正项目偏好为深色，仅更新约定，不修改应用', 'ask'); await settled(page);
  await page.reload(); await page.getByRole('tab', { name: /项目约定/ }).click();
  await expect(page.locator('.memory-card.active p')).toHaveText('界面保持深色');
  await page.getByLabel('显示已被纠正的旧约定').check();
  await expect(page.locator('.memory-card.superseded p')).toHaveText('界面保持暖色');
  await page.screenshot({ path: test.info().outputPath('project-memory-panel.png') });
  await page.locator('.memory-card.active').getByRole('button', { name: '纠正此约定' }).click();
  await expect(page.getByLabel('消息模式')).toHaveValue('ask');
  await page.getByLabel('项目消息').fill('更正项目偏好为暖色，仅更新约定，不修改应用');
  await page.getByRole('button', { name: '发送消息', exact: true }).click(); await settled(page);
  await expect(page.getByRole('tab', { name: '项目对话' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: /项目约定/ }).click();
  await expect(page.locator('.memory-card.active p')).toHaveText('界面保持暖色');
  await page.locator('.memory-card.active').getByRole('button', { name: '查看来源' }).click();
  await expect(page.getByRole('tab', { name: '项目对话' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.message.user p').filter({ hasText: /^更正项目偏好为暖色/ })).toBeVisible();
  expect((await workspace(page)).execution.latestRun).toBeNull();
  await page.screenshot({ path: test.info().outputPath('persistent-project-memory.png') });
});


test('ordinary Run question remains separate from message clarification and resumes the same Run', async ({ page }) => {
  await login(page); await send(page, '创建便签墙 [run-question]');
  await expect(page.locator('.run-attention')).toContainText('执行中的问题', { timeout: 15000 });
  await expect(page.locator('.message-clarification.open')).toHaveCount(0);
  const before = await workspace(page);
  await page.locator('.run-attention').getByRole('button', { name: '深色', exact: true }).click();
  await expect(runStatus(page, '已交付')).toBeVisible({ timeout: 20000 });
  expect((await workspace(page)).execution.latestRun?.id).toBe(before.execution.activeRun!.id);
  expect((await account(page)).session.quota.runsUsed).toBe(1);
});
