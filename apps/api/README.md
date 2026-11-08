# Backend: public API and version delivery

Node/Fastify service implementing the v0.1.0 public protocol. The API owns identity, quotas, project locks, durable task state and final publication. It talks to the Agent over authenticated HTTP; no DSH implementation is imported.

## M1 coordination (v0.2)

The separate `coordination.ts` module implements `/api/v2` against `@atoms/contracts/conversation`. Existing v1 execution DTOs and routes remain intact. Natural language is sent to the Agent Router; the API does not substitute a temporary keyword classifier. Explicit structured status/sharing shortcuts use host facts without inference.

- Messages and CoordinationTurns are independent of Runs. Consult/status/clarification do not reserve generation quota. The default auto mode admits clear explicit changes; ask never automatically builds or controls a Run.
- Replies, proposals, clarifications, memory decisions and both cursor families persist. All v1 messages mirror into the v2 history projection with stable IDs/historySeq/revision; admitted changes reuse the original user message.
- Per-project coordination is serialized until the previous result/memory transaction commits. The first outbound context/request/hash is persisted before HTTP; retries reuse the same body. The Coordinator polling lane is independent from Worker polling.
- Selection answers carry a trusted full question/option snapshot and related proposal, even after the question leaves recent/pending history. Decisions retain source messages, turn, revisions and supersession; context contains a scrubbed fact subset, never preview signatures or service credentials.
- Unaccepted proposal memory suggestions remain private unconfirmed suggestions and never enter ProjectDecision, including inferred, dismissed, blocked and cancelled proposals. Any accepted change records only its API-confirmed proposal.goal scope exactly once, linked to sourceProposalId and a typed confirmation receipt; acceptance does not approve arbitrary attached model memoryDelta, and no user natural-language message is fabricated. Normal explicit consult preference/correction memory remains supported.
- Latest intent binds the newest successful version at Worker dispatch. Exact proposals require revision/base confirmation and fail before execution if the accepted base changes. Refresh creates a new read-only proposal, never rewrites the old confirmation.
- Router cancellation cannot cancel an admitted Worker. Explicit `cancel_run` control validates target/ownership/revision and reuses v1 cancellation, with truthful stopping receipts.
- Cancelling a persisted coordination outbox queries the same Runtime turn first; it never sends a new PUT merely to cancel it. Confirmed 404 with no started/uncertain PUT can cancel locally and release reserved message quota. Network uncertainty or a possibly in-flight PUT stays cancelling until reconciled; a late started event is still charged exactly once.
- Opaque host actions resolve only from the Turn's saved context. Signed preview URLs are issued only to the browser; resolving a cancellation action does not execute it.
- Status prose is formatted from live API Run facts at reply commit. Model-invented public deployment/link claims are replaced by actual local-only platform facts; this output validation does not classify input intent.

`test:contract` includes independent HTTP FakeCoordinator cases plus all original v1 regressions. Fake outcomes are explicitly supplied by tests and are not evidence of real natural-language routing accuracy. Real Router capability and project-session restart behavior require the separate Agent/integration gate.

## Start

Use the root `pnpm dev:demo` for an explicit Fake DSH integration, or `pnpm dev` with the root `.env` configured for real DSH. The root launcher supplies ports and service credentials without printing them.

To run the API independently, configure the variables in `.env.example` in the process environment:

```bash
pnpm --filter @atoms/api start
```

Entrypoints read environment variables; they do not automatically read `apps/api/.env`. The root launcher reads the root `.env`.

Default endpoints:

- Workspace: `http://localhost:5173`, with `/api` proxied to API port 3001.
- API: `http://localhost:3001`.
- Preview: `http://127.0.0.1:3002`, intentionally a different hostname from the workspace.
- Runtime: `http://127.0.0.1:4100`, internal only.

Different ports alone do not isolate cookies. Open the workspace using **localhost**, with preview using **127.0.0.1**. Preview is a separate static-only server and has no API proxy.

`ATOMS_ENABLE_DEMO=true` and `ATOMS_DEMO_CODE` explicitly provision a local development access code. Defaults are disabled; production rejects demo seeding. The root local launcher enables this intentionally. No code is printed by the seed script.

Supported aliases: `ATOMS_SERVICE_TOKEN` / `INTERNAL_SERVICE_TOKEN`, `ATOMS_ALLOWED_ORIGINS` / `ALLOWED_ORIGINS`, `PREVIEW_PUBLIC_URL` / `PREVIEW_ORIGIN`, `API_DATA_DIR` / `ATOMS_DATA_DIR`.

## Independent verification

