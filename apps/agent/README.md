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
