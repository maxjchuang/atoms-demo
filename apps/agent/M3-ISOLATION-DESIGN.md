# M3 Agent Linux isolation — candidate G0

Status: design only. No Docker job, image build/pull, container/service change, provider call or deployment was performed for this document. Current M2 evidence remains macOS/local verification. Read together with AGENTS.md, architecture.md, parallel-plan.md and protocol-delivery-v0.1.md; those existing frozen plans, budgets, reports, ZIPs and publication fences stay authoritative.

## Concrete backend and ownership

Choose **Docker Engine Linux containers, fresh per execution/attempt/phase**, on the existing Linux arm64 Engine, with no host-mode verification fallback in public M3 mode. Use new `atoms-v03-*` image/container/network/volume labels only. Do not stop/prune/rebuild another task's resources.

Agent owns `apps/agent/docker/**`: minimal job image, fixed verifier entrypoint/DSL controller, trusted broker/controller internals and Agent integration. Backend owns `deploy/m3/**`, Compose, API/gateway images, tunnel/bootstrap, `scripts/m3-*` and root `.dockerignore`. Root coordinates/finalizes G0 and Git; it does not implement infra. No root asset is edited by this Agent before that coordinated G0.

Read-only observed host facts: Engine29.5.2/API1.54, Linux/aarch64, cgroupv2, default seccomp/AppArmor enabled. Cached `atoms-runner:local` image ID87f77f… is Linux/arm64/user node, but has no OCI source/revision labels; root reports cached review images belong to another `atoms-review` task. They are **not accepted provenance or probe evidence**. One guessed `node:26.5-bookworm-slim` tag was not locally present; exact Node/base/browser digests must be resolved and recorded in the new build at G0. No cached image is executed on that assumption.

## Credential and control boundary

| Plane | Allowed data/access | Explicitly forbidden |
| --- | --- | --- |
| Trusted Agent/DSH model caller | Its provider secret, private project sessions, authorized bounded published-source text, immutable requests/events | Executing generated JS/build/browser on this plane; handing a management endpoint/key to model output |
| Trusted job broker/controller | Docker control, fixed phase commands/policy, bounded source/ZIP input, job identity/lease and bounded artifacts | Model API key, DSH home, API SQLite/session store, arbitrary user command/image/mount/network arguments |
| Untrusted compiler/install job | Its copied source/ZIP, fixed trusted package/config/lock/tools, private writable scratch | Credentials/socket/private homes/other job data, host bind paths, API/preview/data volumes, Docker/network administration |
| Untrusted browser job | Its immutable dist and frozen DSL input, fresh profile/storage, bounded evidence scratch | Any credential, management socket, shared user browser profile, other app/job data, API/model/host/Internet reachability |

**Only a separate trusted broker gets Docker control**. API/Web/gateways/model subprocess and every job get no Docker socket. The Agent supervisor talks to a restricted authenticated internal broker interface; the model process does not receive its token or environment. Broker accepts only allowlisted image digests, phase operations, generated job IDs and fixed resource policy, never visitor/model Docker flags or shell strings. A compromised job cannot call the broker. Docker daemon privileges remain a trusted-admin boundary; a mounted socket is not made safe by calling it read-only.

Provider secrets are runtime secrets only in the trusted model plane, never build args/image layers/logs/job env/tar input. Keep API↔Agent and Agent↔broker secrets separate; scrub all child environments. Model tools stay disabled. Authorized model source reading still uses immutable snapshots/allowlists and the existing file/byte bounds.

## Images and installation/network choice

Use one reproducible **new Agent job image** with fixed Node26.5.0, pnpm10.33.0, TypeScript/Vite/React pins and Playwright1.56.1 + its matching Linux Chromium. Build from a verified official Node Linux base; install matching browser system libraries/browser during the trusted image build. Pin multiarch image/browser/package integrity and record source commit/build recipe/image digest; no model/user source or key enters that build. ARM64 is the first target; amd64 is not claimed until separately probed.

