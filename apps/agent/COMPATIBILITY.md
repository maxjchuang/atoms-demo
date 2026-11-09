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

The v0.1 execution adapter launches `sdk-minimal` through the official TypeScript SDK. Each Run retains separate planning and Worker sessions; this execution role itself is not a persistent project Router across Runs. M1 adds the separate persistent project coordination service described below. Same-Run structured-output retry or repair restores the saved Worker session. The planning role produces a schema-validated plan; the Worker returns structured complete source edits. The host only accepts `src/` TypeScript/TSX/CSS/JSON and `index.html`, and applies them using path validation. Package manifests, Vite config, TypeScript config and dependency resolution remain host-owned.

Before every real session, the adapter composes the installed DSH profile with `config/no-tools.yml` via the official CLI `--dump-config`. It verifies the exact runtime version and every model-facing tool plugin row. `tool-fs`, `tool-working-directory`, `persistent-bash` and `persistent-pwsh` must all be disabled; any unknown enabled tool plugin fails closed. This was tested against the installed distribution, not inferred solely from prompts.

The runtime owns plan-confirmation Attention and HTTP answers; it does not claim to expose all native DSH question/approval features. M1 additionally produces ordinary Run question Attention from bounded Worker output, preserving its original startup request/hash. Source edits remain host-applied structured output, rather than unrestricted shell-driven coding. Native tool-rich Worker sessions and general external automation remain deferred.

## Credentials and execution limits

- Real adapter reads a local key and supplies it only to the DSH model subprocess. It does not inherit the whole host environment, and the model-facing shell/filesystem tools are disabled.
- TypeScript/Vite children receive a scrubbed environment containing PATH, workspace HOME and NODE_ENV only. Generated source, artifacts, logs and browser do not receive the model key or service token.
- Fake mode is explicit (`AGENT_MODE=fake`) and result messages identify deterministic sample generation. Default mode is `dsh`; missing credentials return not-ready/503, never Fake success.
- The runtime enforces FIFO execution, actual active-time timeout, waiting-input timeout, repair rounds, artifact size and model-step counters. DSH step/usage notifications accumulate token usage and stop at the next observable boundary when caps are exceeded; an in-flight request can overshoot a token budget. SDK maxTokens caps a single request's output. No absolute monetary hard-limit claim is made.
- Cancellation aborts the adapter, closes the owned DSH process, kills build process groups and closes the browser before the cancellation terminal event. A JSON-RPC timeout is not treated as completed work.
- Event ledger, commands, source events and candidate manifests persist in the Agent data directory. Terminal replay and waiting plans survive restart. External shell/browser processes are not resumed. Startup fences interrupted executions by their immutable execution ID/workspace and reports interruption rather than retrying them as a new run.

## Remaining restrictions

**This stage is for local development and controlled verification, not public untrusted execution.** Build and browser work currently run as scrubbed local child processes; per-task operating-system/container isolation and Linux behavior have not yet passed G5. A working directory and no-tools profile are not substitutes for an OS sandbox. An abrupt process kill may leave an external child needing cleanup even though its old execution cannot publish a new candidate through this runtime.

The legacy v1 browser smoke blocks outbound requests and checks nonempty root plus absence of runtime errors. Its `behavior` remains explicitly `not_run`; the separate M2 delivery path below adds frozen behavior verification. Screenshots and logs are genuine checks of generated output, not fake test assertions.

Legacy v1 generated exports contain exact dependency versions but no generated-app lockfile. M2 exports use the independently pinned trusted lockfile described below. Runtime builds use preinstalled trusted dependencies and do not run user-provided package install scripts. Model generation changes and real model cancellation/restart under network failure require further targeted validation; they are not implied by the Fake contract tests.

## Process feedback increment (protocol unchanged)

The feedback increment uses only existing `message.completed`, `file.changed`, phase, check and artifact events. It adds observable action starts/completions for source preparation, the validated plan summary, SDK startup/readiness and model request submission, actual source application, each verification step, and candidate packaging. The SDK is explicitly started before the readiness message; this does not add a model call or expand any execution/repair budget.

File changes are emitted immediately after actual host-applied bytes exist, based on before/after content. New files are `added`, changed files are `modified`, and identical files produce no event. There is no deletion output in the current structured adapter, so no `deleted` event is claimed. A rejected path or failed write must not emit a successful file change.

