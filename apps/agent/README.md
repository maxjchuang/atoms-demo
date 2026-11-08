# Agent runtime

Implements the internal v0.1.0 execution HTTP service over the shared contracts. DSH is isolated behind a model adapter; the API owns all visitor identity, quotas and version publication.

```bash
pnpm --filter @atoms/agent check
pnpm --filter @atoms/agent test:contract
AGENT_MODE=fake pnpm --filter @atoms/agent dev
# Explicit real model verification; reads root .env without printing secrets:
pnpm --filter @atoms/agent smoke:real
```

Runtime configuration (root `.env` is loaded by the executable):

| Variable | Meaning |
| --- | --- |
| `ATOMS_SERVICE_TOKEN` | Required internal bearer token, minimum 16 characters |
| `AGENT_MODE` | `dsh` default; explicit `fake` for deterministic testing only |
| `DEEPSEEK_API_KEY` | Real mode credential; never returned to visitors |
| `DEEPSEEK_MODEL` | Optional provider model, default `deepseek-flash` |
| `AGENT_PORT` / `AGENT_HOST` | Defaults `4100` / `127.0.0.1` |
| `API_INTERNAL_URL` | Defaults `http://127.0.0.1:3001`, for approved input artifacts |
| `AGENT_DATA_DIR` | Defaults root `data/agent` |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` | Optional installed browser path; macOS Chrome is detected |

All internal requests require the bearer token and `X-Atoms-Protocol-Version: 0.1.0`. The executable refuses an invalid service token. The service is not intended to be directly exposed to visitors.

Fake mode generates an explicitly labeled notes application and still executes actual TypeScript, Vite and Chrome checks. Test markers `[repair]`, `[fail]` and `[slow]` inject controlled adapter behavior only in Fake mode. Real mode uses no fallback and allows only schema-validated source edits with model-facing shell/filesystem tools disabled.

Process feedback stays within protocol 0.1.0: real action starts/completions are ordinary `message.completed` events, including source preparation, planning summary, model-session readiness, source application, check starts/results and candidate packaging. File events follow successful writes and distinguish added/modified; unchanged files emit nothing. The current structured source adapter does not remove files, so it never fabricates deleted events. Model response retry reports a redacted reason category and `1/1` only.

No model reasoning, raw source-response stream, simulated tool actions or percentage progress is exposed. No periodic persistent waiting messages are generated. A consuming UI may show elapsed waiting time from stage timestamps, but service responsiveness must not be described as model progress.

See [COMPATIBILITY.md](COMPATIBILITY.md) for measured evidence and limits, particularly the uncompleted OS isolation/public deployment gate. See the [internal protocol](../../docs/agent-protocol.md), [parallel plan](../../docs/parallel-plan.md) and [acceptance matrix](../../docs/acceptance.md) for integration rules.

## M1 project coordination

The same server now implements `/internal/v2/coordination-turns` using `X-Atoms-Coordination-Version: 0.2.0`; v1 execution routes still require `X-Atoms-Protocol-Version: 0.1.0`. Router inference has a separate bounded lane from Worker execution. `COORDINATOR_MODE` can explicitly select `fake` or `dsh`; otherwise it follows `AGENT_MODE`. Missing real credentials fail closed, never fall back to Fake.

DSH Router sessions use stable project storage/cwd and explicit resume. API-provided confirmed decisions, revisioned facts and bounded committed history remain authoritative; model session history cannot grant permission or override a correction. Dirty/cancelled/uncertain native sessions are fenced into a fresh generation before another Turn, and known uncommitted messages are excluded from subsequent model evidence/history. Shared results use host-filled ContextUsed and IDs; the model uses semantic aliases, not hashes or invented opaque IDs.

Source reading is host-mediated from an immutable published artifact, with manifest/file hash checks and a hard policy of at most 5 files/24 KiB per Turn. Router tools remain disabled. Ordinary Run questions use the existing v1 Attention/answers endpoints, retain immutable startup hash and budgets, persist answers privately, and are capped at two ordinary questions excluding plan confirmation.

```bash
pnpm --filter @atoms/agent check
pnpm --filter @atoms/agent test:contract
# Explicit paid-model opt-in; do not run as part of default tests:
ATOMS_ALLOW_REAL_COORDINATION_SMOKE=1 pnpm --filter @atoms/agent smoke:coordination:real
```

Stable **Fake-only examples** for independent HTTP integration (not a natural-language accuracy claim):

| Input | Deterministic result |
| --- | --- |
| `如何分享这个应用给别人？` | consult from deployment facts, no Worker |
| `增加搜索框` | explicit latest change proposal; API may admit one Run |
| `记住我的偏好：界面使用暖色` | user-sourced preference suggestion |
| `我的偏好改成深色` | superseding preference suggestion |
| `我的偏好是什么？` | answer only from current active API decisions |
| `帮我处理分享` | message-level clarification with two options |
| Bound option label `说明如何分享` | consult, no Run |
| Bound option label `给应用增加分享入口` | confirmed clarification proposal; API decides admission |
| Unbound `可以` | new clarification, never guesses latest authorization |
| `停止这个正在生成的任务` | cancel suggestion for exactly one active target; otherwise clarify |
| Worker Run prompt `创建便签墙 [question]` | one ordinary Run question before source writes |
| Worker Run prompt `[questions:3] 创建便签墙` | reaches the two-question policy limit, no artifact |
| `[read-source:source/src/App.tsx] 解释保存方式` | one controlled source-read pass before consult |

For option answers always use the returned option ID and explicit clarification revision; do not hard-code the host-generated IDs. A `proposal_refresh` operation must include the exact trusted proposal in context and stays read-only/exact-version. Context canonical hashing recursively sorts object keys, preserves array order, omits only the top-level hash and hashes compact UTF-8 JSON; the shared fixture vector is asserted independently in Agent/API tests.

Token budgets for new real Worker and Router requests count effective input, including reported cache reads/writes. Settled SDK usage is normalized against `totalTokens` so a provider whose input already includes cache is not charged cache twice. Duplicate settled event IDs are ignored; final RunResult summaries are not added again. Ambiguous fields use a conservative reported bound and private numerical accounting metadata. The old public DTO shape is unchanged; existing completed historical snapshots are not silently rewritten.

## M2 trusted delivery (internal 0.1.0 module)

Delivery uses `/internal/delivery/v1` and `X-Atoms-Delivery-Version: 0.1.0`; existing v1 execution and v2 coordination DTOs remain unchanged. The frozen shared module is the only wire definition. The API fetches authenticated `GET /toolchains/toolchain_react_v1`, stores its actual descriptor, then sends a unique immutable Preparation for its Run/execution. Preparation is read-only with respect to application source and shares the generation slot with Workers; project Router inference uses its separate lane.

Both explicit host profiles and the no-tools DSH planner preserve the complete authorized RequirementSeed. DSH proposes typed generic cases/coverage; host fills IDs/hashes and missing declarations remain unsupported. Structural mapping is not a proof of semantic completeness. API freezes the returned Spec/Plan and sends the full execution wrapper. Runtime compares it with the persisted measured Preparation, verifies every frozen hash/toolchain/exact input, and enforces total minus planning active time/steps/effective tokens. A different preparation ID cannot reset a Run. No source is written before a validated wrapper.

The fixed browser interpreter implements the shared no-code DSL (roles/labels/test IDs, count/box variables, fill/click/check/press/drag/reload and bounded assertions), without notes/calculator branches or evaluating model JavaScript. It checks source hashes before/after each attempt, limits case/step/time budgets, uses fresh browser contexts and blocks outbound navigation, frames and popups. Frozen assertions/required flags are never changed during repair. Build source imports are additionally restricted to the controlled source tree and fixed React packages; host/remote assets, arbitrary import.meta expansion and external CSS resolution are rejected. This is a local execution policy, **not an OS sandbox**.

The actual source ZIP contains exactly `source/` files plus root `contents-manifest.json`; unpack and `cd source`. Host-owned package/scripts/config and a public-registry `pnpm-lock.yaml` are included. The runtime extracts the **same ZIP bytes**, verifies file/contents/source hashes, installs with pnpm 10.33.0 frozen lock and disabled lifecycle scripts in an independent directory, rejects links outside that directory, runs its locally installed TypeScript/Vite, and replays the same frozen browser plan. The standalone package does not contain platform workspace links. Stage failures, all attempts, case logs/screenshots, patch provenance, external export/clean reports and final report remain separately readable even without a successful candidate. API owns file verification, final quality/publication and cancellation fences.

Default tests make **zero model calls**. They do perform actual Chrome checks and public registry installs for independent export builds:

```bash
pnpm --filter @atoms/contracts check
pnpm --filter @atoms/contracts test
pnpm --filter @atoms/agent check
pnpm --filter @atoms/agent build
pnpm --filter @atoms/agent test:contract
# Shorter preparation/coordination boundary checks:
pnpm --filter @atoms/agent exec tsx --test test/delivery-planning.test.ts test/delivery-boundaries.test.ts
```

Fake inputs are deterministic protocol fixtures, not natural-language accuracy claims:

| Explicit Fake input/config | Effect |
| --- | --- |
| `创建便签墙` | Fake planner/Worker notes example; six frozen behavior cases |
| `[calculator] 创建计算器` | Fake planner/Worker calculator example; same interpreter, two cases |
| `ATOMS_TEST_CONTROLLED_REGRESSION=1`, `AGENT_MODE=fake`, prompt includes `[controlled-persistence]` | Host injects the known Fake persistence regression once; source/patch hashes and `controlled_regression` provenance are recorded; assertions stay frozen |
| `mode=plan` | Existing Run plan Attention; approval continues the same execution and budget |

Controlled regression defaults off, is ignored in DSH mode, and is never labeled a natural model defect. The first Fake notes exact-locator failure was manually fixed with an accessible button label; it is not counted as autonomous model repair. Ordinary questions and cancellation retain the legacy limits. A completed Preparation cancelled before Worker dispatch preserves its immutable completed snapshot/result while its independent report records final cancellation; it cannot subsequently start execution.

Delivery-aware coordination uses the separate typed outer wrapper on `/internal/delivery/v1/coordination-turns`. Inner ContextSnapshot/hash stays unchanged; the authenticated outer hash and delivery facts are persisted and cannot be downgraded via the old v2 PUT. Model input includes authoritative quality/gaps/asOf, and consult/status output includes a host-rendered delivery fact summary. Run publication success alone never establishes complete behavior coverage. API host actions provide downloads; the model receives no signed URL.

M2 billing uses the first actual adapter step/settled positive token observation for its existing `execution.started` event. Input loading and host-only plan approval remain visibly active without claiming inference; approval/restart stays in the same execution. API settles preparation/Worker usage once per Run. The optional legacy `behavior` summary reports actual results (including zero-case `not_run`); it never lowers any frozen Spec criterion's required flag. The delivery report remains authoritative for required failures and partial publication.

For retained Fake HTTP evidence, run `ATOMS_KEEP_AGENT_TEST_DATA=1 pnpm --filter @atoms/agent exec tsx --test test/delivery-runtime.test.ts`; printed paths contain only isolated test data. See the G1 evidence section in COMPATIBILITY for exact observed test counts and retained final-prefix artifacts.

Clean export installation explicitly passes `--ignore-workspace --ignore-pnpmfile` (both verified in pnpm 10.33.0 help), in addition to frozen lock/public registry/disabled scripts. This prevents an Agent data directory nested below the platform repository from selecting the parent workspace or running its package hook. The generated source README uses the same independent install command; its trusted template fingerprint changes accordingly, while package/scripts/lock stay unchanged. Existing failed reports are immutable and are not upgraded in place. Reproduce this boundary with `pnpm --filter @atoms/agent exec tsx --test test/delivery-export.test.ts`; it creates a parent workspace/platform package/throwing hook and requires actual extracted-app tools and node_modules, successful build/DSL, and no platform installation.

Preparation uses the pinned Messages provider's verified `reasoningEffort=off` / `thinking.disabled`; Worker remains low. Structured JSON is still strictly parsed (the current Messages route is not claimed to enforce Chat JSON mode). New interrupted native requests with missing settled usage expose null token totals while keeping private settled lower bounds; unknown usage cannot continue/freeze. Retry admission uses the same remaining budget and the preceding observed cost. See [MODEL-CONFIGURATION.md](MODEL-CONFIGURATION.md) for primary sources, local CLI/serializer proof and zero-network replay commands. Historical terminal usage/report bytes are not rewritten.

Preparation JSON and model DSL-schema errors now share the same single structured retry and remaining budget. The syntax prompt is generated from shared-schema-validated operation/locator examples; all goal/Seed/required constraints remain authoritative. Safe field issues can guide one correction; extra fields, uppercase IDs and missing assertion fields remain strictly rejected. Input authorization/hash failures, SDK errors and unknown usage never become format retries. Reproduce the sanitized seven-case/46-step/twelve-issue failure with `pnpm --filter @atoms/agent exec tsx --test test/planning-schema-retry.test.ts`; no provider request is made.

Fresh DSH planning now explicitly refines Seed requirements into derived criteria (`r*` refs with `sourceSeedRefs`), with opaque IDs and required flags filled by the host. It retains original canonical Seed criteria and uses the frozen shared conservative parent projection; manual/unsupported children remain visible and cannot become automatic. Full Goal preservation, one coverage per derived criterion and two-way case edges are validated before freeze. Existing completed host-profile/seed-only model results replay unchanged. See [DERIVED-CRITERIA-DESIGN.md](DERIVED-CRITERIA-DESIGN.md) for the exact internal format, six-core-behavior-plus-human local fixture and compatibility boundaries.

The isolated controlled-repair smoke tool is ready for supervisor review: [CONTROLLED-REPAIR.md](CONTROLLED-REPAIR.md). `smoke:controlled:repair -- --fake` rehearses 6 fixture cases without a provider; guarded real mode imports the reviewed original V4 **8-case/70-step/15-required** source/plan, creates one separate host_profile Run and asks the real Worker only for repair after a recorded controlled persistence failure. Constructor-only callbacks have no main/env/wire activation. The supervisor subsequently ran the single bounded real controlled-repair gate successfully; its immutable evidence/usage is recorded in CONTROLLED-REPAIR.md. It is distinct from Fake rehearsal and the three original first-pass CodeRuns.

### M3 Docker execution (local gates; public deployment is a separate API gate)

Set `AGENT_EXECUTION_BACKEND=docker_linux`, `BROKER_URL=http://broker:4310`, and `AGENT_BROKER_TOKEN_FILE=/run/agent-secrets/broker-token`. The Agent must not have the Docker socket. Broker runs `node --import tsx src/isolation/broker.ts`, with its own `AGENT_BROKER_TOKEN_FILE`, `BROKER_DATA_DIR=/var/lib/atoms-v03-broker`, `JOB_IMAGE=atoms-v03-job:linux-v1` and Docker access. Trusted images use UID 1000; the fixed isolated runner uses UID 10001 and its independent native PID1 watchdog uses UID 10002. `Dockerfile.control` and `Dockerfile.broker` start Node directly so TERM reaches the service. Secret files may also supply `ATOMS_SERVICE_TOKEN_FILE` and, only for explicitly authorized real runs, `DEEPSEEK_API_KEY_FILE=/run/provider-secret/provider-key`; use a separate provider-only volume mounted solely into the trusted model Agent. Fake mode never reads the provider file.

