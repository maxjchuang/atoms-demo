# Fixed SDK structured planning: local verification

Scope: `@deepseek-ai/dsh-sdk-client` / runtime / provider **0.2.2-rc.1**, existing `deepseek-official` route and default **deepseek-flash** model. No provider/model/key change, no new real provider request. This document records local composition/serialization and zero-network replay, not a successful live M2 generation.

## Actual transport and supported controls

The installed `@deepseek-ai/dsh-llm-deepseek` describes a **Messages** adapter. Its `PUBLIC_BASE_URL` is the public Anthropic-compatible root, and `serialize()` emits Messages fields. `DeepSeekHarnessOptions` exposes `reasoningEffort` and `maxTokens`; it does not expose Chat `response_format` or Responses `text.format`.

The pinned provider accepts reasoning effort `off | low | high | max`. Its serializer maps `off` to `thinking: {type: "disabled"}` and omits `output_config`; `low` maps to thinking enabled. Preparation now uses SDK `reasoningEffort: "off"` and its isolated `llm-deepseek` profile configuration explicitly sets `thinking: disabled` / `reasoningEffort: off`. Worker reasoning remains `low`; project Router configuration is unchanged.

The actual installed CLI `--dump-config` composes the Preparation provider settings and all four disabled model-tool rows. Startup refuses an incorrect provider row or missing off/disabled settings. A separate test invokes the **actual installed provider adapter** with a local `fetch` interceptor: it captures serialization, then throws before any network I/O. The captured request keeps the same provider/model, `max_tokens: 8192`, and `thinking.disabled`; it contains no `response_format`, Responses `text.format`, or tool activation. This is not a live provider handshake or a claim of strict JSON enforcement by Messages.

Official primary references, checked for this change:

