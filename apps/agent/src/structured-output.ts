export interface ModelResult { text: string; finishReason: string | null }
export class StructuredOutputError extends Error {
  readonly reason: 'output_limit' | 'empty_response' | 'invalid_json';
  readonly jsonErrorClass: 'SyntaxError' | null;
  readonly jsonErrorPosition: number | null;
  readonly jsonErrorCategory: 'array_delimiter' | 'object_delimiter' | 'invalid_property' | 'invalid_json' | null;
  constructor(readonly role: string, readonly responseLength: number, readonly finishReason: string | null, cause?: unknown) {
    super(`DSH ${role} returned invalid structured JSON (responseLength=${responseLength}, finishReason=${finishReason ?? 'null'})`);
    this.jsonErrorClass = cause instanceof SyntaxError ? 'SyntaxError' : null;
    const message = cause instanceof SyntaxError ? cause.message : '';
    const position = message.match(/position (\d+)/)?.[1]; this.jsonErrorPosition = position ? Number(position) : null;
    this.jsonErrorCategory = !cause ? null : message.startsWith("Expected ',' or ']'") ? 'array_delimiter' : message.startsWith("Expected ',' or '}'") ? 'object_delimiter' : message.startsWith('Expected property name') ? 'invalid_property' : 'invalid_json';
    this.reason = ['max_tokens', 'length', 'max-tokens'].includes(finishReason || '') ? 'output_limit'
      : responseLength === 0 ? 'empty_response' : 'invalid_json';
  }
}
export function parseModelJson(result: ModelResult, role: string): unknown {
  const clean = result.text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  if (!clean || ['max_tokens', 'length', 'max-tokens'].includes(result.finishReason || '')) {
    throw new StructuredOutputError(role, result.text.length, result.finishReason);
  }
  try { return JSON.parse(clean); }
  catch (error) { throw new StructuredOutputError(role, result.text.length, result.finishReason, error); }
}
export async function requestStructuredJson(role: string,
  request: (retry: boolean) => Promise<ModelResult>,
  reportRetry: (error: StructuredOutputError) => unknown,
) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await request(attempt === 1);
    try { return parseModelJson(result, role); }
    catch (error) {
      if (!(error instanceof StructuredOutputError) || attempt === 1) throw error;
      await reportRetry(error);
    }
  }
  throw new Error('Unreachable structured output state');
}
