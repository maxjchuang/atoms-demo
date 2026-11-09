import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { sha256 } from './files.js';
const exec = promisify(execFile);
export type AuditProcess = {
    pid: number;
    ppid: number;
    uid: number;
    state: string;
    argv: string;
    cwd: string | null;
    executable?: string;
};
export function assessOwnedProcesses(rows: AuditProcess[], o: {
    uid: number;
    sdkBin: string;
    workspace: string;
    home: string;
}) {
    const inside = (p: string, root: string) => p === root || p.startsWith(root + path.sep);
    const candidates = new Set<number>();
    const sdkLike = (argv: string) => argv.includes(o.sdkBin) || /node_modules\/@deepseek-ai\/dsh\/lib\/bin\.js(?:\s|$)/.test(argv) || argv.includes('--profile sdk-minimal');
    for (const p of rows) {
        if (p.uid !== o.uid)
            continue;
        if (p.state.startsWith('Z'))
            continue;
        if (!p.cwd)
            return { confirmed: false, reason: 'PROCESS_IDENTITY_UNVERIFIED' };
        if (sdkLike(p.argv) && !inside(p.cwd, o.workspace) && !inside(p.cwd, o.home) && !p.argv.includes(o.home) && !p.argv.includes(o.workspace))
            return { confirmed: false, reason: 'SDK_PROCESS_OWNERSHIP_AMBIGUOUS' };
        if (inside(p.cwd, o.workspace) || inside(p.cwd, o.home) || sdkLike(p.argv) && p.argv.includes(o.home) || sdkLike(p.argv) && p.argv.includes(o.workspace))
            candidates.add(p.pid);
    }
    let changed = true;
    while (changed) {
        changed = false;
        for (const p of rows)
            if (candidates.has(p.ppid) && !candidates.has(p.pid)) {
                candidates.add(p.pid);
                changed = true;
            }
    }
    return candidates.size ? { confirmed: false, reason: 'RELATED_PROCESS_REMAINS' } : { confirmed: true, reason: null };
}
/** No environment/transcript access and no signals. Ambiguous/incomplete enumeration is never stop proof. */
export async function auditHostStop(o: {
    workspace: string;
    home: string;
}) {
    if (process.platform !== 'darwin' && process.platform !== 'linux')
        return { confirmed: false, reason: 'AUDIT_PLATFORM_UNSUPPORTED' };
    const uid = process.getuid?.();
    if (uid === undefined)
        return { confirmed: false, reason: 'AUDIT_UID_UNAVAILABLE' };
    try {
        const require = createRequire(import.meta.url), r = createRequire(require.resolve('@deepseek-ai/dsh-sdk-client')), manifest = r.resolve('@deepseek-ai/dsh/package.json');
        if (JSON.parse(await readFile(manifest, 'utf8')).version !== '0.2.2-rc.1')
            throw new Error('Unverified SDK');
        const sdkBin = await realpath(path.join(path.dirname(manifest), 'lib/bin.js'));
        const node = await realpath(process.execPath);
        const patch = await readFile(path.join(o.home, 'atoms-no-tools.yml'), 'utf8');
        if (Buffer.byteLength(patch) > 4096 || !['tool-fs', 'tool-working-directory', 'persistent-bash', 'persistent-pwsh'].every(id => patch.includes('- id: ' + id + '\n  disabled: true')))
            throw new Error('Patch ownership/policy unverified');
        const env = { PATH: process.env.PATH, LC_ALL: 'C' };
        const sample = async () => { const ps = await exec('ps', ['-axo', 'uid=,pid=,ppid=,stat=,args='], { env, timeout: 5000, maxBuffer: 2097152 }); return ps.stdout.split('\n').filter(Boolean).map(l => l.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/)).filter((m): m is RegExpMatchArray => !!m).map(m => ({ uid: Number(m[1]), pid: Number(m[2]), ppid: Number(m[3]), state: m[4], argv: m[5], cwd: null as string | null })).filter(p => p.uid === uid && !(p.ppid === process.pid && /^ps(?: |$)/.test(p.argv))); };
        const before = await sample();
        if (before.length > 2048)
            throw new Error('Process enumeration limit');
        const cwds = new Map<number, string>();
        if (process.platform === 'darwin') {
            const result = await exec('lsof', ['-nP', '-a', '-u', String(uid), '-d', 'cwd', '-Fn'], { env, timeout: 8000, maxBuffer: 2097152 });
            let pid = 0;
            for (const line of result.stdout.split('\n')) {
                if (/^p\d+$/.test(line))
                    pid = Number(line.slice(1));
                else if (line.startsWith('n/') && pid)
                    cwds.set(pid, line.slice(1));
            }
        }
        else
            for (const p of before) {
                try {
                    cwds.set(p.pid, await realpath('/proc/' + p.pid + '/cwd'));
                }
                catch { }
            }
        const after = await sample(), stable = new Set(after.map(p => p.pid));
        const rows = before.filter(p => stable.has(p.pid)).map(p => ({ ...p, cwd: cwds.get(p.pid) || null }));
        if (after.some(p => !before.some(b => b.pid === p.pid)))
            return { confirmed: false, reason: 'PROCESS_TABLE_CHANGED' };
        const owned = { workspace: await realpath(o.workspace), home: await realpath(o.home) };
        const result = assessOwnedProcesses(rows, { ...owned, uid, sdkBin });
        return { ...result, evidenceHash: sha256(JSON.stringify({ uid, nodeHash: sha256(await readFile(node)), sdkBinHash: sha256(await readFile(sdkBin)), processes: rows.map(p => ({ pid: p.pid, ppid: p.ppid, state: p.state, cwdKnown: !!p.cwd })), result })), checkedProcesses: rows.length };
    }
    catch {
        return { confirmed: false, reason: 'PROCESS_AUDIT_UNAVAILABLE' };
    }
}