- [DeepSeek JSON Output](https://api-docs.deepseek.com/guides/json_mode/): Chat uses explicit `response_format: {type: "json_object"}` plus a JSON prompt/example; blank or truncated responses still need handling. This Chat control is **not inserted into the current Messages adapter**.
- [DeepSeek thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/): thinking disabled differs from low effort; API spelling varies by protocol.
- [Anthropic-compatible API](https://api-docs.deepseek.com/guides/anthropic_api/): Messages fields must follow that protocol. Generic SDK request extensions are not evidence that an unsupported Chat field will be honored.

## JSON and unchanged authority

The Preparation prompt now includes a **syntactically valid JSON example**, complete steps/coverage fields and delimiter guidance. The example illustrates syntax only: original authorized Seed items, descriptions, required flags and unknown/manual declarations must remain intact. The host still maps aliases, freezes exact hashes and validates the full shared DSL. No silent bracket completion, plan substitution, looser assertion, or reduction of required is performed. JSON mode is not claimed; malformed JSON is rejected by strict parsing.

Structured diagnostics record only role/host ID, stage, finish reason, response length, JSON error class/category/position, remaining numerical budget, interruption category and usage-known status. They contain no raw response, provider exception message, source, prompt, credential or hidden reasoning. Existing native SDK technical storage is not copied into diagnostic/public artifacts. Preparation SDK diagnostics live in `<preparation>/model/model-diagnostics.jsonl`; host retry admission is in `<preparation>/model-diagnostics.jsonl`. Worker diagnostics live in its private DSH home. These private files are not visitor download endpoints.

## Unknown usage and conservative retry admission

New records carry private `usageObservationVersion=settled-request-v1`, a pending native-request fence and usage-known state. Each request must settle observed native model steps and token usage. An interrupted/unsettled request makes **both public input/output totals null**. Private normalized settled lower bounds, including cache read/write, remain numeric and durable; they are never reset to zero or promoted to complete totals. Unknown usage stops further inference and cannot complete/freeze. Crash replay marks a new pending request unknown and interrupted; terminal replay does not infer a second model call.

Historical terminal ledgers/reports (including PMMN5g) remain byte-for-byte unchanged. PMMN5g's recorded 684 input / 5269 output is the first request's settled lower bound; the interrupted second request has unobservable extra usage. It must not be described as free or as an exact combined total.

A structured retry still has a maximum of one and consumes the same cumulative phase/Run budget. Admission now requires known usage, remaining model steps, and remaining active time/output at least as large as the **previous observed request cost**. This is a conservative operational threshold, not a mathematical proof of the minimum tokens/time for any possible valid answer. It uses settled native tokens, never character-based token estimation. PMMN5g replay has 2923 output tokens and about 24.2 s remaining after an observed 5269-token/35.8-s attempt, so it records `retry_skipped` instead of spending a second request.

The current total Run and child planning budgets remain unchanged. No increase is requested before observing the effect of planning-only `off` under a separately authorized bounded live sample. A stricter JSON transport, a provider/model switch, or budget expansion requires a separate supervisor decision.

## Reproduction (zero provider requests)

```bash
pnpm --filter @atoms/agent check
pnpm --filter @atoms/agent exec tsx --test test/model-observation.test.ts test/planning-observation.test.ts test/worker-observation.test.ts test/native-usage.test.ts
pnpm --filter @atoms/agent test:contract
```

The delimiter fixture preserves the observed malformed array/object category and numeric usage facts while removing the original model text, goal and reasoning. Explicit mock SDK factories replay native notifications, cancellation, crash/terminal recovery and completed known usage. The provider serialization test stops at an in-memory fetch interceptor. Neither is presented as a successful paid model response.

Local freeze evidence: Agent check/build and diff whitespace checks passed; contracts check and 80/80 passed; complete Agent no-key suite **61/61** passed (227.9 s), preserving the previous 52 plus 9 observation/profile/replay cases. The focused preparation/Worker/cache group passed 20/20. Full log: `/tmp/atoms-agent-model-observation-full-tests.log`. No paid/remote-provider request was made for this change. A fresh bounded live acceptance, including the actual SDK/provider handshake, remains the supervisor's next decision; no old failed Run/Preparation is resumed.

## DSL schema retry correction after epad1z

The second live attempt accepted the real `off` route and returned valid JSON (one settled step, effective input 817 including zero caches, output 1512, active 7118 ms). Its seven cases/46 steps failed twelve strict DSL field/ID checks. The original failed report is unchanged. That was not a transport error or insufficient budget, and a successful JSON parse was not sufficient to freeze the plan.

`planning-format.ts` now builds the syntax catalog from **shared `BrowserStep`-validated data** and validates the complete example sequence again with `BrowserTestPlan`. Sixteen examples cover all fifteen operations, including both count forms. Locator examples are parsed by shared `LocatorSpec`; role and press-key enumerations are read from the actual shared schemas. Box/drag fields and lowercase variable/baseline rules are explicit. Examples are syntax only, never a replacement for the full authorized goal, original Seed/required fields or semantic coverage.

Only errors produced while validating **model output** become `ModelPlanSchemaError`; JSON syntax and this DSL error share the same existing maximum-one structured retry loop and the same remaining time/step/token budget. Host/Seed authority construction, source artifact authorization, real-file integrity, unknown usage and SDK failures are not converted into retryable format errors. Shared strict extra-field and ID checks are unchanged. The host does not delete tolerance fields, rename variables, invent missing box assertions, weaken required or silently repair a proposed plan.

The next bounded request receives only safe error codes, known field paths, required type/field guidance and sanitized unexpected-field names; it does not receive the original bad response or hidden reasoning. DSL diagnostics use `stage/errorCategory=dsl_schema_invalid`, `SchemaError`, and no transport interruption classification. JSON syntax metadata retains its distinct category. The retry limit does not reset when the error category changes.

The sanitized epad1z shape fixture preserves exactly twelve issues and seven cases/46 steps without the original response/goal/reasoning. Zero-provider tests cover: strict example/shape validation; one mock correction with complete Seed/required/cases and cumulative known cost; insufficient-budget skip; both JSON→DSL and DSL→JSON failure orders stopping after two total requests; and unknown usage/real local input 403/hash failures not retrying. Original failed Run/Preparation IDs and their historical usage are never revived or rewritten.

DSL correction freeze evidence: **five new tests**, total Agent **66/66 passed** (224.24 s), retaining the prior 61. The focused syntax/observation/profile group passed 13/13. Agent check/build/diffcheck and contracts check + 80/80 passed. Complete log: `/tmp/atoms-agent-dsl-schema-full-tests.log`. Model/provider, SDK profile off/no-tools, all Run/Preparation budgets, shared/API contracts and original failed records remain unchanged; additional real provider requests: zero.

## Complete Seed refinement after HaEXjt

The third real attempt used the intended off/profile/catalog and delivered the safe retry feedback intact, but exposed the old adapter's inability to represent mixed automatic/manual subrequirements of one compound Seed. Its original two-step failure remains retained: effective input2993 (including cache1024), output2455, active12587 ms, known usage, no bundle/Worker/version.

Fresh internal model output now explicitly declares derived criteria with source Seed refs; the host preserves canonical Seed criteria, generates opaque leaf IDs and inherits required using the trusted source OR. Each derived ref has exactly one coverage and automatic case edges close both ways. Manual/unsupported leaves cannot own cases. Original Seed text/Goal/required cannot be narrowed or deleted. The shared `delivery-projection` helper supplies only host-owned conservative parent metadata/backlinks and an independently checkable inverse assertion; no step, expectation or leaf method is changed. This does not prove semantic completeness of a model's decomposition.

No model/provider, off policy, budget, JSON-retry count, shared strict DTO or historical result is changed. The syntax examples are still checked against shared DSL schemas. `case_coverage_backlink`/`coverage_duplicate` and related safe static codes retain case/criterion field paths rather than collapsing cross-reference errors into empty-path generic feedback. See DERIVED-CRITERIA-DESIGN.md for the internal envelope and zero-provider captured-shape replay; live success is still a separate supervisor decision.
