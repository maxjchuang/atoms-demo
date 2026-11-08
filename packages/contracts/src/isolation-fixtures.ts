/** Synthetic wire fixtures only. No Docker job or real probe was performed. */
import { IsolationCapabilities, IsolationProtocolVersion } from './isolation.js';
export const isolationReady = IsolationCapabilities.parse({ protocolVersion: IsolationProtocolVersion, backend: 'docker_linux', ready: true,
  reasonCodes: [], toolchainId: 'toolchain_react_linux_arm64_v1', imageDigest: 'sha256:' + '1'.repeat(64),
  policyHash: '2'.repeat(64), cacheHash: '3'.repeat(64), probeRevision: 'probe_linux_v1', platform: 'linux/arm64' });
export const isolationHostLocal = IsolationCapabilities.parse({ protocolVersion: IsolationProtocolVersion, backend: 'host_local', ready: false,
  reasonCodes: ['HOST_BACKEND_UNSAFE'], toolchainId: null, imageDigest: null, policyHash: null, cacheHash: null, probeRevision: null, platform: null });
export const isolationDockerNotReady = IsolationCapabilities.parse({ ...isolationHostLocal, backend: 'docker_linux', reasonCodes: ['DOCKER_UNAVAILABLE','PROBE_NOT_PASSED'] });