Build only new `atoms-v03-*` images, from an explicit source-only context:

```sh
pnpm --filter @atoms/agent exec tsx src/isolation/build-job-image.ts
pnpm --filter @atoms/agent exec tsx src/isolation/build-control-images.ts
```

The following administrator-only tests do not load `.env`, call a model, or contact public app services. Run sequentially (the development VM has about 5.77 GiB RAM):

```sh
pnpm --filter @atoms/agent exec tsx src/isolation/smoke-policy-job.ts
pnpm --filter @atoms/agent exec tsx src/isolation/smoke-browser.ts
pnpm --filter @atoms/agent exec tsx src/isolation/smoke-offline.ts
pnpm --filter @atoms/agent exec tsx src/isolation/smoke-runtime.ts
pnpm --filter @atoms/agent exec tsx src/isolation/smoke-broker.ts
pnpm --filter @atoms/agent exec tsx src/isolation/smoke-resources.ts
pnpm --filter @atoms/agent exec tsx src/isolation/smoke-canaries.ts
pnpm --filter @atoms/agent exec tsx src/isolation/smoke-runtime-cancel.ts
pnpm --filter @atoms/agent exec tsx src/isolation/smoke-runtime-restart.ts
pnpm --filter @atoms/agent exec tsx src/isolation/smoke-deadline.ts
pnpm --filter @atoms/agent exec tsx src/isolation/smoke-watchdog.ts
pnpm --filter @atoms/agent exec tsx src/isolation/smoke-services.ts
```