Verification start feedback precedes the corresponding `check.completed` result. The browser message explicitly distinguishes page-loading smoke from full behavior acceptance. Structured retry feedback is limited to one retry and identifies empty response, output limit or malformed JSON without forwarding model source or reasoning.

The default no-key suite additionally verifies real file-event timing/content/operations, check-start-before-result ordering, plan/packaging feedback and bounded redacted retry reasons. It does not make new real model calls. The previously recorded successful model integration remains evidence for the generation path; this feedback increment has not itself been re-run against a paid model.

The SDK callback still meters observable steps and settled usage; it does not expose hidden reasoning or promise token-by-token final text. During a long model wait, the service creates no artificial heartbeat messages. The UI owns elapsed-time presentation; an elapsed timer or a successful status poll is not evidence of model progress.

## M1 coordination implementation (independent worktree)

`/internal/v2/coordination-turns` implements the frozen `@atoms/contracts/conversation` module with its own 0.2.0 version header, persistent ledger, source event cursor, cancellation and FIFO inference lane. v1 execution DTOs, routes and their strict 0.1.0 header remain unchanged. API remains the only owner of public messages, permission checks, quotas, admitted Runs and version publication.

The real adapter owns a stable project DSH home, metadata cwd and session identity, and explicitly resumes that logical project session across coordination Turns. It reads API-confirmed goals/preferences/decisions with source IDs and revisions on every request; those current facts override historical session statements. A private RouterMemory is a cache of the API's accepted state, never a policy or authorization source. Lower memory revisions are rejected rather than overwriting a newer observed state.

Every real inference begins with a dirty technical session fence. Same-Turn controlled source reading or bounded JSON retry may continue its generation; only a durably settled Agent result can clear the fence. Cancellation, interruption, uncertain failure or a new Turn encountering dirty history selects a fresh generation reconstructed from canonical API memory and bounded committed history. Late commit cannot beat invalidation. Known uncommitted/cancelled messages are excluded from model history and evidence aliases; new memory suggestions may only quote the current trusted user input. API admission/cancellation fences remain authoritative after Agent completion.

The model returns semantic aliases and bounded source-path requests. Host code validates source-message quotes/references and supplies ContextUsed, hashes, actual run revisions, option IDs and version/action IDs. It does not ask the model to invent or copy opaque hashes. Typed proposal refresh is forced to a replacement exact-version proposal at the current host-supplied baseline, not an automatic write. Ask control is downgraded to read-only guidance. No model response directly writes source, cancels a Worker or creates a Run.

Source questions read at most 5 files and 24 KiB from an authorized published artifact through the configured internal API; manifest and file hashes, path allowlists and byte budgets are checked. Active Worker files, service URLs, signed preview URLs and credentials are not model context. Source text is untrusted explanatory data and never grants authority. Model-facing filesystem/shell plugins stay disabled under the same installed-profile policy check.

Ordinary Run questions are limited to two per execution, excluding plan confirmation. Options/text answers are validated, persisted separately and injected into subsequent Worker input; waiting releases only the Worker compute slot while retaining its project lock. Question answers do not mutate the immutable start request/hash or reset accumulated active time, model or repair budgets. A source result is never published while the execution is waiting for an answer.

No-key tests cover both protocols, context integrity, the exchanged independent API/Agent SHA256 vector, share consultation without Worker creation, authoritative memory correction/restart, FIFO, source integrity/access/budget, bound original option questions, read-only control, separate Worker/Router cancellation, late-result fencing and ordinary Run question restart/cancellation/caps. The private session-generation state machine is tested without inference. These Fake tests are explicit deterministic examples, not proof of natural-language classification accuracy or native DSH cross-Turn model recall.

The independent real coordination smoke script is guarded by `ATOMS_ALLOW_REAL_COORDINATION_SMOKE=1` and has not been run in this worktree. Separately, the integrated six-turn **real DSH Router + explicitly Fake Worker** verification has passed, including read-only sharing consultation, preference recording/correction, automatic single-Run admission, ask-mode read-only behavior, and API/Agent restart with persistent native session and canonical memory. See [M1 coordination status](../../docs/m1-coordination-status.md) for the supervisor's acceptance record. This is real project-coordination evidence, not an expansion of the limited real-code-generation G4 subset; complete G4, OS/container isolation and public G5 remain separate unfinished gates.

