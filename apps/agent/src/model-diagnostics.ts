import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { StructuredOutputError } from './structured-output.js';
export type ModelDiagnostic = {
  stage: 'request_started' | 'response_received' | 'structured_rejected' | 'request_failed' | 'retry_skipped';
  role: 'router' | 'worker' | 'delivery-planning'; id: string;
  finishReason?: string | null; textLength?: number | null;
  errorClass?: 'SyntaxError' | 'SchemaError' | 'UsageAccountingError' | 'RequestError' | null;
  errorCategory?: string | null; errorPosition?: number | null;
  remaining?: { activeMs: number; outputTokens: number }; interruption?: 'budget' | 'cancelled' | 'sdk_or_transport' | null;
  usageKnown?: boolean;
};
/** Deliberately no prompt/source/error.message/raw event fields. */
export async function writeModelDiagnostic(directory: string, event: ModelDiagnostic) {
  await mkdir(directory, { recursive: true });
  await appendFile(path.join(directory, 'model-diagnostics.jsonl'), JSON.stringify({ time: new Date().toISOString(), ...event }) + '\n');
}
export const structuredDiagnostic = (error: StructuredOutputError) => ({ finishReason: error.finishReason, textLength: error.responseLength,
  errorClass: error.jsonErrorClass, errorCategory: error.reason === 'invalid_json' ? error.jsonErrorCategory : error.reason,
  errorPosition: error.jsonErrorPosition });
