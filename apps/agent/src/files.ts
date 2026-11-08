import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RelativePath } from '@atoms/contracts';

export const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export async function safeFile(root: string, name: string) {
  RelativePath.parse(name);
  const resolvedRoot = await realpath(root);
  const target = path.resolve(resolvedRoot, name);
  if (!target.startsWith(resolvedRoot + path.sep)) throw new Error('Path outside workspace');
  let current = resolvedRoot;
  for (const segment of name.split('/')) {
    current = path.join(current, segment);
    const stat = await lstat(current).catch(() => null);
    if (stat?.isSymbolicLink()) throw new Error('Symbolic links are forbidden');
  }
  return target;
}
export async function putFile(root: string, name: string, text: string | Uint8Array) {
  const target = await safeFile(root, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, text);
}
export async function listFiles(root: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    if (['node_modules', '.git', '.dsh', '.env'].includes(entry.name)) continue;
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error('Artifact contains symlink');
    if (entry.isDirectory()) result.push(...await listFiles(root, name));
    else if (entry.isFile()) result.push(name);
    if (result.length > 1000) throw new Error('Too many artifact files');
  }
  return result.sort();
}
export async function collectText(root: string) {
  const result: Record<string, string> = {};
  for (const name of await listFiles(root)) {
    if (name.startsWith('src/') || name === 'index.html') {
      const bytes = await readFile(await safeFile(root, name));
      if (bytes.length > 200000) throw new Error('Source file exceeds text budget');
      result[name] = bytes.toString('utf8');
    }
  }
  return result;
}