## Effective input accounting correction

The six native M1 Router reports retained in `atoms-m1-integration-Ty23Ah` exposed the pinned SDK convention: `inputTokens` is noncached input while `cacheReadTokens`/`cacheWriteTokens` are separate components. The historical coordination ledger totals 9,094 input / 1,401 output, but the native reports additionally contain 16,640 cache-read tokens and zero cache writes. Correct effective input is **25,734**, and native `totalTokens` is **27,135**. These are observed token counts, not a currency estimate. Historical completed snapshots are retained with their original numbers, not retrospectively rewritten.

New real Worker and Router callbacks share `NativeUsageAccounting`. For disjoint SDK fields it meters input + cacheRead + cacheWrite against the existing input budget. If totalTokens verifies that a provider input already includes cache, it does not add that component twice. Contradictory/incomplete fields use the larger reported bound, with a conservative accounting classification in private numerical logs. Completely unobservable token components fail closed before further inference/delivery. No character-based token estimate is used.

Only settled assistant/message usage enters the meter; event identity deduplicates replayed/final records, distinct steps remain cumulative, and RunResult summaries are not added a second time. Model-step events are deduplicated separately. Private `token-accounting.jsonl` contains IDs/time, numerical components and accounting classifications only, never raw prompts, source text, model answers or credentials. Public DTOs retain the same fields; new `usage.inputTokens` means total effective input, not just noncached input.

No-key tests use the observed numeric-only six-report fixture and verify noncached/cached/write components, inclusive provider convention, duplicate-event handling, conservative unknowns, and cumulative cached input stopping both Worker planning/generation and Router retry paths. No additional paid sample was requested or executed for this correction; the earlier real sample remains the source of the native convention evidence.

New private execution/coordination records and numerical logs carry `tokenAccountingVersion=effective-input-v1`; this is not a public Schema field. Legacy terminal usage is not rewritten, and old records are not relabeled as if their historical cached usage had been fully metered.

The accounting upgrade requires an explicit drain gate: before shutdown, confirm all legacy executions/coordination Turns that have begun inference are terminal, or finish/cancel them and confirm actual stopping. Stop services, re-check, and back up the whole data directory before upgrade. Do not seamlessly resume a legacy nonterminal inference with an incomplete historical input meter and claim the budget is complete. This patch does not automatically interrupt old tasks or silently reconstruct historical billing; existing waiting/restart behavior for newly versioned records remains unchanged.

## M2 Agent G1 evidence and limits

M2 adds a durable read-only Preparation ledger and immutable execution wrapper, while retaining legacy execution/coordination wire shapes. The actual trusted descriptor hashes the template, package, scripts and portable lock bytes; the host also checks actual Node and pinned pnpm 10.33.0. `model_proposed` planning uses the same pinned SDK/no-tools startup self-check and settled effective-input accounting as M1. Fake planning/Worker mode is explicit. No paid M2 preparation or generation has been performed in this worktree; SDK/schema wiring is not real model acceptance evidence.

Independent no-key checks execute Chrome against six notes cases (add/edit/delete/search/drag/refresh preservation) and two calculator cases using the same generic DSL interpreter. A host-enabled Fake persistence regression genuinely fails the refresh assertion, the Fake Worker rewrites the implementation under the same frozen plan, and the next attempt plus exact-ZIP clean replay pass. The report preserves both actual attempts, source hashes and host patch evidence with `controlled_regression` provenance. This establishes verifier/repair plumbing, not DeepSeek natural defect detection or repair ability.

Clean export tests use actual public dependency installation and actual type/build/browser/behavior execution in a fresh extracted directory, resolving tools from that installation. The exact archive/contents/source/lock/script hashes are retained. Missing-lock archives and wrong frozen bindings fail before installation; a broken calculator archive can pass build/smoke while failing its actual arithmetic assertion. No quality inference treats compilation alone as behavioral success. Partial/blocked quality is derived from the shared fixed policy, with all declared gaps retained; publication remains API-owned.

An independent legacy input service supplies an old v1 artifact without an M2 lock/report. Runtime checks its real manifest/file bytes, loads and retains a user-owned source module, upgrades only the new candidate's trusted package/config/lock, and preserves the original input bytes. The resulting candidate/ZIP carries the retained module and is independently rebuilt/replayed. A mismatched manifest hash stops before Fake source generation and yields no candidate. Existing legacy versions are not retroactively labeled verified or rewritten.

