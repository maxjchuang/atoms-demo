/** Explicit G5 external browser audit. No model call, no project creation, no MSW/route.fulfill. */
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { SharingDescriptor, SharingProtocolVersion } from '@atoms/contracts/sharing';
import { ExportReadView } from '@atoms/contracts/delivery';
import { readExternalSharingConfig, externalRequestAllowed, safeExternalPath, readProtectedReviewerCode } from './external-sharing-guard.ts';

const config = readExternalSharingConfig(process.env);
const code = await readProtectedReviewerCode(config.codeFile);
const output = 'review-artifacts/m3-external'; await mkdir(output, { recursive: true });
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
const browser = await chromium.launch(executablePath ? { executablePath } : {});
let stage = 'setup'; const forbidden = [], resources = [], consoleErrors = [];
async function guard(context) {
  await context.route('**/*', async route => {
    const request = route.request();
    if (!externalRequestAllowed(request.method(), request.url(), config, request.postData())) { forbidden.push({ method: request.method(), ...safeExternalPath(request.url()) }); await route.abort(); }
    else await route.continue(); // Never synthesize response bodies or headers.
  });
  context.on('response', response => { const url = response.url(); if (url.startsWith(config.previewOrigin + '/') && ['script', 'stylesheet', 'document'].includes(response.request().resourceType())) resources.push({ ...safeExternalPath(url), type: response.request().resourceType(), status: response.status() }); });
}
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' }); await guard(context);
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: config.workbenchOrigin });
const page = await context.newPage(); page.on('pageerror', () => consoleErrors.push({ stage }));
const guest = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } }); await guard(guest);
const guestPage = await guest.newPage(); guestPage.on('pageerror', () => consoleErrors.push({ stage }));
async function read(path, headers = {}) { return page.evaluate(async ({ path, headers }) => { const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', headers }); if (!response.ok) throw new Error(`Read status ${response.status}`); return response.json(); }, { path, headers }); }
async function counters() {
  const workspace = await read(`/api/v2/projects/${config.projectId}/workspace`), account = await read('/api/v2/session'), versions = await read(`/api/v1/projects/${config.projectId}/versions?limit=100`);
  assert.equal(workspace.execution.activeRun, null, 'Audit requires settled existing work.'); assert.equal(workspace.pendingCoordinationTurns.length, 0);
  return { quota: account.session.quota, coordinationQuota: account.coordinationQuota, currentVersionId: workspace.execution.currentVersion?.id, latestRunId: workspace.execution.latestRun?.id ?? null, conversationRevision: workspace.conversationRevision, executionCursor: workspace.executionEventCursor, conversationCursor: workspace.conversationEventCursor, messageIds: workspace.messages.map(item => item.id), versionIds: versions.items.map(item => item.id) };
}
async function screenshot(name) { await page.screenshot({ path: `${output}/${name}`, mask: [page.locator('input')] }); }
try {
  stage = 'external-login'; await page.goto(config.workbenchOrigin); assert.equal(await page.evaluate(() => !!navigator.serviceWorker.controller), false);
  await page.getByRole('button', { name: '开启体验', exact: true }).click(); await page.getByLabel('体验码', { exact: true }).fill(code); await page.getByRole('button', { name: '进入创作空间', exact: true }).click(); await expect(page.getByRole('dialog')).toBeHidden();
  const cookies = await context.cookies(config.workbenchOrigin); const session = cookies.find(item => item.name === 'atoms_session'); assert.ok(session?.secure && session.httpOnly && session.sameSite === 'Lax'); assert.equal(session.domain, new URL(config.workbenchOrigin).hostname);
  await page.goto(`${config.workbenchOrigin}/#/projects/${config.projectId}`); await expect(page.getByRole('button', { name: '分享当前应用' })).toBeVisible(); await page.reload(); await expect(page.getByRole('button', { name: '分享当前应用' })).toBeVisible();
  const before = await counters(); assert.equal(before.currentVersionId, config.versionId, 'Select the approved current version before starting this audit.');
  stage = 'actual-share-and-clipboard'; await page.getByRole('button', { name: '分享当前应用' }).click(); const dialog = page.getByTestId('sharing-dialog');
  await expect(dialog.getByRole('button', { name: '复制应用链接', exact: true })).toBeEnabled();
  const descriptor = SharingDescriptor.parse(await read(`/api/sharing/v1/projects/${config.projectId}?versionId=${config.versionId}`, { 'X-Atoms-Sharing-Version': SharingProtocolVersion })); assert.equal(descriptor.scope, 'public_temporary'); assert.equal(descriptor.subjectVersionId, config.versionId);
  await dialog.getByRole('button', { name: '复制应用链接', exact: true }).click(); await expect(dialog.locator('.sharing-result')).toContainText('链接已复制');
  const link = await dialog.getByLabel('固定版本的临时预览链接').inputValue(); assert.equal(new URL(link).origin, config.previewOrigin); assert.equal(await page.evaluate(() => navigator.clipboard.readText()), link);
  await screenshot('share-quality.png');
  stage = 'guest-real-modules-and-storage'; assert.equal((await guest.cookies()).length, 0); await guestPage.goto(link); await expect(guestPage.locator('#root')).not.toBeEmpty(); assert.equal(await guestPage.evaluate(() => !!navigator.serviceWorker.controller), false);
  await guestPage.locator(config.addSelector).click(); const marker = `M3 external refresh ${Date.now()}`; await guestPage.locator(config.editorSelector).last().fill(marker);
  await guestPage.waitForTimeout(800); await guestPage.reload(); await expect(guestPage.locator(config.editorSelector).last()).toHaveValue(marker);
  assert.ok(resources.some(item => item.type === 'script' && item.status >= 200 && item.status < 300), 'A real module/script must load from the external preview origin.'); assert.ok(resources.every(item => item.status < 400));
  assert.equal((await guest.cookies()).some(item => item.name === 'atoms_session'), false);
  await guestPage.screenshot({ path: `${output}/guest-refresh.png`, mask: [guestPage.locator('input')] });
  stage = 'build-entry-and-source-download'; await dialog.getByRole('button', { name: '邀请体验构建', exact: true }).click(); await dialog.getByRole('button', { name: '复制工作台入口', exact: true }).click(); await expect(dialog.locator('.sharing-result')).toContainText('链接已复制'); assert.equal(await dialog.getByLabel('工作台入口（不含体验码）').inputValue(), config.workbenchOrigin + '/');
  await dialog.getByRole('button', { name: '关闭分享窗口' }).click(); await page.getByRole('button', { name: '交付报告', exact: true }).click();
  const exported = ExportReadView.parse(await read(`/api/delivery/v1/versions/${config.versionId}/export`, { 'X-Atoms-Delivery-Version': '0.1.0' })); assert.equal(exported.status, 'verified'); assert.equal(exported.subjectVersionId, config.versionId); assert.ok(exported.manifest);
  const event = page.waitForEvent('download'); await page.getByTestId('delivery-report').getByRole('button', { name: '下载已核对源码 ZIP', exact: true }).click(); const download = await event; assert.equal(await download.failure(), null);
  const archive = await readFile(await download.path()); assert.equal(createHash('sha256').update(archive).digest('hex'), exported.manifest.archive.sha256); assert.equal(archive.byteLength, exported.manifest.archive.bytes);
  stage = 'anonymous-and-internal-deny'; const denied = [];
  for (const origin of [config.workbenchOrigin, config.previewOrigin]) for (const path of ['/internal/v1/health', '/internal/delivery/v1/toolchains/default', '/api/internal/health', '/docker.sock', '/@fs/etc/passwd']) {
    const response = await guest.request.get(origin + path, { maxRedirects: 0 }); assert.ok([401, 403, 404].includes(response.status()), 'Internal path must be rejected, not rewritten to a successful SPA.'); denied.push({ origin, path, status: response.status() });
  }
  for (const path of [`/api/v1/versions/${config.versionId}/source.zip`, `/api/delivery/v1/versions/${config.versionId}/source.zip`, `/api/sharing/v1/projects/${config.projectId}`]) {
    const response = await guest.request.get(config.workbenchOrigin + path, { maxRedirects: 0, headers: { 'X-Atoms-Sharing-Version': SharingProtocolVersion } }); assert.ok([401, 403, 404].includes(response.status())); denied.push({ path, status: response.status() });
  }
  const tampered = new URL(link); tampered.pathname = '/p/invalid.signature/index.html'; const response = await guest.request.get(tampered.href, { maxRedirects: 0 }); assert.ok([401, 403, 404].includes(response.status()));
  stage = 'readonly-final'; assert.deepEqual(await counters(), before); assert.deepEqual(forbidden, []); assert.deepEqual(consoleErrors, []);
  await writeFile(`${output}/result.json`, JSON.stringify({ mode: 'actual-external-browser-readonly', ...config, codeFile: '[redacted]', addSelector: '[reviewed app selector]', editorSelector: '[reviewed app selector]', descriptor: { scope: descriptor.scope, externalVerification: descriptor.externalVerification, deploymentInstanceId: descriptor.deploymentInstanceId }, before, after: before, resources, denied, modelCalls: 0, submittedMessages: 0, createdRuns: 0, clipboard: 'actual browser write/read matched', behavior: 'reviewed add/editor interaction persisted on refresh in fresh guest context', limitations: ['Only this existing approved app and browser context were checked.', 'Expiry, revocation, domain rotation and hostile Origin writes require separate backend-controlled gates; not claimed by this audit.', 'Shared preview origin is not tenant storage isolation.'] }, null, 2));
  console.log('External sharing audit passed; token-free evidence saved to review-artifacts/m3-external/result.json.');
} catch {
  await writeFile(`${output}/failure.json`, JSON.stringify({ stage, forbidden, consoleErrors, modelCalls: 0, submittedMessages: 0, createdRuns: 0, result: 'failed; raw errors omitted to avoid capability disclosure' }, null, 2));
  await screenshot('failure.png').catch(() => {});
  throw new Error(`External sharing audit failed at ${stage}; see sanitized failure evidence.`);
} finally { await guest.close(); await context.close(); await browser.close(); }
