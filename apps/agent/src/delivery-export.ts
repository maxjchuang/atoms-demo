import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, realpath, lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { zipSync, unzipSync, type Zippable } from 'fflate';
import { SourceExportManifest, CleanBuildReport, canonicalDeliveryJson, type FrozenDeliveryBundleDto, type VerificationEvidenceBinding, type CaseResult } from '@atoms/contracts/delivery';
import { safeFile, putFile, sha256, listFiles } from './files.js';
import { fingerprints, inventoryHash, seal, assertSealed } from './delivery-files.js';
import { verifyApplication } from './verify.js';
import { StopUnconfirmedError } from './isolation/client.js';
import { assertControlledSource } from './source-policy.js';
import { runBrowserPlan } from './browser-dsl.js';

type Evidence = ReturnType<typeof VerificationEvidenceBinding.parse>;
type Result = ReturnType<typeof CaseResult.parse>;
export function notRunCases(bundle: FrozenDeliveryBundleDto, reason: string): Result[] {
  return bundle.plan.cases.map((entry) => ({ caseId: entry.id, criterionIds: entry.criterionIds, status: 'not_run',
    steps: entry.steps.map((step) => ({ stepId: step.id, status: 'not_run' })), failure: null, reason, evidenceIds: [] }));
}
export async function evidenceFiles(dir: string, relative: string, scope: Evidence['scope'], bundle: FrozenDeliveryBundleDto,
  sourceHash: string, attemptId: string | null, prefix: string) {
  const evidence: Evidence[] = [];
  for (const name of await listFiles(dir)) {
    const content = await readFile(await safeFile(dir, name));
    const localId = name === 'screenshot.png' ? 'screenshot' : name.replace(/\.(log|json)$/, '').replace(/\.png$/, '_screenshot').replaceAll('.', '_');
    evidence.push({ id: `${prefix}_${localId}`, path: `evidence/${relative}/${name}`, sha256: sha256(content), bytes: content.length,
      kind: name.endsWith('.png') ? 'screenshot' : name.endsWith('.json') ? 'report' : 'log', mediaType: name.endsWith('.png') ? 'image/png' : name.endsWith('.json') ? 'application/json' : 'text/plain',
      scope, attemptId, sourceSnapshotHash: sourceHash, specHash: bundle.spec.hash, planHash: bundle.plan.hash });
  }
  return evidence;
}
export function remapEvidenceIds(results: Result[], evidence: Evidence[]): Result[] {
  return results.map((entry) => ({ ...entry, evidenceIds: evidence.filter((file) => file.path.endsWith(`/${entry.caseId}.log`) || file.path.endsWith(`/${entry.caseId}.png`)).map((file) => file.id) }));
}
async function assertIndependentTree(root: string, dir: string) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, item.name); const stat = await lstat(target);
    if (stat.isSymbolicLink()) { const resolved = await realpath(target); if (!resolved.startsWith(root + path.sep)) throw new Error('Clean install points outside its independent tree: ' + path.relative(root, target) + ' -> ' + resolved); }
    else if (item.isDirectory()) await assertIndependentTree(root, target);
  }
}
/** Resolve the host-prepared exact pnpm payload, never Corepack's network shim in clean HOME. */
export async function trustedPnpmCli(version:string){
  if(version!=='10.33.0')throw new Error('Clean install requires the prepared pnpm 10.33.0 toolchain');
  const cache=process.env.COREPACK_HOME??path.join(process.env.XDG_CACHE_HOME??path.join(os.homedir(),'.cache'),'node','corepack');
  const candidates=[process.env.npm_execpath,path.join(cache,'v1','pnpm',version,'bin','pnpm.cjs'),path.resolve(path.dirname(process.execPath),'../lib/node_modules/pnpm/bin/pnpm.cjs')].filter((p):p is string=>!!p);
  for(const file of candidates){try{const cli=await realpath(file),pkg=JSON.parse(await readFile(path.resolve(path.dirname(cli),'../package.json'),'utf8'));if(pkg.name==='pnpm'&&pkg.version===version&&path.basename(cli)==='pnpm.cjs')return cli;}catch{}}
  throw new Error('Prepared pnpm 10.33.0 was not found; prepare the trusted toolchain before clean export');
}
export const transientInstallFailure=(log:string)=>!/(ERR_PNPM_(?:OUTDATED_LOCKFILE|NO_MATCHING_VERSION|FETCH_40[134]|UNSUPPORTED_ENGINE)|ERR_PNPM_WORKSPACE_PKG_NOT_FOUND|ERR_MODULE_NOT_FOUND|integrity check failed|ENOENT)/i.test(log)&&/(ERR_HTTP2_STREAM_ERROR|NGHTTP2_INTERNAL_ERROR|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ERR_PNPM_FETCH_50[234])/i.test(log);
type InstallResult={success:boolean;log:string};
export async function boundedCleanInstall(run:()=>Promise<InstallResult>,signal:AbortSignal){
 const first=await run();if(first.success||signal.aborted||!transientInstallFailure(first.log))return first;
 const second=await run();return{success:second.success,log:'=== independent install attempt 1 ===\n'+first.log+'\n=== one bounded transient-network retry ===\n'+second.log};
}
async function install(workspace: string, home: string, signal: AbortSignal,version:string) {
  await mkdir(home, { recursive: true });const cli=await trustedPnpmCli(version);
  const installArgs=['install', '--frozen-lockfile', '--ignore-workspace', '--ignore-pnpmfile', '--ignore-scripts', '--registry=https://registry.npmjs.org', '--config.node-linker=isolated', '--config.enable-global-virtual-store=false', '--config.virtual-store-dir=node_modules/.pnpm', '--config.manage-package-manager-versions=false', '--config.package-import-method=copy','--fetch-retries=0', '--reporter=append-only'];
  const run=(args=installArgs)=>new Promise<InstallResult>((resolve, reject) => {
    if (signal.aborted) return reject(new Error('Clean export cancelled'));
    const child = spawn(process.execPath, [cli,...args],
      { cwd: workspace, env: { PATH: process.env.PATH, HOME: home, NODE_ENV: 'development', CI: 'true', npm_config_registry: 'https://registry.npmjs.org' }, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let log = ''; const collect = (data: Buffer) => { log = (log + data.toString()).slice(-100000); }; child.stdout.on('data', collect); child.stderr.on('data', collect);
    const stop = () => { try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {} };
    signal.addEventListener('abort', stop, { once: true }); child.on('error', error=>{signal.removeEventListener('abort',stop);reject(error);});
    child.on('close', (code) => { signal.removeEventListener('abort', stop); if (signal.aborted) reject(new Error('Clean export cancelled')); else resolve({ success: code === 0, log }); });
  });const checked=await run(['--version']);if(!checked.success||checked.log.trim()!==version)return{success:false,log:'Trusted pnpm version check failed: '+checked.log};return boundedCleanInstall(run,signal);
}
/** ZIP bytes, then external export manifest, then clean report: no self-referential archive. */
export type IsolatedClean = (options:{workspace:string;evidenceDir:string;bundle:FrozenDeliveryBundleDto;exported:ReturnType<typeof SourceExportManifest.parse>;startedAt:string;signal:AbortSignal})=>Promise<{clean:ReturnType<typeof CleanBuildReport.parse>;evidence:Evidence[]}>;
export async function exportAndVerify(options: { round?:number;trustedBrowserLocale?:string;isolatedClean?:IsolatedClean; workspace: string; root: string; bundle: FrozenDeliveryBundleDto; signal: AbortSignal; activity: (text: string) => void }) {
  const { workspace, root, bundle, signal } = options; const toolchain = bundle.binding.toolchain;
  if(options.round!==undefined&&(!Number.isSafeInteger(options.round)||options.round<0||options.round>bundle.binding.totalBudget.maxRepairRounds))throw new Error('Invalid bounded export round');const suffix=options.round===undefined?'':'_round_'+options.round;
  const files = await fingerprints(workspace, 'source/'); const sourceHash = inventoryHash(files);
  if (files.find((entry) => entry.path === 'source/package.json')?.sha256 !== toolchain.packageJsonHash
    || files.find((entry) => entry.path === 'source/pnpm-lock.yaml')?.sha256 !== toolchain.lockfileHash) throw new Error('Export trusted package or lock fingerprint mismatch');
  const pkg = JSON.parse(await readFile(path.join(workspace, 'package.json'), 'utf8'));
  if (sha256(canonicalDeliveryJson(pkg.scripts)) !== toolchain.scriptsHash) throw new Error('Export scripts fingerprint mismatch');
  const contents = canonicalDeliveryJson({ protocolVersion: '0.1.0', sourceSnapshotHash: sourceHash, templateId: toolchain.templateId, toolchainId: toolchain.id,
    files: files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })) });
  const entries: Zippable = {}; const mtime = new Date(1980, 0, 1);
  for (const file of files) entries[file.path] = [new Uint8Array(await readFile(await safeFile(workspace, file.path.slice(7)))), { mtime }];
  entries['contents-manifest.json'] = [new TextEncoder().encode(contents), { mtime }];
  const archive = zipSync(entries, { level: 6 }); await mkdir(root, { recursive: true }); await writeFile(path.join(root, 'source.zip'), archive);
  const exported = SourceExportManifest.parse(seal({ protocolVersion: '0.1.0' as const, id: `export_${bundle.binding.executionId}${suffix}`, hash: '0'.repeat(64),
    projectId: bundle.binding.projectId, runId: bundle.binding.runId, executionId: bundle.binding.executionId, bindingHash: bundle.binding.hash,
    sourceSnapshotHash: sourceHash, templateId: toolchain.templateId, templateHash: toolchain.templateHash, packageJsonHash: toolchain.packageJsonHash,
    scriptsHash: toolchain.scriptsHash, lockfileHash: toolchain.lockfileHash, toolchainId: toolchain.id, files, contentsManifestHash: sha256(contents),
    archive: { id: `archive_${bundle.binding.executionId}${suffix}`, sha256: sha256(archive), bytes: archive.length }, createdAt: new Date().toISOString() }));
  return { exported, archive: Buffer.from(archive), ...await verifyArchive({ ...options, exported, archive }) };
}
export async function verifyArchive(options: { trustedBrowserLocale?:string;isolatedClean?:IsolatedClean; root: string; bundle: FrozenDeliveryBundleDto; exported: ReturnType<typeof SourceExportManifest.parse>; archive: Uint8Array; signal: AbortSignal; activity: (text: string) => void }) {
  const { root, bundle, exported, signal, activity } = options; const startedAt = new Date().toISOString();
  const cleanRoot = path.join(root, 'clean'); const workspace = path.join(cleanRoot, 'source'); const evidenceDir = path.join(root, 'evidence', 'clean'); await mkdir(evidenceDir, { recursive: true }); await mkdir(cleanRoot, { recursive: true });
  const notRun = () => ({ status: 'not_run' as const, evidenceIds: [] as string[], reason: 'A prior clean export stage failed.' });
  const stages = { install: notRun(), typecheck: notRun(), build: notRun(), smoke: notRun() };
  let results = notRunCases(bundle, 'Clean build has not reached browser verification.'); let before = exported.sourceSnapshotHash; let after: string | null = null; let distHash: string | null = null;
  try {
    assertSealed(exported); for (const value of [bundle.seed, bundle.spec, bundle.plan, bundle.binding]) assertSealed(value);
    if (exported.bindingHash !== bundle.binding.hash || exported.toolchainId !== bundle.binding.toolchain.id || exported.lockfileHash !== bundle.binding.toolchain.lockfileHash) throw new Error('Clean export frozen binding mismatch');
    if (sha256(options.archive) !== exported.archive.sha256) throw new Error('Archive bytes do not match frozen export');
    const entries = unzipSync(options.archive); const expected = new Set([...exported.files.map((entry) => entry.path), 'contents-manifest.json']);
    if (Object.keys(entries).length !== expected.size || Object.keys(entries).some((name) => !expected.has(name))) throw new Error('Archive entries differ from exact source manifest');
    if (!entries['contents-manifest.json'] || sha256(entries['contents-manifest.json']) !== exported.contentsManifestHash) throw new Error('Contents manifest fingerprint mismatch');
    for (const file of exported.files) {
      const bytes = entries[file.path]; if (!bytes || bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw new Error('Archive file integrity mismatch');
      await putFile(cleanRoot, file.path, bytes);
    }
    before = inventoryHash(await fingerprints(workspace, 'source/')); if (before !== exported.sourceSnapshotHash) throw new Error('Extracted source inventory mismatch');
    await assertControlledSource(workspace);
    if(options.isolatedClean)return await options.isolatedClean({workspace,evidenceDir,bundle,exported,startedAt,signal});
    activity('开始从精确导出 ZIP 的独立目录安装公开依赖；禁用生命周期脚本。');
    const installed = await install(workspace, path.join(root, 'clean-home'), signal,bundle.binding.toolchain.pnpmVersion); await writeFile(path.join(evidenceDir, 'install.log'), installed.log);
    stages.install = { status: installed.success ? 'passed' : 'failed', evidenceIds: ['clean_install'], reason: installed.success ? null : 'Frozen independent install failed.' } as never;
    if (!installed.success) throw new Error('Clean install failed'); await assertIndependentTree(await realpath(cleanRoot), path.join(workspace, 'node_modules'));
    const verified = await verifyApplication(workspace, evidenceDir, signal, () => {}, activity, { installedDependencies: true });
    for (const kind of ['typecheck', 'build', 'smoke'] as const) { const check = verified.checks.find((entry) => entry.kind === kind); if (check) stages[kind] = { status: check.status, evidenceIds: [`clean_${kind}`], reason: check.status === 'passed' ? null : check.summary } as never; }
    if (!verified.errors) { activity('开始在干净导出构建中重跑同一冻结浏览器计划。'); const behavior = await runBrowserPlan({ dist: path.join(workspace, 'dist'), plan: bundle.plan, evidenceDir, signal,trustedBrowserLocale:options.trustedBrowserLocale }); results = behavior.caseResults; if (behavior.interrupted) { await writeFile(path.join(evidenceDir, 'browser-budget.log'), 'Clean frozen browser validation exceeded its bounded budget or was cancelled.'); stages.smoke = { status: 'failed', evidenceIds: ['clean_browser-budget'], reason: 'Clean browser verification was interrupted.' } as never; } }
    after = inventoryHash(await fingerprints(workspace, 'source/')); const distFiles = await fingerprints(path.join(workspace, 'dist'), 'dist/'); distHash = inventoryHash(distFiles);
  } catch (error) {
    if(error instanceof StopUnconfirmedError)throw error;
    const message = error instanceof Error ? error.message : 'Clean export failed'; await writeFile(path.join(evidenceDir, 'failure.log'), message);
    if (stages.install.status === 'not_run') { await writeFile(path.join(evidenceDir, 'install.log'), message); stages.install = { status: 'failed', evidenceIds: ['clean_install'], reason: message } as never; }
  }
  const evidence = await evidenceFiles(evidenceDir, 'clean', 'clean_export', bundle, before, null, 'clean');
  results = remapEvidenceIds(results, evidence);
  const clean = CleanBuildReport.parse(seal({ protocolVersion: '0.1.0' as const, id: `clean_${bundle.binding.executionId}`, hash: '0'.repeat(64), runId: bundle.binding.runId,
    executionId: bundle.binding.executionId, bindingHash: bundle.binding.hash, exportManifestHash: exported.hash, archiveHash: exported.archive.sha256,
    sourceBeforeHash: before, sourceAfterHash: after, distHash, lockfileHash: exported.lockfileHash, toolchainId: exported.toolchainId,
    verifiedPlatform: { nodeVersion: process.versions.node, pnpmVersion: bundle.binding.toolchain.pnpmVersion, os: process.platform, arch: process.arch },
    registry: 'https://registry.npmjs.org' as const, frozenLockfile: true as const, lifecycleScripts: 'disabled' as const, usedPlatformSymlinks: false as const,
    stages, caseResults: results, startedAt, finishedAt: new Date().toISOString() }));
  return { clean, evidence };
}