Preparation active time and effective tokens/steps remain cumulative and durable. A failed/cancelled/interrupted preparation cannot silently regenerate or be replaced by another preparation ID for the same Run. Worker budget is exactly total minus measured planning usage; repeated start/approval does not reset it. Router scheduling remains independent. Running model/browser/build processes are not resumed after restart; accepted work can queue and waiting questions remain durable. Interrupted work is fenced with an honest terminal report, not automatically rerun as if no computation occurred.

Known limits remain: local child processes are not per-task containers; Linux/toolchain portability and hostile public execution are not G5-approved. The portable ZIP is independently verified on the reported current platform, not every operating system. Dependency installation needs public registry availability; registry failure is an export failure. Budget enforcement uses observable settled SDK usage, so an in-flight provider response can overshoot; there is no currency hard limit. Complete means the frozen declared plan passed; semantic correctness of model-proposed coverage still requires the original goal/coverage to be visible for review. Source policy rejects unsupported import/asset patterns rather than opening arbitrary filesystem access. No general shell tools, arbitrary model Node tests, plugin marketplace, unrestricted assets or external automation are enabled.

G1 independent verification at freeze: contracts check + 80/80; Agent check/build/diffcheck passed. The full no-key Agent run passed 50/50 (149.6 s), retaining all original 34; the subsequent required-unsupported partial case passed separately. After aligning dist hashes to the candidate's `dist/` prefix, the directly affected HTTP wrapper/legacy input/partial/portable ZIP group passed 5/5 (168.8 s). The final M2 billable-start correction passed the legacy input + bad-manifest case (1/1, 63.1 s) and coordination/plan/pre-meter-cancel/question-restart boundaries (3/3, 3.9 s). There are now **52 tests**; this accounting does not claim a second complete 52-test run. The supervisor performs independent full-track acceptance.

M2 `execution.started` means the first observable adapter model step or settled positive token usage, not source loading or host-only plan confirmation. Those earlier phases still emit real progress and execution/Attention status. Bad input integrity and cancellation before model work cannot claim a billable start. A previously started, persisted ordinary question emits no second start after restart/resume. This changes only M2; legacy v1 timing is retained, and API deduplicates preparation/Worker quota settlement for the same Run.

Retained **Fake model + real local verifier** evidence with final prefixed hashes:

- Controlled failure → repair → clean notes replay: `/var/folders/xk/61y0rx650b1b6pf9wyc5p_tr0000gn/T/atoms-m2-runtime-LaRQEV` (5/6 → 6/6; clean install/type/build/smoke and 6/6; 50 evidence files).
- Legacy input preservation + new clean candidate: `/var/folders/xk/61y0rx650b1b6pf9wyc5p_tr0000gn/T/atoms-m2-runtime-CSsDFg`.
- Required unsupported declarations → honest partial: `/var/folders/xk/61y0rx650b1b6pf9wyc5p_tr0000gn/T/atoms-m2-runtime-v91lVb`.
- Run logs: `/tmp/atoms-agent-m2-g1-tests.log`, `/tmp/atoms-agent-m2-hash-tests.log`, `/tmp/atoms-agent-m2-billable-tests.log`.

Within an evidence directory, `executions/execution_demo/delivery-state.json` holds the sealed report/attempt chain, `evidence/attempt_*/` holds actual checks/case logs/screenshots/controlled patch, and `delivery/source.zip` is the precise independently verified archive. Set `ATOMS_KEEP_AGENT_TEST_DATA=1` to retain equivalent Fake HTTP test evidence; default tests clean their temporary directories. These are local ephemeral paths, not visitor-facing URLs or a claim of paid DSH M2 verification.

## Preparation structured-output / unsettled accounting correction

PMMN5g's first real preparation produced 4899 final-text characters with `finish=stop`, but strict JSON parsing rejected an unclosed array at offset 3185. One bounded retry began and was aborted when cumulative preparation active time reached 60028 ms. The first settled native usage was input 684/cache read 0/cache write 0/output 5269; the interrupted request had no settled usage. The original failed report/ledger is retained unchanged. Its 684/5269 fields are an observable lower bound, not a complete two-request total.