**Choose network-none jobs, including clean install.** No per-job egress proxy is required for the first M3 baseline. Trusted image/bootstrap preparation downloads the fixed public-registry package tarballs into an integrity-verified offline pnpm store bound to the exact trusted lock. This administration happens before readiness, with no user lifecycle scripts/source and no model credential. Runtime copies that store into each job's bounded scratch; it is not a shared writable cache or platform node_modules mount. Clean export must actually unpack the exact ZIP and run `pnpm install --offline --frozen-lockfile --ignore-workspace --ignore-pnpmfile --ignore-scripts` into its own source/node_modules, then resolve the tools there and run the same checks/DSL. Missing cache/integrity fails closed; never silently access Internet or fall back to platform dependencies.

The registry field continues to describe the configured/public package origin, not a fictitious per-job network download. A bound sandbox/install evidence record explicitly records offline mode and cache digest. If the frozen lock needs a new package, admin rebuilds/verifies the cache/image and toolchain before any new Run; an active Run never changes its frozen toolchain. This preserves exact ZIP/independent-install semantics while removing DNS/metadata/private-registry reachability from untrusted jobs.

Builder and browser phases use separate fresh containers. The browser serves that job's dist on **container-local loopback** and connects Chromium only to it. `--network=none`, no host ports, no host gateway alias, private IPC and a dedicated bounded /dev/shm. Playwright routing/CSP/service-worker/frame/popup restrictions remain defense in depth; egress denial is at the namespace boundary, not only a route callback.

Chromium must run as nonroot with `chromiumSandbox:true`; no automatic `--no-sandbox`, privileged, host IPC, seccomp-unconfined or host-network fallback. Start from Docker's default seccomp and an audited minimal browser-user-namespace allowance where required. Kernel/AppArmor user-namespace compatibility must pass an actual probe. If sandboxed Chromium cannot start under the policy, M3 readiness fails; root decides a revised policy, not a silent downgrade.

## Mount, resource and job policy

Prefer bounded tar/archive transfer through the broker into a fresh job scratch filesystem; **no bind mount of host checkout/home/data**. Validate path syntax, size, count, Unicode/case collisions, no symlink/hardlink/device/FIFO/sparse/path traversal and exact hashes on input/output. Read-only image root/runner/plan; job-specific input/output only. Model output cannot replace the runner, tests, package scripts/config/lock or source hash declaration. Build source import policy remains active before compilation.

Initial G0 limits to prove, not defaults assumed from Docker:

| Resource | Compile / clean-install job | Browser job |
| --- | --- | --- |
| UID/GID | fixed nonroot10001:10001 | fixed nonroot10001:10001 |
| privilege | cap-drop ALL, no-new-privileges, readonly root, default AppArmor/seccomp | same + reviewed Chromium userns seccomp policy |
| CPU | hard quota1.5 CPUs | hard quota1 CPU |
| memory/swap | memory2GiB, memory-swap2GiB (no swap allowance) | memory1536MiB, memory-swap1536MiB |
| PIDs / open files | pids128, nofile1024 | pids256, nofile2048 |
| disk | /job tmpfs<=1GiB, inodes<=65536; /tmp<=128MiB | /job<=128MiB, /tmp<=128MiB, shm<=256MiB |
| execution | /job exec is needed for pinned native esbuild; nosuid/nodev | scratch nosuid/nodev/noexec where browser startup permits |
| network | none | none; own loopback static app only |
| time | hard phase<=180s and <=Run remaining active time | <=frozen browserBudget<=90s and <=Run remaining |
| output | existing maxArtifactBytes<=20MiB, bounded entries/logs; stop at cap | same existing evidence/artifact budgets |

Use read-only root plus size/inode-bounded tmpfs so a `dd`/many-small-files attack cannot consume unlimited host disk. tmpfs memory also counts against cgroup memory; readiness must demonstrate the chosen cache+install fits. Do not claim universal `--storage-opt size` quotas: support depends on the Engine/storage driver. Avoid persistent per-job writable volumes until their quota enforcement is proven. Capture/stream bounded output before normal cleanup; on forced stop lost scratch is an interrupted/failed job, never fabricated passing evidence.

