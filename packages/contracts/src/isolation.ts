/** Minimal API -> Agent isolation readiness. This DTO is not Docker probe evidence. */
import { z } from 'zod';
import { Id, Sha256 } from './index.js';
export const IsolationProtocolVersion = '0.1.0' as const;
export const IsolationVersionHeader = 'X-Atoms-Isolation-Version' as const;
export const IsolationCapabilitiesPath = '/internal/isolation/v1/capabilities' as const;
export const IsolationReasonCode = z.enum(['HOST_BACKEND_UNSAFE','DOCKER_UNAVAILABLE','IMAGE_MISSING','POLICY_MISMATCH','CACHE_INVALID','PROBE_NOT_PASSED','CAPACITY_UNAVAILABLE']);
export const IsolationCapabilities = z.object({
  protocolVersion: z.literal(IsolationProtocolVersion),
  backend: z.enum(['host_local','docker_linux']),
  ready: z.boolean(),
  reasonCodes: z.array(IsolationReasonCode),
  toolchainId: Id.nullable(),
  imageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
  policyHash: Sha256.nullable(),
  cacheHash: Sha256.nullable(),
  probeRevision: Id.nullable(),
  platform: z.literal('linux/arm64').nullable(),
}).strict().superRefine((value, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (new Set(value.reasonCodes).size !== value.reasonCodes.length) issue('Reason codes must be unique');
  if (value.ready) {
    if (value.backend !== 'docker_linux' || value.reasonCodes.length !== 0 || !value.toolchainId || !value.imageDigest
      || !value.policyHash || !value.cacheHash || !value.probeRevision || value.platform !== 'linux/arm64') issue('Ready requires actual Docker Linux environment, completed probe and no failure reasons');
  } else if (value.reasonCodes.length === 0) issue('Not-ready must provide a reason');
  if (value.backend === 'host_local') {
    if (value.ready || !value.reasonCodes.includes('HOST_BACKEND_UNSAFE')) issue('Host backend is never public-isolation ready');
    if (value.toolchainId || value.imageDigest || value.policyHash || value.cacheHash || value.probeRevision || value.platform) issue('Host backend cannot claim a Docker environment or probe');
  }
});
export type IsolationCapabilitiesDto = z.infer<typeof IsolationCapabilities>;
