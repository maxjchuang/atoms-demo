/** Conservative admission from observed settled tokens/time, never a character/token estimate. */
export function structuredRetryAdmission(input: { usageKnown: boolean; remainingMs: number; remainingOutputTokens: number;
  remainingModelSteps: number; previousMs: number; previousOutputTokens: number }) {
  if (!input.usageKnown) return { allowed: false, reason: 'usage_unknown' as const };
  if (input.remainingModelSteps <= 0) return { allowed: false, reason: 'model_steps_exhausted' as const };
  if (input.remainingMs <= 0 || input.remainingMs < input.previousMs) return { allowed: false, reason: 'insufficient_observed_time' as const };
  if (input.remainingOutputTokens <= 0 || input.remainingOutputTokens < input.previousOutputTokens) return { allowed: false, reason: 'insufficient_settled_output' as const };
  return { allowed: true, reason: null };
}
