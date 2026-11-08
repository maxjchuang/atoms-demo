# M3 deployment controls — local foundation gate

This is the backend-owned deployment implementation. It has **not** exposed a public tunnel or made provider calls. Manager alone reviews/commits/runs the final public bootstrap, OS certification and bounded real smoke. Do not use live 5173/3001/3002/4100, private `data/review-real`, M2 real artifacts or backups as a public mount.

## Ownership and topology

- `compose.yml`: final public topology; named API/Agent/broker data and separate per-role token volumes. API/Agent/broker have no host ports. Only workbench/preview gateways publish loopback18080/18081.
- `compose.check.yml`: explicit synthetic HTTP Agent, `atoms-m3-check` only; this is **not** OS proof/G3/G5. No Docker socket is mounted in this check topology.
- Provider credential has its own `provider-secret` volume: only trusted Agent (read-only) and a network-none same-Agent-image credential ingress may mount it. API, generic admin/bootstrap, gateway, broker and jobs do not mount it. Generic bootstrap handles internal tokens only, never provider input. No host private directory is mounted wholesale.
- Broker alone gets `/var/run/docker.sock`. It derives socket GID via a broker-role metadata stat; never hardcode host GID or give API/model/job a socket. `BROKER_URL=http://broker:4310`, `AGENT_EXECUTION_BACKEND=docker_linux`, file-backed service/broker/provider secrets are coordinated with the Agent lane.
- Public `M2_TOOLCHAIN_ID` is derived from the authenticated reviewed metadata tuple, not a host/default/fake ID. Unconfigured is a non-dispatching sentinel. `CAPACITY_UNAVAILABLE` is not normal healthy one-job occupancy; trusted Router remains independent.

Both gateways deny internal/metrics/broker/Docker/unknown routes and encoded traversal, overwrite Host/forwarded proto from canonical host configuration, never trust visitor forwarded host. Preview allows only GET/HEAD capability assets and strips cookies in both directions. Authenticated content and capability responses use no-store. Shared-preview browser storage is not project/tenant isolation; initial public profile is one reviewer identity/one sample project.

## Build and ordinary independent tests

```sh
pnpm m3:build
pnpm m3:test-unit
pnpm m3:test-context
pnpm m3:test
pnpm --filter @atoms/api exec tsx ../../scripts/m3-runtime-audit.mjs
pnpm --filter @atoms/api exec tsx ../../scripts/m3-image-audit.mjs
```

The exact official Node base is the verified Linux/arm64 manifest `public.ecr.aws/docker/library/node:26.5.0-bookworm-slim@sha256:9e5d714311940c098479ec352029af6df1d9a2dc4269b29373c616f51640dd67`. pnpm is pinned10.33.0; Node26 slim did not provide corepack, so the trusted image installs pinned pnpm via public registry with lifecycle scripts disabled. No host dependency or lockfile is rewritten.

`.dockerignore` is a source allowlist plus nested exclusions; API/gateway have stricter Dockerfile-specific ignore files excluding Agent implementation/cache. The actual scratch-COPY context export checks seven test-canary categories: `.env`, data/backups, native, review-artifacts, node_modules and .git. The saved-image audit decompresses layer blobs and checks history/config using only the check profile's test-only reviewer-code canary; **it does not read a real configured model key**. Manager performs a later real-key scan without printing it.

Build metadata is outside the repository (`~/.atoms-m3/check/images.json` by default). It records exact IDs/context hash/base, `sourceState=working-tree-context`, gitHeadAtBuild and acceptedCommit=null. An image built while source was uncommitted is not falsely labelled a clean old HEAD. Final acceptance must pair byte-identical input context to the manager's accepted commit; rebuild when relevant context changes. Do not reuse `atoms-review`/old `atoms-gateway:local`/old `atoms-runner:local` as evidence.

## Local foundation evidence

The explicit synthetic-container gate has passed: public API cookies/Host/Origin/owner routes; fixed-subject sharing and exact ZIP; internal deny; live API rejects the offline CLI across a different container PID namespace; SIGKILL leaves an uncertain lease that raw CLI refuses; only host-Docker proof of stopped API allows recovery. The DB/WAL/SHM state is read from a bounded0700 scratch copy with consistency checks, never mutated behind the live in-memory owner. Run/Version/used counts remained1/1/1 across crash recovery and stopped revocation; session401 and old preview403 after revoke.

