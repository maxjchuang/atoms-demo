/** Trusted test-only constructor APIs. Never accepted from HTTP/model/environment. */
import type { BrowserTestPlanDto } from '@atoms/contracts/delivery';
import type { AdapterContext, ModelAdapter, PlanValue, GenerationResult } from './adapters.js';
export type TrustedSourceFault = (context: { workspace: string; plan: BrowserTestPlanDto; signal: AbortSignal; baselineEvidenceDir: string; report: (text: string) => void }) => Promise<{
  edits: { path: string; expectedBeforeSha256: string | null; after: string }[]; explanation: string; origin: { kind: 'real_verified_source' | 'fake_fixture'; versionId: string; executionId: string; reportHash: string; originalPlanHash: string; sourceHash: string };
}>;
/** Initial source import is host work, not a model response or provider step. Repair delegates unchanged. */
export class SourceBaselineAdapter implements ModelAdapter {
  readonly mode: ModelAdapter['mode']; private first = true;
  constructor(private delegate: ModelAdapter) { this.mode = delegate.mode; }
  ready() { return this.delegate.ready(); }
  async plan(_context: AdapterContext): Promise<PlanValue> { throw new Error('Controlled source replay requires an already frozen delivery plan'); }
  async generate(context: AdapterContext, plan: PlanValue, errors?: string): Promise<GenerationResult> {
    if (context.request.input.kind !== 'version' || !context.frozenTestPlan) throw new Error('Source baseline must use a verified version input and frozen plan');
    if (this.first && !errors) { this.first = false; context.report('可信测试仅载入已校验源码副本：初始阶段未请求模型、未记 provider step；接下来执行受控回归验证。'); return 'Verified source baseline import; no new model generation occurred.'; }
    this.first = false; return this.delegate.generate(context, plan, errors ? errors + '\nTrusted controlled validation: current sources include an explicitly marked storage fault module. Repair/remove its behavior and marker in source, including any import side effect. Host does not remove it. Do not edit the frozen tests/required/plan.' : errors);
  }
  close(id: string) { return this.delegate.close(id); }
}
export const STORAGE_FAULT_MARKER = 'ATOMS_TRUSTED_CONTROLLED_STORAGE_FAULT';
/** Clear removable fault across React implementation shapes; no test/expectation/plan modification. */
export const STORAGE_FAULT_FILE = 'src/atoms-controlled-fault.ts';
export const STORAGE_FAULT_IMPORT = "import './atoms-controlled-fault';\n";
export const STORAGE_FAULT_PREFIX = `/* ${STORAGE_FAULT_MARKER}: trusted validation fault. Repair source; never edit frozen tests. */
const __atomsOriginalStorage = window.localStorage;
const __atomsFaultStorage = new Proxy(__atomsOriginalStorage, {
  get(target, property) {
    if (property === 'setItem' || property === 'removeItem' || property === 'clear') return () => {};
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
  set() { return true; }, defineProperty() { return true; }, deleteProperty() { return true; }
});
Object.defineProperty(window, 'localStorage', { configurable: true, value: __atomsFaultStorage });
export {};
/* END_${STORAGE_FAULT_MARKER} */
`;
