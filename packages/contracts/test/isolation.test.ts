import assert from 'node:assert/strict';
import test from 'node:test';
import { IsolationCapabilities, IsolationCapabilitiesPath, IsolationVersionHeader, IsolationProtocolVersion } from '../src/isolation.js';
import { isolationReady, isolationHostLocal, isolationDockerNotReady } from '../src/isolation-fixtures.js';
import { StartExecutionRequest } from '../src/index.js';
import { startExecution } from '../src/fixtures.js';

test('isolation response has its own endpoint/header/version and deterministic synthetic ready/not-ready shapes', () => {
  assert.equal(IsolationCapabilitiesPath, '/internal/isolation/v1/capabilities'); assert.equal(IsolationVersionHeader, 'X-Atoms-Isolation-Version'); assert.equal(IsolationProtocolVersion, '0.1.0');
  for (const value of [isolationReady, isolationHostLocal, isolationDockerNotReady]) assert.deepEqual(IsolationCapabilities.parse(value), value);
  assert.equal(isolationReady.platform, 'linux/arm64'); assert.equal(isolationHostLocal.ready, false);
});
test('ready rejects missing actual environment/probe fields or any failure reason', () => {
  for (const field of ['toolchainId','imageDigest','policyHash','cacheHash','probeRevision','platform'] as const) assert.equal(IsolationCapabilities.safeParse({ ...isolationReady, [field]: null }).success, false, field);
  assert.equal(IsolationCapabilities.safeParse({ ...isolationReady, reasonCodes: ['PROBE_NOT_PASSED'] }).success, false);
  assert.equal(IsolationCapabilities.safeParse({ ...isolationReady, platform: 'darwin/arm64' }).success, false);
  assert.equal(IsolationCapabilities.safeParse({ ...isolationReady, imageDigest: 'node:latest' }).success, false);
});
test('host/nonready never claims readiness, forged environment, empty/duplicate reasons or unknown fields', () => {
  assert.equal(IsolationCapabilities.safeParse({ ...isolationHostLocal, ready: true }).success, false);
  assert.equal(IsolationCapabilities.safeParse({ ...isolationHostLocal, imageDigest: isolationReady.imageDigest }).success, false);
  assert.equal(IsolationCapabilities.safeParse({ ...isolationDockerNotReady, ready: true }).success, false);
  assert.equal(IsolationCapabilities.safeParse({ ...isolationDockerNotReady, reasonCodes: [] }).success, false);
  assert.equal(IsolationCapabilities.safeParse({ ...isolationDockerNotReady, reasonCodes: ['IMAGE_MISSING','IMAGE_MISSING'] }).success, false);
  assert.equal(IsolationCapabilities.safeParse({ ...isolationReady, dockerSocket: '/var/run/docker.sock' }).success, false);
  assert.equal(IsolationCapabilities.safeParse({ ...isolationReady, protocolVersion: '0.2.0' }).success, false);
});
test('isolation does not add fields or weaken legacy execution DTOs', () => {
  assert.deepEqual(StartExecutionRequest.parse(startExecution), startExecution);
  assert.equal(StartExecutionRequest.safeParse({ ...startExecution, isolation: isolationReady }).success, false);
});
