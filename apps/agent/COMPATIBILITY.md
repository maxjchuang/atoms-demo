# Agent Runtime compatibility and evidence

## Verified baseline

- Runtime: Node 26.5.0 on macOS arm64.
- `@deepseek-ai/dsh-sdk-client`: **0.2.2-rc.1**, which resolves the same-version DSH CLI. DSH requires Node >=24.9.0. Do not use the npm `latest` tag, which currently points at an older SDK release.
- Generated app: React/React DOM 19.1.1, TypeScript 5.9.3, Vite 7.1.12, fixed dependency manifest and Vite config.
- Browser check: Playwright 1.56.1 using installed Google Chrome. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` or install a Playwright Chromium browser on other machines.
- Source protocol: `@atoms/contracts` 0.1.0. No shared contract changes were needed.
- The adapter explicitly selects low reasoning effort for compact structured app generation. Default unbounded/high reasoning exhausted the per-request output allowance with no final JSON in one real integration trial; the runtime reported budget failure and retained diagnostics instead of publishing a false success.

## Executed checks

`pnpm --filter @atoms/agent check` passes.

`pnpm --filter @atoms/agent test:contract` includes six runtime tests plus three structured-output tests, without a model key:

1. Internal authentication, protocol header and missing-key readiness.
2. Installed DSH profile composition rejects unapproved model tools before inference.
3. Real React typecheck, Vite build, headless Chrome load, manifest/hash/file integrity, idempotent start and persisted terminal replay.
4. Plan confirmation, stale revision rejection, answer deduplication, resume and one-time started event.
5. In-flight cancellation and ordered event pagination without publishing a candidate.
6. A real missing-import error, evidence feedback, bounded repair and successful re-verification.

Structured-output tests cover empty/truncated responses, one bounded retry, failure after two malformed responses, and metadata-only diagnostics. A model turn completion alone is insufficient: the adapter checks JSON shape, source allowlist and actual verification.

`pnpm --filter @atoms/agent smoke:real` was run with the locally configured DeepSeek key. It completed Router planning, Worker multi-file React generation, real typecheck/build/browser checks and immutable artifact creation. No Fake fallback was used.

Evidence from that smoke run is outside the repository at:

```text
/var/folders/xk/61y0rx650b1b6pf9wyc5p_tr0000gn/T/atoms-real-smoke-ZnTD4H
```

Artifact ID: `artifact_execution_demo`. The source, built app, check logs, browser screenshot and manifest are under `executions/execution_demo/artifacts/`. Session usage recorded by DSH for this sample: Router 238 input + 542 output tokens; Worker 819 input + 10,184 output tokens. This is a single sample, not a performance or cost guarantee.

After the structured-output and low-reasoning fixes, `ATOMS_KEEP_TEST_DATA=1 pnpm test:integration:real` completed successfully with the real API and real Agent HTTP services:

- Experience-code login, idempotent task creation and plan approval.
- Real multi-file generation, typecheck, Vite build, Chrome load, candidate integrity and API publication.
- Signed preview access and genuine evidence retrieval.
- A second real task adding search using the published source snapshot.
- Immutable restore into a third version, event pagination and API restart recovery.

Complete retained integration evidence:

```text
/var/folders/xk/61y0rx650b1b6pf9wyc5p_tr0000gn/T/atoms-integration-zoIGjh
```

First task: 2 model steps, 1,239 input / 8,751 output tokens. Second task: 2 steps, 4,246 input / 10,616 output tokens. Both completed without structured-output retry or repair in this successful trial. Configured task limits were unchanged. This validates the real API/Runtime integration path; full working-platform UI interaction and public untrusted execution remain separate acceptance work.

An earlier preserved failing trial (`atoms-integration-XhakjA` in the same temporary parent) recorded `finishReason=max-tokens`, zero final-text characters and aggregate output-budget exhaustion. That failure led to metadata-only diagnostics, bounded structured-output handling and explicit low reasoning effort. It was not counted as success or hidden by Fake output.

## DSH integration design

The adapter launches `sdk-minimal` through the official TypeScript SDK. Each Run has separate Router/planning and Worker sessions. They are **not** a persistent project Router across Runs: cross-Run context is supplied by the API's project-memory text and previous source snapshot. Same-Run structured-output retry or repair restores the saved SDK session. The planning role produces a schema-validated plan; the Worker returns structured complete source edits. The host only accepts `src/` TypeScript/TSX/CSS/JSON and `index.html`, and applies them using path validation. Package manifests, Vite config, TypeScript config and dependency resolution remain host-owned.

Before every real session, the adapter composes the installed DSH profile with `config/no-tools.yml` via the official CLI `--dump-config`. It verifies the exact runtime version and every model-facing tool plugin row. `tool-fs`, `tool-working-directory`, `persistent-bash` and `persistent-pwsh` must all be disabled; any unknown enabled tool plugin fails closed. This was tested against the installed distribution, not inferred solely from prompts.

The runtime owns plan-confirmation Attention and HTTP answers; it does not claim to expose all native DSH question/approval features. Source edits are host-applied structured output, rather than unrestricted shell-driven coding. Project-level long-lived free-form Router conversation, native tool-rich Worker sessions and arbitrary user questions are deferred. The API may still pass its project memory summary into each authorized execution.

## Credentials and execution limits

- Real adapter reads a local key and supplies it only to the DSH model subprocess. It does not inherit the whole host environment, and the model-facing shell/filesystem tools are disabled.
- TypeScript/Vite children receive a scrubbed environment containing PATH, workspace HOME and NODE_ENV only. Generated source, artifacts, logs and browser do not receive the model key or service token.
- Fake mode is explicit (`AGENT_MODE=fake`) and result messages identify deterministic sample generation. Default mode is `dsh`; missing credentials return not-ready/503, never Fake success.
- The runtime enforces FIFO execution, actual active-time timeout, waiting-input timeout, repair rounds, artifact size and model-step counters. DSH step/usage notifications accumulate token usage and stop at the next observable boundary when caps are exceeded; an in-flight request can overshoot a token budget. SDK maxTokens caps a single request's output. No absolute monetary hard-limit claim is made.
- Cancellation aborts the adapter, closes the owned DSH process, kills build process groups and closes the browser before the cancellation terminal event. A JSON-RPC timeout is not treated as completed work.
- Event ledger, commands, source events and candidate manifests persist in the Agent data directory. Terminal replay and waiting plans survive restart. External shell/browser processes are not resumed. Startup fences interrupted executions by their immutable execution ID/workspace and reports interruption rather than retrying them as a new run.

## Remaining restrictions

**This stage is for local development and controlled verification, not public untrusted execution.** Build and browser work currently run as scrubbed local child processes; per-task operating-system/container isolation and Linux behavior have not yet passed G5. A working directory and no-tools profile are not substitutes for an OS sandbox. An abrupt process kill may leave an external child needing cleanup even though its old execution cannot publish a new candidate through this runtime.

The browser smoke blocks outbound requests and checks nonempty root plus absence of runtime errors. It does not certify each requested behavior; `behavior` is explicitly `not_run`. Screenshots and logs are genuine checks of generated output, not fake test assertions.

The generated export contains exact dependency versions but does not yet include a generated-app lockfile. Runtime builds use preinstalled trusted dependencies and do not run user-provided package install scripts. Model generation changes and real model cancellation/restart under network failure require further targeted validation; they are not implied by the Fake contract tests.

## Process feedback increment (protocol unchanged)

The feedback increment uses only existing `message.completed`, `file.changed`, phase, check and artifact events. It adds observable action starts/completions for source preparation, the validated plan summary, SDK startup/readiness and model request submission, actual source application, each verification step, and candidate packaging. The SDK is explicitly started before the readiness message; this does not add a model call or expand any execution/repair budget.

File changes are emitted immediately after actual host-applied bytes exist, based on before/after content. New files are `added`, changed files are `modified`, and identical files produce no event. There is no deletion output in the current structured adapter, so no `deleted` event is claimed. A rejected path or failed write must not emit a successful file change.

Verification start feedback precedes the corresponding `check.completed` result. The browser message explicitly distinguishes page-loading smoke from full behavior acceptance. Structured retry feedback is limited to one retry and identifies empty response, output limit or malformed JSON without forwarding model source or reasoning.

The default no-key suite additionally verifies real file-event timing/content/operations, check-start-before-result ordering, plan/packaging feedback and bounded redacted retry reasons. It does not make new real model calls. The previously recorded successful model integration remains evidence for the generation path; this feedback increment has not itself been re-run against a paid model.

The SDK callback still meters observable steps and settled usage; it does not expose hidden reasoning or promise token-by-token final text. During a long model wait, the service creates no artificial heartbeat messages. The UI owns elapsed-time presentation; an elapsed timer or a successful status poll is not evidence of model progress.
