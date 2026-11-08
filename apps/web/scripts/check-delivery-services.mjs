import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { DeliveryReadView, ExportReadView } from '@atoms/contracts/delivery';
// Operator confirms isolated API + Agent use Fake. This script never switches
// service configuration, loads keys, or treats an MSW run as service evidence.
assert.equal(process.env.ATOMS_FAKE_SERVICES, '1', 'Operator-confirmed Fake services required.');
assert.ok(process.env.ATOMS_WEB_URL, 'Explicit isolated workbench URL required.');
const target = new URL(process.env.ATOMS_WEB_URL);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname));
assert.notEqual(target.port, '5173', 'Refusing the paid/live workbench.');
const existing = process.env.ATOMS_DELIVERY_PROJECT;
if (existing) assert.match(existing, /^project_[a-z0-9_-]+$/);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const output = 'review-artifacts/m2-services'; await mkdir(output, { recursive: true });
try {
  await page.goto(target.origin); await expect(page.locator('.mock-banner')).toContainText('Fake DSH');
  assert.equal(await page.evaluate(() => !!navigator.serviceWorker.controller), false, 'No MSW allowed.');
  await page.getByRole('button', { name: '开启体验' }).click(); await page.getByLabel('体验码', { exact: true }).fill(process.env.ATOMS_DEMO_CODE ?? 'atoms-demo-2026');
  await page.getByRole('button', { name: '进入创作空间' }).click(); await expect(page.getByRole('dialog')).toBeHidden();
  if (existing) await page.goto(`${target.origin}/#/projects/${existing}`);
  else {
    await page.getByLabel('应用需求', { exact: true }).fill('创建便签墙，支持新增、编辑、删除、搜索、拖拽和刷新后保存文本及位置。');
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
  }
  await expect(page.getByLabel('项目消息', { exact: true })).toBeVisible({ timeout: 30000 });
  const workspace = () => page.evaluate(async () => { const response = await fetch(`/api/v2/projects/${location.hash.split('/').at(-1)}/workspace`); if (!response.ok) throw new Error(`Workspace ${response.status}`); return response.json(); });
  await expect.poll(async () => (await workspace()).execution.latestRun?.status, { timeout: 240000 }).toBe('succeeded');
  const snapshot = await workspace(); assert.ok(snapshot.execution.currentVersion); const version = snapshot.execution.currentVersion;
  const read = await page.evaluate(async id => (await fetch(`/api/delivery/v1/versions/${id}`, { headers: { 'X-Atoms-Delivery-Version': '0.1.0' } })).json(), version.id);
  const view = DeliveryReadView.parse(read); assert.equal(view.state, 'available'); assert.equal(view.apiVerification, 'verified'); assert.equal(view.publication.status, 'published'); assert.equal(view.publication.publishedVersionId, version.id);
  assert.ok(['complete', 'partial'].includes(view.quality));
  const summary = page.getByTestId('delivery-summary').first(); await expect(summary).toContainText(view.quality === 'partial' ? '部分交付' : '约定验收完成');
  if (view.quality === 'partial') { assert.ok(view.gaps.length); await expect(summary.locator('.delivery-gaps')).toBeVisible(); }
  await expect(page.getByTitle('应用预览', { exact: true })).toBeVisible(); await page.screenshot({ path: `${output}/preview-quality.png` });
  await summary.getByRole('button', { name: '查看交付报告' }).click(); const panel = page.getByTestId('delivery-report');
  await expect(panel).toContainText('此版本已发布'); await expect(panel.locator('.criterion-row')).toHaveCount(view.report.bundle.spec.criteria.length);
  await expect(panel.locator('.delivery-attempt')).toHaveCount(view.report.attempts.length);
  await panel.getByText('基础检查详情与日志', { exact: true }).first().click();
  const proof = panel.getByRole('button', { name: /查看证据|查看截图/ }).first();
  if (await proof.count()) { await proof.click(); await expect(panel.locator('.delivery-evidence pre, .delivery-evidence img').first()).toBeVisible(); }
  const exportView = ExportReadView.parse(await page.evaluate(async id => (await fetch(`/api/delivery/v1/versions/${id}/export`, { headers: { 'X-Atoms-Delivery-Version': '0.1.0' } })).json(), version.id));
  assert.equal(exportView.status, 'verified'); assert.equal(exportView.downloadRef.subjectVersionId, version.id);
  await expect(panel).toContainText('精确 ZIP 已完成干净安装与复验');
  const downloadPromise = page.waitForEvent('download'); await panel.getByRole('button', { name: '下载已核对源码 ZIP' }).click();
  const download = await downloadPromise; assert.equal(await download.failure(), null);
  await panel.evaluate(element => { element.scrollTop = 0; }); await page.screenshot({ path: `${output}/report.png` });
  await page.getByRole('button', { name: '改动', exact: true }).click(); await expect(page.getByTestId('version-diff')).toContainText('仅比较受控源码'); await page.screenshot({ path: `${output}/diff.png` });
  await page.reload(); await expect(page.getByTestId('delivery-summary').first()).toContainText(view.quality === 'partial' ? '部分交付' : '约定验收完成');
  assert.equal((await workspace()).execution.currentVersion.id, version.id);
  const result = { scope: existing ? 'existing delivery: genuine HTTP/browser report, evidence, exact archive download, diff, refresh; zero new Run or messages' : 'new Fake-service generation, report/evidence/archive/diff/refresh',
    target: target.origin, projectId: snapshot.execution.project.id, versionId: version.id, quality: view.quality,
    publication: view.publication.status, createdRuns: existing ? 0 : 1, screenshots: ['preview-quality.png', 'report.png', 'diff.png'],
    limitation: 'Fake services are not real model evidence; this UI gate does not independently prove OS sandbox or cross-platform build.' };
  await writeFile(`${output}/result.json`, `${JSON.stringify(result, null, 2)}\n`); console.log(JSON.stringify(result, null, 2));
} catch (error) { await page.screenshot({ path: `${output}/failure.png` }).catch(() => {}); throw error; }
finally { await browser.close(); }
