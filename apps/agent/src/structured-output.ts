export interface ModelResult { text: string; finishReason: string | null }
export class StructuredOutputError extends Error {
  constructor(readonly role: string, readonly responseLength: number, readonly finishReason: string | null) {
    super(`DSH ${role} returned invalid structured JSON (responseLength=${responseLength}, finishReason=${finishReason ?? 'null'})`);
  }
}
export function parseModelJson(result: ModelResult, role: string): unknown {
  const clean = result.text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  if (!clean || ['max_tokens', 'length', 'max-tokens'].includes(result.finishReason || '')) {
    throw new StructuredOutputError(role, result.text.length, result.finishReason);
  }
  try { return JSON.parse(clean); }
  catch { throw new StructuredOutputError(role, result.text.length, result.finishReason); }
}
export async function requestStructuredJson(role: string,
  request: (retry: boolean) => Promise<ModelResult>,
  reportRetry: () => void,
) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await request(attempt === 1);
    try { return parseModelJson(result, role); }
    catch (error) {
      if (!(error instanceof StructuredOutputError) || attempt === 1) throw error;
      reportRetry();
    }
  }
  throw new Error('Unreachable structured output state');
}
