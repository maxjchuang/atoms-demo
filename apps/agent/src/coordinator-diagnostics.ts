import { mkdir, writeFile, appendFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonicalDeliveryJson } from '@atoms/contracts/delivery';
import { sha256 } from './files.js';
/** Only final user-facing semantic JSON is projected; never SDK messages or reasoning. */
const fields = new Set(['kind', 'answer', 'summary', 'goal', 'acceptance', 'description', 'origin', 'basePolicy', 'baseVersion', 'evidence', 'message', 'quote', 'references', 'ref', 'path', 'memoryUpdates', 'supersedes', 'scope', 'implementation', 'included', 'exclusions', 'reason', 'coverage', 'acceptanceIndex', 'requirements', 'question', 'options', 'label', 'allowText', 'relatedProposal', 'targetRun', 'targetRuns', 'paths', 'scopeClarification', 'detail']);
export function sanitizeRouterProposal(raw: unknown): unknown {
    const walk = (v: unknown, depth: number): unknown => depth > 12 ? '[depth limit]' : typeof v === 'string' ? v.slice(0, 20000) : v === null || typeof v === 'number' || typeof v === 'boolean' ? v : Array.isArray(v) ? v.slice(0, 50).map(x => walk(x, depth + 1)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => fields.has(k)).map(([k, x]) => [k, walk(x, depth + 1)])) : '[invalid type]';
    return walk(raw, 0);
}
export async function saveRouterProposal(home: string, turnId: string, raw: unknown, maxCalls: number) {
    const dir = path.join(home, 'router-proposals', sha256(turnId));
    await mkdir(dir, { recursive: true, mode: 0o700 });
    if ((await readdir(dir)).filter(n => n.endsWith('.json')).length >= maxCalls)
        throw new Error('Router proposal receipt limit exceeded');
    const proposal = sanitizeRouterProposal(raw);
    const payload = { version: 1, turnId, proposal };
    const body = canonicalDeliveryJson(payload);
    const kept = Buffer.byteLength(body) <= 130000 ? payload : { version: 1, turnId, omitted: true, reason: 'sanitized_proposal_size_limit', proposalHash: sha256(canonicalDeliveryJson(proposal)), bytes: Buffer.byteLength(body) };
    const encoded = canonicalDeliveryJson(kept);
    await writeFile(path.join(dir, randomUUID() + '.json'), canonicalDeliveryJson({ hash: sha256(encoded), bytes: Buffer.byteLength(encoded), payload: kept }), { flag: 'wx', mode: 0o600 });
}
const issueFields = new Set([...fields, 'newEntry', 'interpretation', 'requirementsUsed', 'purposeUsed', 'delivery', 'coordination', 'result', 'status', 'basis', 'snapshot', 'source', 'text', 'id', 'entryIds', 'includedEntryIds', 'criterionId', 'sourceMessageId']);
export function routerExceptionDiagnostic(turnId: string, stage: string, error: unknown) {
    const e = error as {
        issues?: {
            code?: unknown;
            path?: unknown[];
        }[];
        constructor?: {
            name?: string;
        };
    };
    const errorClass = ['ZodError', 'CoordinationError', 'StructuredOutputError', 'TypeError', 'SyntaxError', 'Error'].includes(e?.constructor?.name || '') ? e.constructor!.name : 'UnknownError';
    const issues = Array.isArray(e?.issues) ? e.issues.slice(0, 20).map(i => ({ code: ['custom', 'invalid_type', 'invalid_enum_value', 'unrecognized_keys', 'invalid_union', 'invalid_union_discriminator', 'too_small', 'too_big', 'invalid_string'].includes(String(i.code)) ? i.code : 'schema_issue', path: Array.isArray(i.path) ? i.path.slice(0, 12).map(p => typeof p === 'number' && Number.isSafeInteger(p) ? p : typeof p === 'string' && issueFields.has(p) ? p : '<field>') : [] })) : [];
    return { time: new Date().toISOString(), turnId, stage, errorClass, issueCount: Array.isArray(e?.issues) ? e.issues.length : 0, issues };
}
export async function recordRouterFailure(home: string, turnId: string, stage: string, error: unknown) { await appendFile(path.join(home, 'coordination-errors.jsonl'), JSON.stringify(routerExceptionDiagnostic(turnId, stage, error)) + '\n', { mode: 0o600 }); }