New Preparation/Worker records distinguish a pending native request from fully settled requests. Interrupted request totals become public null/null and private settled lower bounds remain durable, including caches. Unknown records cannot silently continue/freeze; completed known records remain idempotently replayable. Versioned pending-request crash recovery is tested independently from terminal history. Diagnostics add safe numerical/structural categories without response/source/exception-message/hidden-reasoning dumps.

Planning-only off/disabled is verified against the pinned CLI composition and the actual Messages serializer stopped by a local fetch interceptor. A valid JSON syntax example and conservative retry admission were added, without changing model/provider, budgets, Seed/DSL/required or adding JSON repair. No Chat response_format/Responses fields are sent to Messages. These local tests are not a paid M2 success claim. Further live verification remains supervisor-controlled; see MODEL-CONFIGURATION.md.

Correction freeze: Agent complete no-key regression 61/61 (227.9 s; prior 52 retained + 9 new observation/profile/replay cases), focused accounting/planning/Worker tests 20/20, check/build/diffcheck passed; contracts check + 80/80 passed. The actual CLI composition and provider serializer are covered locally without provider I/O. No fresh real success, provider response-format support, or live off/disabled handshake is claimed by these tests. Prior failed execution IDs, immutable request hashes and budgets are not revived/reset.

The epad1z real follow-up confirmed planning off was accepted: one step, effective input 817, cache read/write 0, output 1512, active 7118 ms; valid JSON still failed twelve strict DSL checks (variable IDs and box/drag fields). It remains a failed, blocked, pre-freeze historical report. The subsequent local correction generates schema-validated syntax examples and includes only model JSON/DSL errors in the same single structured retry; it never normalizes an invalid assertion or expands the budget. Permission/hash/unknown-use errors remain fail-closed. Safe DSL diagnostics are explicitly `dsl_schema_invalid`, not `sdk_or_transport`. Local mock correction tests do not imply a new successful real attempt.

DSL retry correction verification: five additional cases bring the no-key Agent suite to **66/66** (224.24 s; prior 61 retained), focused schema/observation/profile checks 13/13, check/build/diffcheck passed; contracts check and 80/80 passed. This is local syntax, mock correction and safety-boundary evidence. No additional real provider request, successful live DSL proposal or G4 completion is implied; the supervisor decides any subsequent bounded real attempt.

Derived-criteria completion freeze: fresh internal model criteria support n:M authorized Seed mapping with host required OR/opaque IDs, while retaining canonical parents and the separately frozen shared conservative projection. Five new Agent tests bring the complete no-key suite to **71/71** (195.88 s; previous 66 retained); focused syntax/profile/observation tests **18/18**; check/build/diffcheck and contracts check + **86/86** passed. Six core notes behavior leaves plus a separate required human leaf form a strict legal FrozenDeliveryBundle and honest partial policy fixture. Both HaEXjt invalid representations still fail with specific rule/path feedback; a single mocked correction genuinely splits the goal without resetting the recorded 2-step/2993-effective-input/2455-output counter. Completed host_profile/seed-only model results replay byte-for-byte without new compilation. Historical failures, providers, budgets and real-call authorization are unchanged; actual additional provider requests remain zero.

The three successful real ryZwrG CodeRuns each had one passed attempt/round0 and no repair. All were partial (manual gaps 3/3/5); their actual automatic cases 7/8/8 and corresponding exact-ZIP clean checks passed on macOS arm64. That acceptance does not close the separate real failed-application -> model-repair gate. An isolated controlled smoke harness is now prepared, with 3/3 targeted local tests and a genuine Fake persistence-failure/repair/clean rehearsal. Its real branch reuses the verified original V4 8-case source and does not claim new model generation for baseline import. Host-only captured profile/fault hooks are optional constructors, absent from ordinary main/env/wire configuration. See CONTROLLED-REPAIR.md for fixed budgets, double guard, lineage/patch evidence, Fake-vs-real case distinction and the unexecuted one-Run real command. Additional actual provider calls for this preparation: zero.

## M3 isolation implementation gates

