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