```bash
pnpm --filter @atoms/api check
pnpm --filter @atoms/api build
pnpm --filter @atoms/api test:contract
```

Tests start an actual Fake Runtime HTTP listener and a temporary SQLite database; public requests use Fastify injection. No model key, DSH, browser UI or external model request is needed.

Covered: session/ownership, quota reservation, idempotency, plan confirmation and answer delivery, same-project serialization, cancellation versus late success, response loss after acceptance, event paging, manifest/file hash validation, signed preview, source and evidence access, immutable restore, and API restart reconciliation.

The Fake Runtime is explicit synthetic test infrastructure. Its check reports are labelled fixtures; they are not compiler or browser evidence. Real Runtime + Fake DSH integration separately verifies actual compilation and browser smoke.

## Persistence and recovery

`node:sqlite` stores an atomically persisted JSON state snapshot in `api.sqlite`; one API process owns this database. The initial database schema is created on startup. This deliberately simple first implementation is not a multi-process queue or normalized production schema.

Task creation, quota reservation and dispatch intent persist together. Runtime PUT retries use the same execution ID. Source events are ingested in sequence and projected to project events. Successful artifact files are downloaded to a staging directory, checked against manifest hashes and moved into immutable version storage before the publication transaction.

API restart replays existing execution IDs without repeating model execution. Unreachable Runtime keeps its project lock; the API does not claim that unavailable execution has stopped.

## Process feedback and replay

Agent progress `message.completed`/`message.delta`, file changes, phases and check results are persisted individually as ordered project activities. Message content is materialized through complete `message.updated` upserts; distinct progress message IDs remain distinct messages. Replaying from `events?after=0` reconstructs historical activity without changing the latest workspace snapshot.

`activity.recorded.occurredAt` and source-derived message events retain the Agent's source timestamp. Delayed replay after reconnection must not be presented as newly executed work. Project `seq` is the only ordering cursor; timestamps can be older than earlier-delivered events. `Run.updatedAt` is API state-projection time, not a model heartbeat or proof of new execution activity. Empty polling adds no progress events.

If Runtime communication fails, the API records one sanitized assistant notice for that Run/outage cycle using the existing `message.updated` protocol. Repeated polls and API restarts do not flood notices. Once execution events have synchronized again, one recovery notice is recorded at current API time; it says only that the connection and synchronization recovered. These notices never mark a task stopped, release its project lock, or replace a valid preview. Fault details, service tokens, internal URLs and credentials are not included.

This stage does not add protocol fields or expose raw model JSON/hidden reasoning. Exact global queue position, a new activity snapshot schema and conversational intent routing remain separate work.

## Security and current limits

- Experience codes and session tokens are hashed. Idempotency records for login retain the issued Set-Cookie value to support exact retries; protect the local database and data directory.
- Mutations check Origin/Fetch Metadata, idempotency and ownership. Login is rate limited per remote IP. Generation quota and Runtime budgets are separate controls.
- Internal artifact endpoints require a service token and are not intended for public routing.
- Artifact publication rejects forbidden paths, missing required checks, missing evidence, oversized files and hash mismatches. Source exports omit environment/credential directories.
- Preview uses HMAC-signed version paths and restrictive response headers. It does not grant access to workspace APIs.
- The queue, rate limiter and scheduler are single-process. Do not run multiple API replicas against the same database.
- Cursor pagination is suitable for the small demo dataset; large mutable histories require indexed keyset pagination.
- Production Docker/network boundaries and public tunnel access require the separate deployment gate; running this local service does not certify sandbox isolation.

## M2 delivery（API 独立实现，跨服务验收另列）

新建 v1/v2 build 任务默认进入 delivery pipeline；旧数据中没有 delivery flavor 的既有任务继续原 reconcile，不重置身份、配额或旧 Run/Version，不为 legacy 补造验证。`legacyFixtureMode: true` 仅供显式旧版测试构造，不提供生产环境静默回退。

API 取得项目 writer 锁并绑定基线后，保存完整用户目标/来源 Seed、唯一 Preparation ID、规范请求/hash；只读 Prepare 完成后一次冻结 Spec/Plan/Binding，按总量减规划实际消费构造不可变 execution wrapper。Prepare 首次实际模型开始与后续 Worker started 共用同一个 used 标记；重试和重启不重复计次。取消未决请求不会为“证明停止”再创建推理；网络不确定时保留锁和取消中状态。

