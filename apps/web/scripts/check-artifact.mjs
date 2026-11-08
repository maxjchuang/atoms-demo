import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { chromium, expect } from '@playwright/test';

// Read-only browser verification of an already built artifact. This script does
// not call an Agent/model or modify the supplied generated source/dist.
const root = resolve(process.argv[2] ?? '');
assert.ok(process.argv[2] && existsSync(resolve(root, 'index.html')), 'Pass an existing dist directory containing index.html');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!path.startsWith(`${root}${sep}`) || !(await stat(path)).isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream' });
    res.end(await readFile(path));
  } catch { res.writeHead(404).end(); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ?? (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const failures = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (error) => failures.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}/`);
  const notes = page.getByLabel('便签内容', { exact: true });
  await expect(notes).toHaveCount(3);
  await page.getByRole('button', { name: '新增便签' }).click();
  await expect(notes).toHaveCount(4);
  const text = 'Real DSH 浏览器验收 — 便签搜索与刷新保存';
  await notes.last().fill(text);
  await expect(notes.last()).toHaveValue(text);
  const search = page.getByRole('searchbox', { name: '按内容搜索便签' });
  await search.fill('Real DSH');
  await expect(notes).toHaveCount(1);
  await expect(notes.first()).toHaveValue(text);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/real-artifact-search.png', fullPage: true });
  await search.fill('no-matching-note-20261108');
  await expect(notes).toHaveCount(0);
  await expect(page.getByText('没有匹配', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '清除搜索' }).click();
  await expect(notes).toHaveCount(4);
  await page.reload();
  await expect(notes).toHaveCount(4);
  assert.ok((await notes.evaluateAll((elements) => elements.map((element) => element.value))).includes(text));
  await page.screenshot({ path: 'test-results/real-artifact-behavior.png', fullPage: true });
  assert.deepEqual(failures, [], 'Generated page must not throw browser errors');
  console.log(JSON.stringify({ artifact: root, modelCalls: 0, modifiedGeneratedFiles: false,
    checks: { addNote: true, editNote: true, searchMatch: true, searchEmpty: true, clearSearch: true, refreshPersistence: true, noPageErrors: true },
    screenshots: ['test-results/real-artifact-search.png', 'test-results/real-artifact-behavior.png'] }, null, 2));
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
