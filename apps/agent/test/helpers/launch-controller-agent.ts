/** Zero-Provider orchestration asset. No dotenv, user data option, or production debug route. */
import { mkdtemp, writeFile, chmod, readFile, realpath, stat, lstat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createAgentServer } from '../../src/runtime.js';
import { ControllerFixtureAdapter, ControllerFixturePlanner } from './controller-fixture.js';
if (process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY_FILE)
    throw new Error('Synthetic controller fixture refuses provider credentials; unset credential variables');
const args = process.argv.slice(2);
let port = 15410, api = 'http://127.0.0.1:15401', scenario: 'clean_repair' | 'no_change' = 'clean_repair';
let infra = false;
let resume: string | null = null;
let overridden = false;
for (let i = 0; i < args.length; i++) {
    const k = args[i];
    if (k === '--resume-fixture') {
        resume = args[++i];
    }
    else if (k === '--port') {
        overridden = true;
        port = Number(args[++i]);
        if (!Number.isInteger(port) || port < 1024 || port > 65535)
            throw new Error('Invalid independent port');
    }
    else if (k === '--api-internal-url') {
        overridden = true;
        api = args[++i];
        const u = new URL(api);
        if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(u.hostname) || u.username || u.password || u.pathname !== '/')
            throw new Error('API must be a separate loopback test service');
    }
    else if (k === '--scenario') {
        overridden = true;
        const value = args[++i];
        if (value !== 'clean_repair' && value !== 'no_change')
            throw new Error('Unknown synthetic scenario');
        scenario = value;
    }
    else if (k === '--infra-failure') {
        overridden = true;
        infra = true;
    }
    else
        throw new Error('Unknown fixture option; no user data/key/mode path accepted');
}
let root: string, token: string;
let tokenFile: string;
if (resume) {
    if (overridden)
        throw new Error('Resume uses the exact saved synthetic fixture configuration');
    const parent = await realpath(os.tmpdir());
    root = await realpath(resume);
    if (path.dirname(root) !== parent || !path.basename(root).startsWith('atoms-controller-http-') || (await lstat(resume)).isSymbolicLink())
        throw new Error('Only this launcher own fresh temp fixture may be resumed');
    const owner = await stat(root);
    if (owner.uid !== process.getuid?.() || (owner.mode & 0o077) !== 0)
        throw new Error('Fixture owner/mode mismatch');
    const receipt = JSON.parse(await readFile(path.join(root, 'fixture-identity.json'), 'utf8'));
    if (receipt.kind !== 'atoms-controller-http-v1' || receipt.dataDir !== path.join(root, 'agent-data'))
        throw new Error('Not a synthetic controller fixture');
    ({ port, api, scenario, infra } = receipt);
    tokenFile = path.join(root, 'service-token');
    const credential = await lstat(tokenFile);
    if (credential.isSymbolicLink() || credential.uid !== owner.uid || (credential.mode & 0o777) !== 0o600)
        throw new Error('Synthetic token owner/mode mismatch');
    token = await readFile(tokenFile, 'utf8');
    if (!/^synthetic_controller_[a-f0-9-]+$/.test(token))
        throw new Error('Refusing nonsynthetic credential');
}
else {
    root = await mkdtemp(path.join(os.tmpdir(), 'atoms-controller-http-'));
    await chmod(root, 0o700);
    token = 'synthetic_controller_' + randomUUID();
    tokenFile = path.join(root, 'service-token');
    await writeFile(tokenFile, token, { mode: 0o600, flag: 'wx' });
    await writeFile(path.join(root, 'fixture-identity.json'), JSON.stringify({ kind: 'atoms-controller-http-v1', port, api, scenario, infra, dataDir: path.join(root, 'agent-data') }), { mode: 0o600, flag: 'wx' });
}
if (infra)
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = path.join(root, 'nonexistent-controlled-browser');
const adapter = new ControllerFixtureAdapter(scenario);
const app = createAgentServer({ dataDir: path.join(root, 'agent-data'), mode: 'fake', coordinationMode: 'fake', serviceToken: token, apiInternalUrl: api, adapter, planningAdapter: new ControllerFixturePlanner(), trustedCleanBrowserLocale: 'fr-FR' });
const address = await app.listen(port, '127.0.0.1');
console.log(JSON.stringify({ ready: true, address, apiInternalUrl: api, fixtureRoot: root, dataDir: path.join(root, 'agent-data'), serviceTokenFile: tokenFile, mode: 'synthetic_fake_controller_locale', scenario, infraFailure: infra, providerRequests: 0, contractGoal: 'Render decimal 1.5 with fixed en-US convention regardless of browser language. Use model_proposed planning.' }));
let stopping = false;
const stop = async () => { if (stopping)
    return; stopping = true; await app.close(); console.log(JSON.stringify({ stopped: true, fixtureRoot: root, workerCalls: adapter.calls, providerRequests: 0 })); };
process.on('SIGINT', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); });