默认可信 descriptor 使用 `M2_TOOLCHAIN_ID=toolchain_react_v1`，从受认证的内部 toolchain 端点读取，并固化在首次 Prepare 请求；不猜 descriptor，不跨 apps 导入实现。默认每 Run 总上限为 8 observable model steps、65,536 有效输入（含缓存）、24,576 输出和 900,000 ms active time，规划与 Worker/验证/修复/clean export 共用，排队和用户等待不计 active time。宿主可配置 `M2_MAX_MODEL_STEPS`、`M2_MAX_INPUT_TOKENS`、`M2_MAX_OUTPUT_TOKENS`、`M2_MAX_ACTIVE_MS`；不会自动放宽重试。模型原生在途消费仍可能存在，不能将此描述为绝对费用硬限。

公共读取使用 `/api/delivery/v1` 和 `X-Atoms-Delivery-Version: 0.1.0`，精确路径/DTO 见 [冻结协议](../../docs/protocol-delivery-v0.1.md)。包含 run/version 交付视图、attempt 页、证据 descriptor/content、export/source.zip、同项目有界 diff。报告 final 与公开 publication 分开；尚未完成宿主实际文件/ZIP 核验时不会宣布可信 complete/partial。API 重新核对对象 canonical hashes、实际文件/证据/ZIP、冻结引用、完整 source/dist 集与实际 archive contents manifest，再按共享政策重算质量，并在原有取消/base/执行身份事务 fence 内发布。

合法 partial 自动发布且旧 Version.summary 明示缺口；required 自动失败、未知/超额最终用量、无效证据或导出失败不能借 partial 绕过。旧 `/api/v1/versions/:id/source.zip` 对 M2 返回同一已验证 archive 字节；legacy 仍是 unverified 导出。恢复仅复制来源 attachment，保留最初验证 Run/report，不新造 Run/验证，恢复后修改需新 Preparation/冻结/报告。

独立门禁：

```sh
pnpm --filter @atoms/contracts check
pnpm --filter @atoms/contracts test
pnpm --filter @atoms/api check
pnpm --filter @atoms/api test:contract
pnpm --filter @atoms/api build
```

`fake-delivery-runtime.ts` 是独立 HTTP 测试替身，实际生成小文件、报告 hash、ZIP 和 contents manifest，但编译/浏览器检查结果是显式 synthetic fixture，不能称实际行为验收；不导入 Agent 或直接改 API 数据库。可用 `pnpm --filter @atoms/api dev:fake-delivery-runtime` 独立启动（需要 `ATOMS_SERVICE_TOKEN`，测试/开发专用）。

根 `pnpm test:delivery --no-web` 将启动临时端口/数据的实际 API + 实际 Agent Runtime/Fake Model，验证生成→修改→恢复→恢复后新修改→重启；它与上述 API HTTP Fake 单测不同。需先由主管集成 M2 Agent；当前脚本已做语法检查，真实跨服务结果在 [M2 状态](../../docs/m2-delivery-status.md) 单独记录。省略 `--no-web` 只额外验证 Web HTTP 可达，不能当 UI 浏览器门禁。

真实分支 `ATOMS_ALLOW_REAL_DELIVERY_INTEGRATION=1 pnpm test:delivery:real --no-web` 仅由主管显式启动，默认不执行；guard 通过后才加载本机根 `.env`，Key 仅传 Agent。该 runner 是三次直接 v1 Run 的真实 Prepare/Worker pipeline，不经过 v2 Router，不称 Router 全链路；最多 24 observable model steps、196,608 有效输入、73,728 输出和三个各 15 分钟 active time envelope，不自动新 Run 重试。源码/日志/fixture 不保存 Key。失败与真实运行保留临时证据目录。

M2 仍依赖受信内部验证器，hash 证明一致性而非远程执行证明；本机干净目录、受控 DSL 不等于 M3 OS/网络隔离或公网分享验收。

主管批准的附加 mixed 入口需另行显式选择：Fake 为 `pnpm test:delivery --no-web --mixed-router`；真实为同时设置 `ATOMS_ALLOW_REAL_DELIVERY_INTEGRATION=1 ATOMS_ALLOW_REAL_DELIVERY_ROUTER=1 pnpm test:delivery:real --no-web`。它仍只有三 Run，第三个恢复后修改改走 v2 auto → delivery-aware Router → Prepare/Worker；另加一次 ask 质量咨询，断言不新增 Run/生成额、实际 outer facts hash 与当前版本质量/缺口对应，保留实际短答供主管 review。两个 Router Turn 独立最多各 3 steps /90s /32,768 有效输入 /8,192 输出（共最多 6 Router steps），不计入代码 Run envelope，也不自动扩调用。当前只完成脚本语法验证，未执行真实模型。
