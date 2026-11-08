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
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname), 'Only local isolated integration services are allowed.');
assert.notEqual(target.port, '5173', 'Refusing the existing live workbench on port 5173.');
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ?? (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
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
  const settled = () => expect.poll(async () => (await workspace()).latestCoordinationTurn?.status, { timeout: 30000 }).toBe('completed');
  const initialAccount = await account();
  await send('如何分享这个应用给别人？', 'ask'); await settled();
  assert.equal((await workspace()).execution.latestRun, null, 'Consultation must not create a build');
  assert.equal((await account()).session.quota.runsUsed, initialAccount.session.quota.runsUsed);
  await mkdir('review-artifacts/m1-services', { recursive: true });
  await page.screenshot({ path: 'review-artifacts/m1-services/consult.png' });

  await page.getByLabel('构建策略').selectOption('plan');
  await send('创建一个可以新增、编辑并在刷新后保存内容的便签墙。');
  await expect(page.getByRole('button', { name: '确认计划，继续本次构建' })).toBeVisible({ timeout: 30000 });
  await page.reload(); await page.getByRole('button', { name: '确认计划，继续本次构建' }).click();
  await expect(page.locator('.current-run-strip .run-card-top > strong')).toHaveText('已交付', { timeout: 120000 });
  const first = await workspace();
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
  const second = await workspace();
  const usedAfterBuilds = (await account()).session.quota.runsUsed;

  await send('请记住我的项目偏好：界面保持暖色，仅记录约定，不修改当前应用。', 'ask'); await settled();
  await page.getByRole('tab', { name: /项目约定/ }).click();
  await expect(page.locator('.memory-card.active').first()).toContainText('暖色');
  await page.reload(); await page.getByRole('tab', { name: /项目约定/ }).click();
  await expect(page.locator('.memory-card.active').first()).toContainText('暖色');
  assert.equal((await account()).session.quota.runsUsed, usedAfterBuilds);
  await page.screenshot({ path: 'review-artifacts/m1-services/memory-and-preview.png' });
  await page.locator('.memory-card.active').first().getByRole('button', { name: /查看来源/ }).first().click();
  await expect(page.locator('.message.user p').filter({ hasText: /^请记住我的项目偏好/ })).toBeVisible();
  await page.screenshot({ path: 'review-artifacts/m1-services/memory-source.png' });
  console.log(JSON.stringify({ target: target.origin, projectId: second.execution.project.id,
    verification: 'real HTTP services, no MSW; operator-attested Fake Router/Worker; actual builds and preview',
    checks: { consultationWithoutRun: true, planAndRefresh: true, previewAddEditPersistence: true,
      askProposalWithoutBuild: true, explicitProposalAcceptance: true, memoryAndSourcesAcrossRefresh: true },
    versions: [first.execution.currentVersion.id, second.execution.currentVersion.id],
    screenshots: ['review-artifacts/m1-services/consult.png', 'review-artifacts/m1-services/memory-and-preview.png', 'review-artifacts/m1-services/memory-source.png'] }, null, 2));
} finally { await browser.close(); }