Docker mode splits trusted model calling, a private minimal Docker broker, and untrusted Linux compiler/browser jobs. Only the broker has the Docker socket. Jobs have no credentials, private home, service data, host binds, host PID/IPC, network, or persistent Docker daemon log file. Actual inspection enforces nonroot watchdog UID 10002 and fixed runner UID 10001, read-only root, cap-drop ALL, no-new-privileges, CPU/memory/swap/PID/time/output limits and bounded tmpfs/inodes. Builder scratch explicitly allows executable native tools; browser scratch remains noexec. Chromium uses `chromiumSandbox:true`; the reviewed official Playwright seccomp profile adds user-namespace operations and `chroot`, without granting outer capabilities. Actual outer chroot/mount remain denied. There is no no-sandbox/unconfined/privileged fallback.

Actual local and independently rerun gates cover policy, sandbox browser with outer privilege negatives, offline Linux install/build and notes DSL, broker-mediated Fake controlled failure→repair→exact ZIP clean, PID/memory/CPU/disk/log limits, synthetic live trusted-plane/peer-job canaries, HTTP Runtime cancellation, broker SIGKILL recovery and Agent SIGKILL recovery. The source remains explicitly Fake in these M3 tests; prior M2 real-model evidence is separate. Capability readiness is not inferred from those prose claims: the private certifier must bind actual evidence to the deployed image/policy/cache, and API publication/cancel fences still require full cross-service integration. Host-local mode always advertises unsafe/not-ready and is never Docker fallback.

Docker containers share the Linux VM kernel. The broker and Docker daemon are privileged trusted components; resource caps and syscall isolation reduce exposure but do not constitute a separate VM per visitor or a production multi-tenant security certification. The fixed cache/toolchain is Linux arm64, Node 26.5.0/pnpm 10.33.0/Playwright 1.56.1; clean evidence must state that platform and offline-store mode rather than claim cross-platform validation.

The original Node idle PID1 did not enforce a hard deadline if the broker remained dead (preserved actual counterexample `atoms-v03-watchdog-18pKya`). The corrected image uses a read-only native PID1 with a BOOTTIME timerfd independent of the caller; actual `atoms-v03-watchdog-WDrweV` demonstrated broker death, denied cross-UID signal/priority/scheduler/memory interference, eight busy worker threads, and exit 124 after the immutable lease deadline. Old proofs remain historical and cannot certify the new image/policy/toolchain.

Linux trusted-Agent DSH startup requires `NARB_DISABLE_NATIVE_CACHE=1` in every host-owned SDK child environment (planner, Worker, project Router). SDK dependency `node-addon-native-custom-loader@0.1.9` otherwise copies its already available native binary into `/tmp`, whose noexec mount prevents dlopen (`failed to map segment from shared object`). The fixed policy loads the original trusted read-only image binary and preserves noexec/rootfs/capability settings. This is a native loader setting, not provider input/cache-token accounting. The original public preparation failure remains terminal with zero observed steps and unknown token totals; it is not rewritten to zero tokens or retried.

Supervisor independently repeated the limited correction: check/build plus seven focused role-environment/planning/Worker-unknown-usage tests passed. The final control image's fresh network-none UID1000/readonly/caps0/no-key-volume handshake returned handshake=true/promptCalls=0 with the four model tools disabled and thinking off. This proves native startup, not a provider request or successful real generation. Original failed public Run/Prepare and nullable usage remain immutable.

R3 `run_179a74e39cf8c9213a81` remains blocked and unchanged. Its old A0/A1 source contents and locator/count/box diagnostics were not retained, so no new snapshot or detailed observation is backfilled for those attempts. Future attempts preserve private source receipts and bounded host-collected browser observations, while keeping all existing frozen step/required/hash and same-plan repair rules. The fixed DSL still clicks/drags the exact declared unique target, with drag starting at its center; diagnostics do not alter assertion semantics. Source snapshot file/byte capacity reuses the existing inventory/artifact limits; over-limit or conflicting receipts fail closed rather than truncate and claim completeness.

Host-only final acceptance for the harness increment: author serial full98/98 (279.4s), prior clean failures replay4/4 (157.4s), check/build passed; supervisor independently passed check/build and the 11-test snapshot/bounded-browser/hook/controlled-clean group (75.4s). The first parallel run coincided with actual host ENOSPC and remains recorded as an environment failure. Dockerfile static permission-layer optimization and the exact final image/cache/role probes are NOT verified: the shared Docker VM now reports I/O error and restart authorization is pending. Earlier image5a/Runtimeo8KQWV is separate prior evidence, not evidence for the final unbuilt recipe. No Provider or new real task was invoked for this increment.
