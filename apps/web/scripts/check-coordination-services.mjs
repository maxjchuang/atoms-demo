import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';

// Explicitly opt in only after the integration owner starts isolated HTTP API,
// Agent and Web services with BOTH Router and Worker configured Fake. The script
// does not switch server modes and must never be pointed at the paid live demo.
assert.equal(process.env.ATOMS_FAKE_SERVICES, '1', 'Set ATOMS_FAKE_SERVICES=1 only for operator-confirmed Fake Router + Fake Worker services.');
assert.ok(process.env.ATOMS_WEB_URL, 'ATOMS_WEB_URL must explicitly identify the isolated integration workbench.');
const target = new URL(process.env.ATOMS_WEB_URL);
const reusedProjectId = process.env.ATOMS_REUSE_PROJECT_ID;
if (reusedProjectId) assert.match(reusedProjectId, /^project_[a-z0-9_-]+$/, 'Reuse requires an explicit project ID.');
const sourceOnly = process.env.ATOMS_VERIFY_EXISTING_SOURCE_ONLY === '1';
if (sourceOnly) assert.ok(reusedProjectId, 'Source-only verification requires an explicit existing project.');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname), 'Only local isolated integration services are allowed.');
assert.notEqual(target.port, '5173', 'Refusing the existing live workbench on port 5173.');
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ?? (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
const browser = await chromium.launch(executablePath ? { executablePath } : {});
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(target.origin);
  await expect(page.locator('.mock-banner')).toContainText('Fake DSH');
  await expect(page.getByText('独立 Mock 模式', { exact: false })).toBeHidden();
  assert.equal(await page.evaluate(() => !!navigator.serviceWorker.controller), false, 'MSW must not control the genuine-service verification.');
  await page.getByRole('button', { name: '开启体验' }).click();
  await page.getByLabel('体验码', { exact: true }).fill(process.env.ATOMS_DEMO_CODE ?? 'atoms-demo-2026');
  await page.getByRole('button', { name: '进入创作空间' }).click(); await expect(page.getByRole('dialog')).toBeHidden();
  const workspace = () => page.evaluate(async () => (await fetch(`/api/v2/projects/${location.hash.split('/').at(-1)}/workspace`)).json());
  const account = () => page.evaluate(async () => (await fetch('/api/v2/session')).json());
  async function send(text, mode = 'auto') {
    await page.getByLabel('消息模式').selectOption(mode);
    const field = await page.getByLabel('项目消息', { exact: true }).count() ? page.getByLabel('项目消息', { exact: true }) : page.getByLabel('应用需求', { exact: true });
    await field.fill(text); await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(page.getByLabel('项目消息', { exact: true })).toBeVisible();
  }
  const settled = async () => {
    await expect.poll(async () => (await workspace()).latestCoordinationTurn?.status, { timeout: 30000 }).toBe('completed');
    const snapshot = await workspace(), turn = snapshot.latestCoordinationTurn;
    assert.ok(turn.assistantMessageId, 'Completed coordination needs its actual reply');
    await expect(page.locator(`[data-message-id=\"${turn.assistantMessageId}\"] .message.assistant p`)).toBeVisible();
    await expect(page.locator(`[data-turn-id=\"${turn.id}\"]`)).toHaveCount(0);
    return snapshot;
  };
  if (reusedProjectId) {
    await page.goto(`${target.origin}/#/projects/${reusedProjectId}`);
    await expect(page.getByLabel('项目消息', { exact: true })).toBeVisible();
  }
  if (sourceOnly) {
    const before = await workspace(), quotaBefore = await account();
    assert.equal(before.execution.activeRun, null, 'Do not inspect an actively changing test project');
    await page.getByRole('tab', { name: /项目约定/ }).click();
    const memory = await page.evaluate(async () => (await fetch(`/api/v2/projects/${location.hash.split('/').at(-1)}/memory`)).json());
    const warmDecision = memory.decisions.find(decision => decision.status === 'active' && decision.text.includes('暖色'));
    assert.ok(warmDecision?.sourceMessageIds?.[0], 'Existing warm preference needs a canonical source');
    await expect(page.locator('.memory-card.active').filter({ hasText: '暖色' }).first()).toBeVisible();
    await page.reload(); await page.getByRole('tab', { name: /项目约定/ }).click();
    await expect(page.locator('.memory-card.active').filter({ hasText: '暖色' }).first()).toBeVisible();
    await mkdir('review-artifacts/m1-services', { recursive: true });
    await page.screenshot({ path: 'review-artifacts/m1-services/memory-and-preview.png' });
    await page.locator('.memory-card.active').filter({ hasText: '暖色' }).first().getByRole('button', { name: /查看来源/ }).first().click();
    const source = page.locator(`[data-message-id=\"${warmDecision.sourceMessageIds[0]}\"] .message.user p`);
    await expect(source).toContainText('暖色'); await expect(source).toBeInViewport();
    await page.screenshot({ path: 'review-artifacts/m1-services/memory-source.png' });
    const after = await workspace(), quotaAfter = await account();
    assert.equal(after.conversationRevision, before.conversationRevision, 'Source inspection must not submit a message');
    assert.equal(after.execution.latestRun?.id, before.execution.latestRun?.id);
    assert.equal(quotaAfter.session.quota.runsUsed, quotaBefore.session.quota.runsUsed);
    console.log(JSON.stringify({ target: target.origin, projectId: reusedProjectId, scope: 'existing preference, refresh persistence and exact canonical source jump only',
      submittedMessages: 0, createdRuns: 0, canonicalSourceMessageId: warmDecision.sourceMessageIds[0], sourceInViewport: true,
      screenshots: ['review-artifacts/m1-services/memory-and-preview.png', 'review-artifacts/m1-services/memory-source.png'] }, null, 2));
  } else {
  const previousRunId = reusedProjectId ? (await workspace()).execution.latestRun?.id ?? null : null;
  const initialAccount = await account();
  await send('如何分享这个应用给别人？', 'ask'); await settled();
  const consultation = await workspace();
  assert.equal(consultation.latestCoordinationTurn?.result?.kind, 'consult', 'Sharing question must be answered as consultation');
  assert.equal(consultation.execution.latestRun?.id ?? null, previousRunId, 'Consultation must not create a new build');
  assert.equal((await account()).session.quota.runsUsed, initialAccount.session.quota.runsUsed);
  await mkdir('review-artifacts/m1-services', { recursive: true });
  await page.screenshot({ path: 'review-artifacts/m1-services/consult.png' });

  let first, second;
  if (!reusedProjectId) {
  await page.getByLabel('构建策略').selectOption('plan');
  await send('创建一个可以新增、编辑并在刷新后保存内容的便签墙。');
  await expect(page.getByRole('button', { name: '确认计划，继续本次构建' })).toBeVisible({ timeout: 30000 });
  await page.reload(); await page.getByRole('button', { name: '确认计划，继续本次构建' }).click();
  await expect(page.locator('.current-run-strip .run-card-top > strong')).toHaveText('已交付', { timeout: 120000 });
  first = await workspace();
  assert.ok(first.execution.currentVersion);
  const preview = page.frameLocator('iframe[title="应用预览"]');
  await expect(preview.getByLabel('便签内容').first()).toBeVisible();
  const before = await preview.getByLabel('便签内容').count();
  await preview.getByRole('button', { name: /新建便签|新增便签/ }).click();
  await expect(preview.getByLabel('便签内容')).toHaveCount(before + 1);
  await preview.getByLabel('便签内容').last().fill('M1 真实三服务浏览器验收');
  await page.reload();
  await expect(preview.getByLabel('便签内容').last()).toHaveValue('M1 真实三服务浏览器验收');
  await page.getByLabel('构建策略').selectOption('build');
  const generationBeforeProposal = (await account()).session.quota.runsUsed;
  await send('增加一个可以按便签文字搜索的输入框。', 'ask'); await settled();
  assert.equal((await account()).session.quota.runsUsed, generationBeforeProposal);
  await page.locator('.change-proposal.open').getByRole('button', { name: '接受提案并创建构建' }).click();
  await expect.poll(async () => (await workspace()).execution.currentVersion?.id, { timeout: 120000 }).not.toBe(first.execution.currentVersion.id);
  await expect(page.locator('.current-run-strip .run-card-top > strong')).toHaveText('已交付', { timeout: 120000 });
  second = await workspace();
  } else {
    first = await workspace(); second = first;
    assert.ok(first.execution.currentVersion, 'Reuse requires an existing delivered version');
    assert.equal(first.execution.activeRun, null, 'Reuse must not interfere with an active build');
  }
  const usedAfterBuilds = (await account()).session.quota.runsUsed;

  await send('请记住我的项目偏好：界面保持暖色，仅记录约定，不修改当前应用。', 'ask'); await settled();
  await page.getByRole('tab', { name: /项目约定/ }).click();
  await expect(page.locator('.memory-card.active').filter({ hasText: '暖色' }).first()).toContainText('暖色');
  await page.reload(); await page.getByRole('tab', { name: /项目约定/ }).click();
  await expect(page.locator('.memory-card.active').filter({ hasText: '暖色' }).first()).toContainText('暖色');
  assert.equal((await account()).session.quota.runsUsed, usedAfterBuilds);
  await page.screenshot({ path: 'review-artifacts/m1-services/memory-and-preview.png' });
  const memory = await page.evaluate(async () => (await fetch(`/api/v2/projects/${location.hash.split('/').at(-1)}/memory`)).json());
  const warmDecision = memory.decisions.find(decision => decision.status === 'active' && decision.text.includes('暖色'));
  assert.ok(warmDecision?.sourceMessageIds?.[0], 'Warm decision needs a canonical saved source');
  await page.locator('.memory-card.active').filter({ hasText: '暖色' }).first().getByRole('button', { name: /查看来源/ }).first().click();
  const source = page.locator(`[data-message-id=\"${warmDecision.sourceMessageIds[0]}\"] .message.user p`);
  await expect(source).toContainText('暖色');
  await expect(source).toBeInViewport();
  await page.screenshot({ path: 'review-artifacts/m1-services/memory-source.png' });
  console.log(JSON.stringify({ target: target.origin, projectId: second.execution.project.id,
    verification: 'real HTTP services, no MSW; operator-attested Fake Router/Worker; actual builds and preview',
    scope: reusedProjectId ? 'read-only consultation final UI + memory/source persistence segment; no new builds' : 'full Fake-service browser flow',
    checks: { consultationWithoutNewRun: true, consultationFinalUiRendered: true,
      planAndRefresh: reusedProjectId ? 'not repeated in this run' : true, previewAddEditPersistence: reusedProjectId ? 'not repeated in this run' : true,
      askProposalWithoutBuild: reusedProjectId ? 'not repeated in this run' : true, explicitProposalAcceptance: reusedProjectId ? 'not repeated in this run' : true, memoryAndSourcesAcrossRefresh: true },
    versions: [first.execution.currentVersion.id, second.execution.currentVersion.id],
    screenshots: ['review-artifacts/m1-services/consult.png', 'review-artifacts/m1-services/memory-and-preview.png', 'review-artifacts/m1-services/memory-source.png'] }, null, 2));
  }
} catch (error) {
  if (page) {
    await mkdir('review-artifacts/m1-services', { recursive: true });
    await page.screenshot({ path: 'review-artifacts/m1-services/failure.png' }).catch(() => {});
    console.error('Browser failure screenshot: review-artifacts/m1-services/failure.png');
  }
  throw error;
} finally { await browser.close(); }
