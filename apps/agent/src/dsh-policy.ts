import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
export function verifyDshToolPolicy(home: string, patch: string, options: { requireThinkingOff?: boolean } = {}) {
  const sdkRequire = createRequire(require.resolve('@deepseek-ai/dsh-sdk-client'));
  const manifestPath = sdkRequire.resolve('@deepseek-ai/dsh/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version: string };
  if (manifest.version !== '0.2.2-rc.1') throw new Error('Unverified DSH runtime version; refusing execution');
  const result = spawnSync(process.execPath, [path.join(path.dirname(manifestPath), 'lib/bin.js'),
    '--profile', 'sdk-minimal', '--patch', patch, '--dump-config'], {
    env: { PATH: process.env.PATH, HOME: home, DSH_HOME: home }, encoding: 'utf8', timeout: 15000,
  });
  if (result.status !== 0 || result.error) throw new Error('DSH tool policy composition failed; refusing execution');
  const blocks = result.stdout.split(/(?=^- id: )/m);
  const modelTools = blocks.filter((block) => /name: ['"]?@deepseek-ai\/dsh-tool-/.test(block)
    && !/name: ['"]?@deepseek-ai\/dsh-tool-executor-native['"]?\s/.test(block));
  const ids = modelTools.map((block) => block.match(/^- id: (.+)$/m)?.[1]);
  const expected = ['tool-fs', 'tool-working-directory', 'persistent-bash', 'persistent-pwsh'];
  if (ids.length !== expected.length || expected.some((id) => !ids.includes(id))
    || modelTools.some((block) => !/^  disabled: true\s*$/m.test(block))) {
    throw new Error('DSH exposes an unapproved model tool; refusing execution');
  }
  if (options.requireThinkingOff) {
    const provider = blocks.find((block) => /^- id: llm-deepseek\n/.test(block));
    if (!provider || !/name: ['"]?@deepseek-ai\/dsh-llm-deepseek-api-key/.test(provider) || !/^    thinking: disabled\s*$/m.test(provider) || !/^    reasoningEffort: ['"]?off['"]?\s*$/m.test(provider)) throw new Error('Planning provider did not compose thinking disabled/off; refusing execution');
  }
  return { runtimeVersion: manifest.version, disabledModelTools: ids, ...(options.requireThinkingOff ? { thinking: 'disabled' as const, reasoningEffort: 'off' as const } : {}), verified: true as const };
}
