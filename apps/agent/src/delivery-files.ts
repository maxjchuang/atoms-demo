import { readFile, lstat } from 'node:fs/promises';
import { ToolchainDescriptor, canonicalDeliveryJson, deliveryHashBody } from '@atoms/contracts/delivery';
import { listFiles, safeFile, sha256 } from './files.js';
import { mediaType } from './verify.js';

export const seal = <T extends { hash: string }>(value: T): T => ({ ...value, hash: sha256(deliveryHashBody(value)) });
export function assertSealed(value: { hash: string }) {
  if (sha256(deliveryHashBody(value)) !== value.hash) throw new Error('Object fingerprint mismatch');
}
export async function fingerprints(root: string, prefix = '') {
  const files = [];
  for (const name of await listFiles(root)) {
    if (name.startsWith('dist/') || name.startsWith('evidence/')) continue;
    const target = await safeFile(root, name); const stat = await lstat(target);
    if (!stat.isFile()) throw new Error('Snapshot contains non-file entry');
    const content = await readFile(target);
    files.push({ path: prefix + name, bytes: content.length, sha256: sha256(content), mediaType: mediaType(name) });
  }
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
export const inventoryHash = (files: { path: string; bytes: number; sha256: string }[]) => sha256(canonicalDeliveryJson(files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)));
export function sameToolchain(left: ReturnType<typeof ToolchainDescriptor.parse>, right: ReturnType<typeof ToolchainDescriptor.parse>) {
  return canonicalDeliveryJson(left) === canonicalDeliveryJson(right);
}
