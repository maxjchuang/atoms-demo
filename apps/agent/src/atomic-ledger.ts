import { openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export class AtomicLedgerCommitError extends Error {
    readonly committed = true;
    constructor() { super('Ledger replaced but directory durability confirmation failed; stop effects'); }
}
/** One durable atomic replacement contains native counters, event sequence and controller journal. */
export function atomicLedger(file: string, value: unknown) { const temp = file + '.' + randomUUID() + '.tmp'; let fd: number | undefined; let committed = false; try {
    fd = openSync(temp, 'wx', 0o600);
    writeFileSync(fd, JSON.stringify(value));
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temp, file);
    committed = true;
    const dir = openSync(path.dirname(file), 'r');
    try {
        fsyncSync(dir);
    }
    catch (e) {
        if (!['EINVAL', 'ENOTSUP'].includes((e as NodeJS.ErrnoException).code || ''))
            throw e;
    }
    finally {
        closeSync(dir);
    }
}
catch (error) {
    if (fd !== undefined)
        closeSync(fd);
    try {
        unlinkSync(temp);
    }
    catch { }
    if (committed)
        throw new AtomicLedgerCommitError();
    throw error;
} }