The capability endpoint stays `ready:false` until a privileged certification command runs all actual gates in the broker environment and atomically persists matching image/policy/cache/probe evidence:

```sh
BROKER_DATA_DIR=/var/lib/atoms-v03-broker node --import tsx src/isolation/certify.ts --certify
```

This is not an HTTP feature or an environment switch that declares success. Drain broker jobs first. A changed image/policy/cache, missing/tampered proof, or unconfirmed stop fails closed; a healthy occupied job slot leaves readiness stable. Use `show-capabilities.ts` with the private service token file to read the shared typed response. The private probe constructor is restricted to explicit Fake test harnesses; production `main.ts` exposes no bypass.

Linux clean export extracts the **exact source ZIP** into a fresh private job, installs from the image-bound verified offline pnpm store with frozen lock and scripts disabled, then typechecks/builds and runs the same frozen DSL in a separate sandboxed browser job. This is an offline-store Linux mode, not a claim of live network installation. The archive keeps its public registry lock and remains independently installable. No platform node_modules or host compiler/browser fallback is used.

主管最终独立复验：Agent check、78/78全量（120.9s）及build通过；实际Docker绝对deadline与trusted service TERM/stop/文件凭证边界分别在Gk8MYc、82K5TR通过。其余独立Linux/原DSL/精确ZIP、资源、真实跨plane/peer canary、HTTP取消、Broker及Agent强杀恢复记录见项目M3状态。部署内certifier与API最终拓扑/公网仍须后续验收，不把这些本地证据称G5。

