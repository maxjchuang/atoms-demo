import { readFile } from 'node:fs/promises';
import type { RuntimeEvent } from '@atoms/contracts';
import { putFile, safeFile } from './files.js';

export type FileChange = Extract<ReturnType<typeof RuntimeEvent.parse>, { type: 'file.changed' }>['payload'];

/** Report a source change only after the corresponding bytes exist on disk. */
export async function applySourceEdit(workspace: string, name: string, content: string,
  changed: (event: FileChange) => void,
) {
  const target = await safeFile(workspace, name);
  const before = await readFile(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  const bytes = Buffer.from(content);
  if (before?.equals(bytes)) return false;
  await putFile(workspace, name, bytes);
  changed({ path: name, operation: before === null ? 'added' : 'modified' });
  return true;
}
