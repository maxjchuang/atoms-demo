/** Synthetic projection/quality data; no model/browser/build execution evidence. */
import { seed as baseSeed, binding as baseBinding, makeReport } from './delivery-fixtures.js';
import { RequirementSeed, AcceptanceSpec, BrowserTestPlan, FrozenDeliveryBinding, FrozenDeliveryBundle } from './delivery.js';
import { projectCanonicalSeedCoverage } from './delivery-projection.js';
export const projectionSeed = RequirementSeed.parse({ ...baseSeed, id: 'seed_projection',
  items: [baseSeed.items[0], { ...baseSeed.items[1], required: false, optionalEvidence: [{ messageId: baseSeed.source.messageIds[0], quote: 'Trusted optional fixture source' }] }, baseSeed.items[2]] });
const [goal, optional, required] = projectionSeed.items;
export const projectionSpec = AcceptanceSpec.parse({ protocolVersion: '0.1.0', id: 'spec_projection', hash: 'b'.repeat(64), revision: 1,
  projectId: projectionSeed.projectId, runId: projectionSeed.runId, seed: { id: projectionSeed.id, hash: projectionSeed.hash }, originalGoal: projectionSeed.goal,
  origin: 'model_proposed', createdAt: baseSeed.createdAt,
  criteria: [...projectionSeed.items.map(item => ({ id: item.id, description: item.text, required: item.required, seedItemIds: [item.id] })),
    { id: 'criterion_leaf_auto', description: 'Automatic derived check citing two sources', required: true, seedItemIds: [goal.id, optional.id] },
    { id: 'criterion_leaf_required', description: 'Second automatic required check', required: true, seedItemIds: [goal.id, required.id] },
    { id: 'criterion_leaf_manual', description: 'Required human verification subitem', required: true, seedItemIds: [goal.id, optional.id] },
    { id: 'criterion_leaf_unsupported', description: 'Unsupported required derived subitem', required: true, seedItemIds: [goal.id] },
    { id: 'criterion_leaf_optional', description: 'Optional human verification subitem', required: false, seedItemIds: [optional.id] }] });
export const projectionLeafPlan = BrowserTestPlan.parse({ protocolVersion: '0.1.0', dslVersion: 'browser-dsl-v1', id: 'plan_projection', hash: 'c'.repeat(64), revision: 1,
  spec: { id: projectionSpec.id, hash: projectionSpec.hash }, createdAt: baseSeed.createdAt, browserBudgetMs: 90000,
  cases: [
    { id: 'case_auto', name: 'Synthetic automatic case', criterionIds: ['criterion_leaf_auto'], steps: [{ id: 'step_auto', op: 'open_current_app', timeoutMs: 5000 }] },
    { id: 'case_required', name: 'Synthetic required case', criterionIds: ['criterion_leaf_required'], steps: [{ id: 'step_required', op: 'open_current_app', timeoutMs: 5000 }] }],
  coverage: [
    { criterionId: 'criterion_leaf_auto', method: 'automated', caseIds: ['case_auto'], reason: null },
    { criterionId: 'criterion_leaf_required', method: 'automated', caseIds: ['case_required'], reason: null },
    { criterionId: 'criterion_leaf_manual', method: 'manual', caseIds: [], reason: 'Human must review this concrete required subitem.' },
    { criterionId: 'criterion_leaf_unsupported', method: 'unsupported', caseIds: [], reason: 'The current controlled DSL cannot verify this subitem.' },
    { criterionId: 'criterion_leaf_optional', method: 'manual', caseIds: [], reason: 'Optional source asks for human review.' }] });
export const projectionPlan = BrowserTestPlan.parse({ ...projectionLeafPlan, ...projectCanonicalSeedCoverage(projectionSeed, projectionSpec, projectionLeafPlan) });
export const projectionBinding = FrozenDeliveryBinding.parse({ ...baseBinding, seed: { id: projectionSeed.id, hash: projectionSeed.hash },
  spec: { id: projectionSpec.id, hash: projectionSpec.hash }, plan: { id: projectionPlan.id, hash: projectionPlan.hash }, planningMode: 'model_proposed' });
export const projectionBundle = FrozenDeliveryBundle.parse({ seed: projectionSeed, spec: projectionSpec, plan: projectionPlan, binding: projectionBinding });
export const projectionPartialReport = makeReport(projectionBundle);
