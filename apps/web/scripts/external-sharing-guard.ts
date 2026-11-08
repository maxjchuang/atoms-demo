import { ResolveSharingRequest } from '@atoms/contracts/sharing';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';

/** Read before any browser/network startup; errors deliberately omit path and content. */
export async function readProtectedReviewerCode(path: string) {
  const fail = () => new Error('Reviewer code-file must be a regular non-symlink owned by the current user with exact 0600 permissions.');
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    if (typeof process.getuid !== 'function') throw fail();
    const uid = process.getuid(), before = await lstat(path);
    const valid = (file: typeof before) => file.isFile() && file.uid === uid && (file.mode & 0o7777) === 0o600;
    if (before.isSymbolicLink() || !valid(before)) throw fail();
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat();
    if (!valid(opened) || opened.dev !== before.dev || opened.ino !== before.ino) throw fail();
    const code = (await handle.readFile('utf8')).trim();
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(code)) throw new Error('Reviewer code-file content is invalid.');
    return code;
  } catch {
    // Do not propagate native fs errors, path names, contents or causes.
    throw fail();
  } finally { await handle?.close().catch(() => {}); }
}

function externalOrigin(value: string | undefined) {
  if (!value) throw new Error('Two explicit public HTTPS origins are required.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.port && url.port !== '443'
    || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(url.hostname)
    || /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(url.hostname) || /^\d+(?:\.\d+){3}$/.test(url.hostname)) throw new Error('Audit origins must be public HTTPS root authorities without credentials, query or fragment.');
  return url.origin;
}
export function readExternalSharingConfig(env: Readonly<Record<string, string | undefined>>) {
  if (env.ATOMS_ALLOW_EXTERNAL_SHARING_AUDIT !== '1' || env.ATOMS_EXTERNAL_OS_GATE !== 'accepted') throw new Error('Explicit external audit authorization and prior OS gate acceptance are required. These flags do not themselves prove the gate.');
  const workbenchOrigin = externalOrigin(env.ATOMS_EXTERNAL_WORKBENCH_ORIGIN), previewOrigin = externalOrigin(env.ATOMS_EXTERNAL_PREVIEW_ORIGIN);
  if (new URL(workbenchOrigin).hostname === new URL(previewOrigin).hostname) throw new Error('Workbench and preview require distinct external hosts.');
  const projectId = env.ATOMS_EXTERNAL_PROJECT_ID, versionId = env.ATOMS_EXTERNAL_VERSION_ID;
  if (!projectId || !/^project_[a-z0-9_-]+$/.test(projectId) || !versionId || !/^version_[a-z0-9_-]+$/.test(versionId)) throw new Error('Explicit already approved existing project and published version are required.');
  if (!env.ATOMS_EXTERNAL_CODE_FILE || !env.ATOMS_EXTERNAL_APP_ADD_SELECTOR || !env.ATOMS_EXTERNAL_APP_EDITOR_SELECTOR) throw new Error('Protected code-file and reviewed existing app add/editor selectors are required.');
  return { workbenchOrigin, previewOrigin, projectId, versionId, codeFile: env.ATOMS_EXTERNAL_CODE_FILE, addSelector: env.ATOMS_EXTERNAL_APP_ADD_SELECTOR, editorSelector: env.ATOMS_EXTERNAL_APP_EDITOR_SELECTOR };
}
export function externalRequestAllowed(method: string, value: string, config: Pick<ReturnType<typeof readExternalSharingConfig>, 'workbenchOrigin' | 'previewOrigin' | 'projectId' | 'versionId'>, body?: string | null) {
  const url = new URL(value);
  if (![config.workbenchOrigin, config.previewOrigin].includes(url.origin) || url.username || url.password) return false;
  if (/^\/__mock(?:\/|$)/.test(url.pathname) || url.pathname.includes('mockServiceWorker')) return false;
  if (method === 'GET' || method === 'HEAD') return true;
  if (method !== 'POST' || url.origin !== config.workbenchOrigin || url.search || url.hash) return false;
  if (url.pathname === '/api/v1/sessions') return true;
  if (url.pathname !== `/api/sharing/v1/projects/${config.projectId}/resolve`) return false;
  try { const parsed = ResolveSharingRequest.safeParse(JSON.parse(body ?? 'null')); return parsed.success && (parsed.data.kind !== 'app_preview' || parsed.data.versionId === config.versionId); } catch { return false; }
}
export function safeExternalPath(value: string) { const url = new URL(value); return { origin: url.origin, path: url.pathname.replace(/\/p\/[^/]+/g, '/p/[redacted]') }; }