Generation pool remains one execution pipeline; phases are sequential to keep VM resource use bounded. Router has its existing independent bounded model lane. These limits do not reset total Run/preparation/repair/model budgets. Queue/waiting-user time is excluded; actual create/start/install/build/browser/repair/copy/check time is included according to the existing active-time rule. No extra provider request is introduced by this design.

## Durable identity, cancellation and restart

Before creating a job, persist a private lease: executionId/bindingHash/attempt/phase, random job ID, generation nonce, exact image/policy/input hashes, createdAt/deadline. Container labels use those generated values; names use `atoms-v03-<jobId>`, never raw user names. Creation/retry is idempotent: reconcile that lease before creating another container. A stale/unknown-generation result cannot become an attempt/report or artifact.

Cancellation marks the execution fence first, stops DSH if active, stops/kills the exact labelled job/container and confirms not-running/removed; kill the entire PID namespace, not just docker CLI. Broker loss/Docker timeout is **not** proof of stopping: retain cancelling/lock and no publication until reconcilable. On restart enumerate only the owned project/label namespace, match durable leases, kill/reap interrupted jobs and reject late results. Do not auto-resume external compiler/browser processes or launch replacements under old IDs. Mark interrupted only after stopping or a genuine generation/data fence prevents old writes/publication. Do not prune unrelated review containers/images/volumes.

The broker/Agent retain small host-owned start/exit/cancel/image/policy/limit evidence; raw job stdout is bounded data, not authoritative Runtime events. Trusted fixed verifier logic drives the DSL; generated app console output/JSON cannot announce check success. Import/export parsing runs with bounded buffers and never executes artifact content. Resource-OOM/PID/disk/time kills are explicit failures; they cannot wash an earlier failed required case into not_run or partial publication.

## Frozen delivery compatibility and protocol needs

No change to Goal/Seed/required/DSL/actions, same-plan repair, quality policy, existing report provenance, source/dist/lock/archive/contents hashes, independent export/clean replay or API publication/restore fences. New Runs must discover the actual Linux verifier toolchain (node/pnpm/os/arch from the job backend, not the Mac control process). Give it a new toolchain ID; template/package/scripts/lock hashes remain actual byte hashes. Record image/policy/cache digests as host-owned bound evidence using existing report/evidence references, without rewriting M2 macOS history or implying that restoring it reran Linux checks.

Proposed G0 interface (manager/shared author to freeze before consumers):

- Agent private `ExecutionBackend` operations: stage verified input, run fixed phase, cancel/reconcile, collect bounded output. No visitor-selected command/path/image/network/mount, no raw Docker API.
- Broker private authenticated operations: `createJob(fixed phase + generated identity + hashes + remaining deadline)`, `uploadInput`, `start`, `status`, `cancel`, `readOutput`, `dispose`. Request hash/lease/generation are immutable. This internal management plane has **no host public port**.
- API needs a fail-closed readiness signal distinguishing `docker-linux` from unsafe host mode, exact toolchain/policy/image digests and probe revision. Prefer an additive isolation capability module/endpoint, e.g. authenticated `/internal/isolation/v1/capabilities`, rather than adding fields to strict legacy health DTO. DTO/path/author are a G0 decision, not implemented here. Existing execution APIs remain unchanged.
- Public M3 configuration requires that readiness; no Docker/backend-ready means no new public generation and no fallback to local host. Ordinary local M2 unit tests may retain explicitly labelled host mode, never be counted as M3 probes.

Backend alignment: API/Agent/broker expose no host ports. Only workbench gateway loopback18080 and preview gateway18081; tunnel bootstrap is Backend-owned. Gateway/preview see only their required static/business volumes; none of those volumes are mounted into jobs. Agent artifacts reach API only through authenticated existing candidate endpoints; jobs never write API SQLite/publication directories. Source/ZIP download remains the exact verified archive.

