# Isolation capabilities v0.1.0 — G0 frozen

Scope is only API↔Agent readiness. Existing execution/conversation/delivery strict DTOs, plans, budgets, report/ZIP semantics and publication fences are unchanged. Broker operations remain Agent-owned private implementation; no shared Docker/command/mount/lease API is introduced here.

`GET /internal/isolation/v1/capabilities` requires the existing API↔Agent service Bearer and request/response header `X-Atoms-Isolation-Version: 0.1.0`. Model API keys and broker tokens must never be used for this authentication. No host public port or public gateway route exposes the endpoint. Authentication/version errors use the existing error envelope; unsafe/unavailable isolation returns HTTP200 with `ready:false` and fixed reason codes.

The strict shared module `@atoms/contracts/isolation` defines exactly:

| Field | Shape |
| --- | --- |
| protocolVersion | `0.1.0` |
| backend | `host_local` or `docker_linux` |
| ready | boolean |
| reasonCodes | unique fixed codes: HOST_BACKEND_UNSAFE / DOCKER_UNAVAILABLE / IMAGE_MISSING / POLICY_MISMATCH / CACHE_INVALID / PROBE_NOT_PASSED / CAPACITY_UNAVAILABLE |
| toolchainId | existing ID syntax, nullable |
| imageDigest | `sha256:` plus64 lowercase hex, nullable |
| policyHash / cacheHash | SHA256, nullable |
| probeRevision | existing ID syntax, nullable |
| platform | `linux/arm64`, nullable |

`ready:true` requires docker_linux, all six environment/probe fields present and no reasons. host_local is never ready, must have HOST_BACKEND_UNSAFE and all Docker metadata null. Every nonready response has a nonempty reason list. Unknown fields/values/digests/platforms are rejected. Synthetic ready fixture proves wire validation only; it is not an actual Docker probe result.

Agent must derive ready from the actual created job policy/image/toolchain and successful malicious/resource/cancellation probes, not cached image names or host process platform. policyHash binds the reviewed nonroot/cap-drop/readonly-root/network-none/resource/logging policy; cacheHash binds the integrity-verified public-registry offline package store for the exact frozen lock; imageDigest binds the pinned Linux job image. probeRevision binds that tested policy/image/cache combination in host-owned evidence. Changing any binding invalidates readiness until reprobed. No key, home, socket, raw Docker endpoint or private path appears in this response.

The API public-M3 generation path fails closed unless this authenticated response is ready for the configured expected Linux toolchain/policy/image/cache/probe. It combines isolation readiness with existing Runtime/provider readiness; it does not treat this DTO as a provider call or publication authorization. Agent independently enforces the same policy on every job and never falls back to local host execution if Docker/cache/probe is unavailable. Refresh readiness before admitting/dispatching new generation work; stale or unreachable readiness does not authorize generation.

All untrusted install/build/browser jobs have network none. Trusted image/bootstrap work prefetches the fixed public-registry tarballs; clean export copies the verified store privately and performs a real independent offline frozen install from the exact source ZIP, then same-plan checks. Evidence explicitly records offline Linux toolchain mode, not a new network download. Broker has the sole Docker control; API/model/job/gateway never receive the socket. Job logs use a proven nonpersistent/bounded Docker logging policy plus broker output caps/kill, verified by actual container inspection; a bounded stdout reader alone is insufficient.

Root independently reviewed this module and passed contracts check plus 90/90 in the Agent worktree (existing86 + isolation4); the separate sharing module is not counted here. The coordinated shared commit is the baseline before API/Agent consumers or Docker implementation. Backend alone edits package exports. New container/image/volume names use atoms-v03; unrelated cached review resources are untouched. Actual Docker/malicious probes, Linux functional parity and external gateway/preview gates remain implementation acceptance work, not G0 claims.

### Independent Router lane and generation admission

Normal healthy single-job occupancy does not invalidate the proven isolation tuple or set `CAPACITY_UNAVAILABLE`; that code is for an actually unavailable/unhealthy supported capacity. Trusted project coordination, including natural-language ask/consultation and progress, uses the independent M1 Router lane and remains authenticated, code-expiry/coordination-budget/rate-limited but is not blocked by job OS readiness. It does not run untrusted source. Direct Run/proposal accept generation admission still checks current readiness. An auto Router change may persist a bounded proposal/queued intent under existing authorization/quotas; reservation is not billable work. Without the current matching proof, the API must not dispatch Prepare/Worker or consume generation-used. Recovery resumes the same queued identity/outbox only; it never reruns Router inference, adds a new model retry or resets budgets. Queue waiting messages must state the isolation wait truthfully, not pretend code generation started or the healthy Router service disconnected.