The certifier pins the inspected image ID into every child `JOB_IMAGE`, and uses private `BROKER_DATA_DIR/certifier-tmp` scratch instead of the small service `/tmp`. It never forwards model credentials, broker tokens, or arbitrary Node options. Allow at least 2 GiB free broker-data space and 100k inodes; compiler installs and caches remain in bounded per-job tmpfs, not operator scratch. Its current matrix has 11 gates including independent watchdog expiry.

独立watchdog补修后主管重新通过check、完整80/80（125.7s）及build。新image精确digest下，Broker永不恢复/权限与CPU干扰watchdog正例QHC6q4、FakeRuntime→原6DSL修复→精确ZIPclean ee6nuh、当前job policy gHZVXh由主管独立通过；旧78项/旧镜像证据保留为历史，不代替当前认证。当前operator policy入口使用smoke-policy-job.ts；早期Node probe image脚本只保留历史来源。部署broker认证仍须实际执行，readiness不由此文字设置。

A zero-prompt DSH startup check is available as `node --import tsx src/smoke-dsh-initialize.ts --synthetic`. Run it only in a fresh network-none trusted-Agent oneoff with readonly root, cap-drop ALL, UID1000, fresh writable HOME/data/scratch and **no** provider/service-token volumes or credential env. It starts the SDK handshake and closes it without calling `run` or sending a prompt; no `.env`/credential file is read. All production SDK adapters fix the native loader cache off so native code loads from the trusted readonly image while `/tmp` stays noexec.