Root assets proposed for Backend to own after G0: `deploy/m3/compose.yaml`, gateway/tunnel/bootstrap, secret injection and networks/limits for trusted services; `.dockerignore` must exclude every `.env*`, data/live/review/native home/credentials/node_modules/.git and include only explicitly reviewed build inputs. Agent's job/broker build assets stay under `apps/agent/docker/**`. Any necessary broker socket wiring is an explicit trusted-control service decision; API/gateways do not inherit it.

## Executable acceptance gates (zero model first)

These are commands/probes to implement after G0, **not reported as run**:

1. `pnpm --filter @atoms/agent test:isolation:policy`: malformed paths/archives, symlinks/hardlinks/devices, unknown flags/images/phases, forged/stale lease and output, no credential env/broker secret mounts. Inspect created container config, not merely requested arguments.
2. `pnpm --filter @atoms/agent test:isolation:docker`: actual Linux job prints uid/capability/no-new-privileges/cgroup limits and cannot read random canaries in control home, provider secret, socket, API DB, preview volume or another job. Canaries are test-only random values, never real keys. Read/write/symlink traversal and /proc/env probes must return no canary.
3. Actual network probes: DNS/Internet, metadata169.254.169.254, host.docker.internal, host gateway, API/Agent/broker/preview ports and another job all fail. Browser own-loopback app succeeds; nonloopback and iframe/popup/service-worker attempts cannot reach the sentinels.
4. Resource probes: CPU spin, memory allocation, fork/PID saturation, unlinked background child, tmpfs bytes/inodes, log flood. Observe hard ceilings and bounded host resources; cancellation kills child/grandchild and no descendant writes a post-terminal sentinel. A watchdog timeout alone is not acceptance.
5. Crash race: stop the broker/Agent mid-job, restart control, reconcile exact labelled leases, reject a delayed old-generation success, retain current API version and no duplicate job/Run/publication. Docker outage keeps cancelling rather than pretending stop confirmation.
6. Actual Linux functional parity: Fake DSH + real Docker type/build/DSL notes6/calculator2, same-plan controlled failure→repair, source pre/post hashes, exact ZIP clean offline install with tool paths inside its fresh tree. Wrong/missing cache/lock, changed source/plan, fake success stdout and a crafted empty report all block delivery.
7. API/Web Docker G3/G5 owned by their lanes: cookie/auth/quota, public double-origin preview, download, cancellation/version fences and UI quality/gaps. A Linux job smoke alone is not public delivery acceptance. Real provider remains separately supervisor-bounded only after the zero-model gates.

## Narrow G0 decisions / stop conditions

1. Confirm the offline-public-cache job network-none approach and Linux toolchain/image pinning (preferred), instead of adding a job Internet allowlist/proxy now. Missing cache is a blocked capability, not a reason to open network.
2. Freeze the minimal broker/capability interface and shared author; ensure no raw Docker socket reaches model/API/jobs. Backend owns root orchestration, Agent owns broker/job internals.
3. Actual Chromium sandbox + cgroup/tmpfs policy must be probed on the current Linux arm64 VM before readiness. If it needs unsafe host IPC/privileged/unconfined/no-sandbox, stop and return evidence for G0 revision; do not claim isolation.

Containers share the VM/kernel. This is a measurable Docker isolation boundary, not a proof against all kernel/browser vulnerabilities or a per-tenant VM guarantee. No M3/G5 pass is claimed until these actual probes and public gates pass.

Primary sources checked: [Docker resource constraints](https://docs.docker.com/engine/containers/resource_constraints), [tmpfs](https://docs.docker.com/engine/storage/tmpfs), [user namespace remapping](https://docs.docker.com/engine/security/userns-remap), [storage-driver quota constraints](https://docs.docker.com/reference/cli/dockerd), [Playwright Docker guidance](https://playwright.dev/docs/docker). The guidance about nonroot Chromium/seccomp is used; its trusted-CI host-IPC example is deliberately not adopted for untrusted jobs.