Actual trusted-container audit passed API/workbench/preview UID1000, readonly rootfs, cap-dropALL, no provider env/file and no socket. Direct Node API CMD exits0 on container TERM and removes writer lease; it does not rely on pnpm signal forwarding. The new images' saved-layer/gzip/history canary check passed. Exact observed image IDs and context are in private `images.json`/`runtime-audit.json`/`image-audit.json`, not an implied final-public image endorsement.

Check failures were preserved, not rewritten as successes: missing Docker Compose plugin (existing standalone docker-compose5.7 selected, no global config install), YAML tmpfs quoting, local Node26 fetch ignoring custom Host (test uses http.request; not a production gateway fault), and pnpm signal/lease protection. Logs/results remain under the private check directory. Empty-bootstrap-only `--resume-bootstrap` does not recreate code, reset counters or create a second Run; any populated existing check needs explicit manager review/cleanup before fresh testing. The check scripts stop only owned check services and retain volumes; public volumes have not been initialized by these tests.

## Operator-only bootstrap and guards

```sh
pnpm m3:preflight                       # default isolated check profile
pnpm m3:initialize
pnpm m3:issue-code                      # only stopped/drained API; file only, no code stdout
pnpm m3:up
pnpm m3:state
pnpm m3:drain                           # pause new work, wait real terminal state, stop API
pnpm m3:origins:apply --manifest <public-origin-and-reviewed-tuple.json>
pnpm m3:up
pnpm m3:revoke-code                     # only after drain/stop
pnpm m3:down                            # no implicit -v
```

`--project atoms-m3-public` is explicitly selected by manager; default stays check. `M3_PRIVATE_DIR` must be outside the repository, current-owner0700. Issue writes a current-owner0600 private code file and never overwrites old code or resets identity/quota. The host inspects actual Compose labels/state before any stopped operation; the container CLI also owns a writer lease. A different PID namespace cannot use kill(pid,0) to clear a live/uncertain lease. Recovery clears a stale lease only after host Docker proves the API stopped. Issue/revoke additionally require drained Run/Turn records. No public admin endpoint exists.

Compose receives an explicit empty env-file and allowlisted environment, not the repository `.env`. Real credential ingress requires `--real --provider-key-file <owner0600-raw-file>` and `ATOMS_ALLOW_M3_REAL=1`; it uses trusted Agent only and performs no model request. Missing/certification-mismatched Docker proof does not fall back to host execution. `--actual-agent` uses the Agent-owned topology under the check project for future local integration, requires its reviewed images/proofs, and is not the synthetic test runner.

Tunnel start/renew, actual OS-certified topology, external browser/clipboard/expiry gates and the single bounded real public-profile Code+ask remain a separate manager-controlled stage. Cloudflare QuickTunnels have no SSE/no SLA/200-in-flight limit and changing hostnames. Existing execution/conversation cursor polling is retained. No current local/synthetic result claims G5, multi-tenant storage, or a real provider token cap measurement.

To repeat only the populated local synthetic check after reviewing its evidence, explicitly run `pnpm m3:clean-check --confirm-check-data-destruction`. It refuses public/real/active/unresolved state, copies prior check receipts/code and an API volume archive into a0700 private evidence subdirectory, then deletes only stopped `atoms-m3-check` volumes. There is no automatic reset on failure. This is not a public quota-reset feature. The manager should rebuild against the accepted common tree and retain the resulting context→commit mapping before final public use; the literal-copy Web follow-up changes the gateway build context.

Supervisor independently repeated this core snapshot: six unit/HTTP guard tests; actual seven-category context export (155 files, context `4fc91faeb9955df3a1a1f2fffd9eac1c852dc946cbec3a9bdcf5f17791e6812b`); fresh synthetic-check lifecycle after reviewed private backup; runtime role/TERM audit; saved-layer/gzip/history canary audit (34 blobs). Run/Version/used remained1/1/1 across crash/revoke. All passed with zero provider/public exposure. Actual final Agent/watchdog tuple, deployment certification and G5 are separate, pending stages.
