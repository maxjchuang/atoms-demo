/** Token fields as reported by the pinned DSH SDK, never inferred from text. */
export const TOKEN_ACCOUNTING_VERSION = 'effective-input-v1' as const;
export interface NativeTokenUsage {
  inputTokens?: number; outputTokens?: number; cacheReadTokens?: number;
  cacheWriteTokens?: number; totalTokens?: number;
}
export class UsageAccountingError extends Error { }
export type NormalizedUsage = {
  inputTokens?: number; outputTokens?: number;
  mode: 'disjoint' | 'cache_already_in_input' | 'derived_from_total' | 'conservative' | 'input_output_only';
  reported: NativeTokenUsage;
};
export function normalizeNativeUsage(raw: NativeTokenUsage): NormalizedUsage {
  const reported: NativeTokenUsage = {};
  for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'totalTokens'] as const) {
    const amount = raw[key];
    if (amount === undefined) continue;
    if (!Number.isSafeInteger(amount) || amount < 0) throw new UsageAccountingError('Model usage contains an invalid numeric token field');
    reported[key] = amount;
  }
  const { inputTokens: input, outputTokens: output, cacheReadTokens: read, cacheWriteTokens: write, totalTokens: total } = reported;
  const caches = (read ?? 0) + (write ?? 0);
  const hasInput = input !== undefined || read !== undefined || write !== undefined;
  const disjointInput = (input ?? 0) + caches;
  if (total !== undefined && output !== undefined) {
    if (total === disjointInput + output && hasInput) return { inputTokens: disjointInput, outputTokens: output, mode: 'disjoint', reported };
    if (input !== undefined && input >= caches && total === input + output) {
      return { inputTokens: input, outputTokens: output, mode: caches > 0 ? 'cache_already_in_input' : 'input_output_only', reported };
    }
    if (input === undefined && total >= output && total - output >= caches) {
      return { inputTokens: total - output, outputTokens: output, mode: 'derived_from_total', reported };
    }
    // Contradictory or incomplete provider fields: use the larger reported bound.
    return { inputTokens: Math.max(disjointInput, total - output, 0), outputTokens: output, mode: 'conservative', reported };
  }
  if (total !== undefined) {
    // Output is unknown. Count total against both independent budgets rather than
    // allowing an unknown component to create unbounded additional requests.
    return { inputTokens: Math.max(disjointInput, total), outputTokens: total, mode: 'conservative', reported };
  }
  return { ...(hasInput ? { inputTokens: disjointInput } : {}), ...(output === undefined ? {} : { outputTokens: output }),
    mode: read !== undefined || write !== undefined ? 'conservative' : 'input_output_only', reported };
}

export function nativeEventIdentity(sessionId: unknown, event: { seq?: unknown; data?: { turn?: unknown; step?: unknown } }) {
  const session = typeof sessionId === 'string' ? sessionId : 'root';
  if (Number.isSafeInteger(event.seq)) return `${session}:seq:${event.seq}`;
  if (typeof event.data?.turn === 'number' && Number.isSafeInteger(event.data.turn)
    && typeof event.data.step === 'number' && Number.isSafeInteger(event.data.step)) return `${session}:turn:${event.data.turn}:step:${event.data.step}`;
  return undefined;
}

/** Only settled assistant/message usage is added; result summaries are not added again. */
export class NativeUsageAccounting {
  private usageEvents = new Set<string>();
  private stepEvents = new Set<string>();
  private modes = new Set<string>();
  private samples = 0;
  private missingIdentity = 0;
  private unknownInput = 0;
  private unknownOutput = 0;
  private totals = { effectiveInputTokens: 0, outputTokens: 0, reportedInputTokens: 0,
    cacheReadTokens: 0, cacheWriteTokens: 0, reportedTotalTokens: 0 };
  step(identity: string | undefined) {
    if (identity && this.stepEvents.has(identity)) return false;
    if (identity) this.stepEvents.add(identity);
    return true;
  }
  add(identity: string | undefined, raw: NativeTokenUsage) {
    if (identity && this.usageEvents.has(identity)) return null;
    const value = normalizeNativeUsage(raw);
    if (identity) this.usageEvents.add(identity); else this.missingIdentity++;
    this.samples++; this.modes.add(value.mode);
    if (value.inputTokens === undefined) this.unknownInput++; else this.totals.effectiveInputTokens += value.inputTokens;
    if (value.outputTokens === undefined) this.unknownOutput++; else this.totals.outputTokens += value.outputTokens;
    this.totals.reportedInputTokens += value.reported.inputTokens ?? 0;
    this.totals.cacheReadTokens += value.reported.cacheReadTokens ?? 0;
    this.totals.cacheWriteTokens += value.reported.cacheWriteTokens ?? 0;
    this.totals.reportedTotalTokens += value.reported.totalTokens ?? 0;
    return value;
  }
  assertObservable() {
    if (this.samples === 0 || this.unknownInput || this.unknownOutput) {
      throw new UsageAccountingError('Model token usage is not observable; no further inference or delivery is allowed');
    }
  }
  metadata() {
    return { accountingVersion: TOKEN_ACCOUNTING_VERSION, samples: this.samples, modes: [...this.modes], missingEventIdentity: this.missingIdentity,
      unknownInputSamples: this.unknownInput, unknownOutputSamples: this.unknownOutput, ...this.totals };
  }
}

/** Per native request: a settled first step is not proof that a later interrupted step was free. */
export class NativeRequestAccounting extends NativeUsageAccounting {
  private entered = false;
  private complete = false;
  private observedSteps = 0;
  begin() { this.entered = true; }
  override step(identity: string | undefined) { const fresh = super.step(identity); if (fresh) this.observedSteps++; return fresh; }
  override assertObservable() {
    super.assertObservable();
    if (this.metadata().samples < this.observedSteps) throw new UsageAccountingError('A model step has no settled usage');
    this.complete = true;
  }
  isUnknown() { return this.entered && !this.complete; }
  override metadata() { return { ...super.metadata(), requestEntered: this.entered, requestSettled: this.complete, observedSteps: this.observedSteps }; }
}
