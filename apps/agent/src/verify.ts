import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { safeFile } from './files.js';
import type { Check } from '@atoms/contracts';

type CheckValue = ReturnType<typeof Check.parse>;
const require = createRequire(import.meta.url);
export const agentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const browserEnvironment = () => Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'SystemRoot'].flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : []));
export const mediaType = (name: string) => name.endsWith('.html') ? 'text/html; charset=utf-8'
  : name.endsWith('.js') ? 'application/javascript; charset=utf-8'
    : name.endsWith('.css') ? 'text/css; charset=utf-8'
      : name.endsWith('.png') ? 'image/png' : name.endsWith('.json') ? 'application/json' : 'text/plain; charset=utf-8';

export async function verificationCommand(args: string[], workspace: string, signal: AbortSignal) {
  return await new Promise<{ success: boolean; log: string;exitCode:number|null;terminationSignal:NodeJS.Signals|null }>((resolve, reject) => {
    if (signal.aborted) return reject(new Error('Execution aborted'));
    const child = spawn(process.execPath, args, { cwd: workspace, detached: process.platform !== 'win32',
      env: { PATH: process.env.PATH, HOME: workspace, NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    const collect = (data: Buffer) => { log = (log + data.toString()).slice(-100000); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    const stop = () => {
      try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { }
    };
    signal.addEventListener('abort', stop, { once: true });
    child.on('error', (error) => { signal.removeEventListener('abort', stop); reject(error); });
    child.on('close', (code,terminationSignal) => {
      signal.removeEventListener('abort', stop);
      if (signal.aborted) reject(new Error('Execution aborted'));
      else resolve({ success: code === 0, log: log || `Exited ${code}`,exitCode:code,terminationSignal });
    });
  });
}

export async function linkDependencies(workspace: string) {
  const target = path.join(workspace, 'node_modules');
  if (!existsSync(target)) await symlink(path.join(agentRoot, 'node_modules'), target, 'dir');
}

export async function verifyApplication(workspace: string, evidenceRoot: string, signal: AbortSignal,
  report: (check: CheckValue) => void, activity: (message: string) => void = () => {}, options: { installedDependencies?: boolean; chromiumSandbox?: boolean } = {}) {
  await mkdir(evidenceRoot, { recursive: true });
  if (!options.installedDependencies) await linkDependencies(workspace);
  const checks: CheckValue[] = [];
  const checkCommand = async (kind: 'typecheck' | 'build', args: string[]) => {
    const label = kind === 'typecheck' ? 'TypeScript 类型检查' : 'Vite 生产构建';
    activity(`开始${label}。`);
    const result = await verificationCommand(args, workspace, signal);
    await writeFile(path.join(evidenceRoot, `${kind}.log`), result.log);
    const check: CheckValue = { id: `check_${kind}`, kind, name: kind === 'build' ? 'Vite 生产构建' : 'TypeScript 类型检查', required: true,
      status: result.success ? 'passed' : 'failed', summary: result.success ? '命令执行通过' : result.log.slice(-1500), evidenceIds: [`evidence_${kind}`] };
    checks.push(check); report(check);
    activity(`${label}${result.success ? '通过' : '未通过，已保存检查日志'}。`);
    return result;
  };
  const dependency = options.installedDependencies ? createRequire(path.join(workspace, 'package.json')) : require;
  const typed = await checkCommand('typecheck', [dependency.resolve('typescript/bin/tsc'), '--noEmit']);
  if (!typed.success) return { checks, errors: typed.log,failureCategory: !typed.terminationSignal&&/error TS[0-9]+:/.test(typed.log)?'code_check' as const:'infrastructure' as const };
  const built = await checkCommand('build', [path.join(path.dirname(dependency.resolve('vite/package.json')), 'bin/vite.js'), 'build']);
  if (!built.success) return { checks, errors: built.log,failureCategory: !built.terminationSignal&&/\[vite:|RollupError|Transform failed|Could not resolve/.test(built.log)?'code_check' as const:'infrastructure' as const };
  activity('开始浏览器加载检查：验证页面可加载且无运行时异常。');
  const smoke = await smokeBrowser(path.join(workspace, 'dist'), evidenceRoot, signal, options.chromiumSandbox);
  const check: CheckValue = { id: 'check_smoke', kind: 'smoke', name: '浏览器加载检查', required: true,
    status: smoke.success ? 'passed' : 'failed', summary: smoke.log.slice(-1500),
    evidenceIds: ['evidence_smoke', ...(smoke.screenshot ? ['evidence_screenshot'] : [])] };
  checks.push(check); report(check);
  activity(smoke.success ? '浏览器加载检查通过；具体功能行为仍需验收。' : '浏览器加载检查未通过，已保存检查日志。');
  return { checks, errors: smoke.success ? null : smoke.log,failureCategory:smoke.success?undefined:smoke.failureCategory };
}

export async function smokeBrowser(dist: string, evidenceRoot: string, signal: AbortSignal, chromiumSandbox = false) {
  const server = createServer(async (req, res) => {
    try {
      const name = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname).replace(/^\//, '') || 'index.html';
      const file = await safeFile(dist, name);
      res.setHeader('content-type', mediaType(file)); res.end(await readFile(file));
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Smoke server failed');
  const origin = `http://127.0.0.1:${address.port}`;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;let failureCategory:'code_check'|'infrastructure'='infrastructure';
  let log = ''; let screenshot = false;
  const stop = () => { void browser?.close(); };
  signal.addEventListener('abort', stop, { once: true });
  try {
    const chrome = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
    browser = await chromium.launch({ headless: true, executablePath: chrome, chromiumSandbox, env: browserEnvironment() });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', (route) => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    const response = await page.goto(origin, { waitUntil: 'networkidle', timeout: 15000 });
    const text = await page.locator('#root').innerText({ timeout: 10000 });
    if(response?.ok()&&(!text.trim()||errors.length))failureCategory='code_check';
    if (!response?.ok() || !text.trim() || errors.length) throw new Error(`Browser smoke failed: ${errors.join('; ') || 'empty app or HTTP error'}`);
    await page.screenshot({ path: path.join(evidenceRoot, 'screenshot.png'), fullPage: true }); screenshot = true;
    log = `Browser loaded HTTP ${response.status()}; #root contains ${text.trim().length} characters; no pageerror. Behavior acceptance is not implied.`;
  } catch (error) { log = error instanceof Error ? error.message : 'Browser smoke failed'; }
  finally {
    signal.removeEventListener('abort', stop);
    await browser?.close().catch(() => {});
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (signal.aborted) throw new Error('Execution aborted');
  await writeFile(path.join(evidenceRoot, 'smoke.log'), log);
  return { success: screenshot, log, screenshot,failureCategory };
}
