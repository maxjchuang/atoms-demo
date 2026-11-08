import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { AcceptanceSpec, BrowserTestPlan, ToolchainDescriptor, canonicalDeliveryJson, type PrepareDeliveryPlanRequestDto } from '@atoms/contracts/delivery';
import { agentRoot } from './verify.js';
import { sha256 } from './files.js';
import { inventoryHash, seal } from './delivery-files.js';
import { templateFiles } from './template.js';

function pnpmVersion() {
  const result = spawnSync('pnpm', ['--version'], { cwd: agentRoot, env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 5000 });
  if (result.status !== 0 || result.stdout.trim() !== '10.33.0') throw new Error('Trusted toolchain requires actual pnpm 10.33.0'); return result.stdout.trim();
}
export const TOOLCHAIN_ID = 'toolchain_react_v1';
export async function trustedTemplate() {
  const packageBytes = await readFile(path.join(agentRoot, 'templates/react/package.json'));
  const lock = await readFile(path.join(agentRoot, 'templates/react/pnpm-lock.yaml'));
  if (/bnpm|code\.byted|workspace:|https?:\/\/[^\s]*@/.test(lock.toString())) throw new Error('Template lock is not portable/public');
  const pkg = JSON.parse(packageBytes.toString());
  const files: Record<string, string> = { ...templateFiles, 'package.json': packageBytes.toString(), 'pnpm-lock.yaml': lock.toString(),
    'README.md': '# Generated React application\n\nRequires Node >=22.19.0 and pnpm 10.33.0.\n\nAfter extracting source.zip, run `cd source` (the ZIP preserves the source/ directory).\n\nRun `pnpm install --frozen-lockfile --ignore-scripts --registry=https://registry.npmjs.org`, `pnpm run typecheck`, and `pnpm run build`.\n' };
  const descriptor = ToolchainDescriptor.parse({ id: TOOLCHAIN_ID, templateId: 'template_react_export_v1',
    templateHash: inventoryHash(Object.entries(files).map(([name, text]) => ({ path: name, bytes: Buffer.byteLength(text), sha256: sha256(text) }))),
    packageJsonHash: sha256(packageBytes), lockfileHash: sha256(lock), scriptsHash: sha256(canonicalDeliveryJson(pkg.scripts)),
    nodeVersion: process.versions.node, pnpmVersion: pnpmVersion(), os: process.platform, arch: process.arch,
    registry: 'https://registry.npmjs.org', lifecycleScripts: 'disabled' });
  return { files, descriptor };
}
export async function profileData(id: string) {
  const name = id === 'profile_notes_v1' ? 'notes' : id === 'profile_calculator_v1' ? 'calculator' : null;
  if (!name) throw new Error('Unknown trusted profile');
  const raw = await readFile(path.join(agentRoot, `templates/${name}-profile.json`));
  return { hash: sha256(raw), data: JSON.parse(raw.toString()) as { id: string; goal: string; cases: { id: string; name: string; description: string; steps: unknown[] }[] } };
}
/** Host data profile, not a natural-language classifier and not execution evidence. */
export async function profileProposal(request: PrepareDeliveryPlanRequestDto, profileId: string) {
  const profile = await profileData(profileId);
  if (request.planningMode === 'host_profile' && request.profileHint?.hash !== profile.hash) throw new Error('Trusted profile fingerprint mismatch');
  const spec = AcceptanceSpec.parse(seal({ protocolVersion: '0.1.0' as const, id: `spec_${request.runId}`, hash: '0'.repeat(64), revision: 1,
    projectId: request.projectId, runId: request.runId, seed: { id: request.seed.id, hash: request.seed.hash }, originalGoal: request.seed.goal,
    origin: request.planningMode,
    criteria: request.seed.items.map((item) => ({ id: item.id, description: item.text, required: item.required, seedItemIds: [item.id] })), createdAt: new Date().toISOString() }));
  const goalIds = request.seed.items.filter((item) => item.kind === 'goal').map((item) => item.id);
  const cases = profile.data.cases.map((entry) => ({ id: entry.id, name: entry.name,
    criterionIds: [...goalIds, ...request.seed.items.filter((item) => item.kind !== 'goal' && item.text === entry.description).map((item) => item.id)], steps: entry.steps }));
  const plan = BrowserTestPlan.parse(seal(BrowserTestPlan.parse({ protocolVersion: '0.1.0', dslVersion: 'browser-dsl-v1', id: `plan_${request.runId}`,
    hash: '0'.repeat(64), revision: 1, spec: { id: spec.id, hash: spec.hash }, cases,
    coverage: spec.criteria.map((criterion) => {
      const mapped = cases.filter((entry) => entry.criterionIds.includes(criterion.id)).map((entry) => entry.id);
      return mapped.length ? { criterionId: criterion.id, method: 'automated', caseIds: mapped, reason: null }
        : { criterionId: criterion.id, method: 'unsupported', caseIds: [], reason: 'The explicit host profile has no verified mapping for this declared criterion.' };
    }), browserBudgetMs: 90000, createdAt: new Date().toISOString() })));
  return { spec, plan };
}
