# Agent repair controller — review candidate, not implemented

This candidate audits the actual Agent at the current baseline. It does not claim the user applications are fixed, authorize inference, or change existing Runs, plans, reports or quota. The next implementation should integrate one stage controller, not present three independent patches as a complete solution. Agent owns execution decisions/evidence; API continues owning authorization, quotas, locks, cancellation and publication. Existing strict wire DTOs stay unchanged for the first implementation.

## 1. Observed failures and current gaps

| Area | Current implementation | Gap proved by this incident |
|---|---|---|
| Preparation | `delivery-planning.ts`: one immutable Preparation, bounded JSON/schema retry under the original child/Run budget, no source writes | Two structured answers can remain mechanically unusable. Safe IR first used `collection_delta.delta=0` to express an initial count; second used `collection:{role:'listitem'}` without the required name. Failures were correctly rejected, but the interface did not offer a direct initial-count recipe or precise missing-name guidance. |
| Generation/repair | `runtime.ts`: generate → verify loop; persistent repair counter/claim and questions; `adapters.ts`: fresh SDK request with complete source/frozen scope and bounded failed-case feedback | Loop policy is mixed with process side effects and exceptions; no persisted stage-decision journal or general source-cycle/no-progress classification. |
| Workspace verification | `delivery-execution.ts`: actual typecheck/build/smoke/frozen browser cases, immutable source/attempt receipts | `browser-dsl.ts` accepts the first matching geometry sample. A transition through the expected position can pass despite a different settled result; success logs omit the measured actual geometry. |
| Export/clean verification | `finish()` runs exact ZIP frozen install/build/smoke/same Plan | This is outside the existing repair loop. Required clean behavior failure immediately throws final `EXPORT_FAILED`, even if the Run has a repair left. Export/clean paths are single-current paths, unsuitable for a multi-round history without preservation. |
| Finalization | Report policy and API independently gate candidate/publication | Agent `finish()` currently writes a completed report before raising blocked; stage failure routing is not a single decision policy. No failing stage may escape into candidate creation. |
| Restart/cancellation | Running external work becomes interrupted; Docker stopping is reconciled before release; no inference replay; waiting questions and accepted queue are durable | Preserve these fences. A controller must not treat a crash as permission to repeat the last provider call or resume partial install/build. |

Read-only user evidence: execution `execution_cea29b2277fe6d03dea0`, frozen movement `(20,0)` tolerance4. A0 measured `(29,203)`; clean measured `(29,174)`. Source uses a29px cell and a50ms left/top CSS transition plus autonomous ticks. A1 has a passed step record without actual samples: it is **not possible to reconstruct its exact successful measurement**. The present first-match algorithm nevertheless has a concrete transient-pass path through20±4 during movement to29. The new controller must distinguish a settled code defect, an unstable oracle and an invalid plan rather than claim this pass proved determinism.

## 2. One controller, separate immutable authorities

Use an Agent-private `RepairController` policy/reducer with typed stage results and one decision journal. Preparation and execution remain two existing immutable requests separated by **API freeze**; the controller does not authorize or perform freeze itself. The same policy module classifies failures and admits next actions in both orchestration paths. No shadow public Run state machine is introduced.

Private stages: `prepare_plan → await_api_freeze → generate → workspace_verify → export → clean_verify → finalize`. The code-repair edge is `workspace_verify|clean_verify → repair → workspace_verify → export → clean_verify`. `await_answer`, `stop_pending`, `interrupted`, `terminal` are controller dispositions, projected into existing public statuses/events. A normal busy generation slot is still a queue condition, not unhealthy isolation; trusted read-only Router stays independent.

Before every effect, persist an intent bound to request hash, controller revision, source hash, Seed/Spec/Plan/binding/toolchain hashes, current budget observation, operation ID and expected prior revision. After stopping/settling the effect, persist its result and next decision. The journal is private technical metadata; existing execution/Preparation ledgers remain authoritative for wire snapshots. Repeated same-body PUT returns the same record; it never invokes a second controller. An unacknowledged model effect is not retried after restart.

The controller emits **one** of: run next local stage; admit one model request/repair; ask an ordinary implementation question; wait for API freeze; stop-and-reconcile; terminal failed/cancelled/interrupted; candidate eligible. Each choice records a static reason and source/evidence references. Model text may propose a diagnosis, never select an authority bypass or set the decision itself.

## 3. Typed stage/failure envelope

Private envelope, reusing wire types for subjects/checks/cases: `{stage, category, sourceHash, bindingHash, specHash, planHash, evidenceRefs, failedChecks, failedCases, observations, stopState, usageCompleteness, retryDisposition}`. `observations` is fixed host-collected data, never arbitrary model diagnostics or executable code. Stage receipt hashes bind full retained evidence; model feedback is a separate bounded projection.

| Failure category | Action under the existing mandate |
|---|---|
| Pre-freeze JSON/IR/schema/finite semantic policy error | Repair the proposal once under the **same** Preparation and original remaining planning/Run budget; aggregate independently inspectable issues. Never silently normalize malformed input. Second failure terminates. |
| Generated source JSON shape | Existing single shared structural retry, known remaining usage/time/steps required. Does not reset code-repair counters. |
| Actual type/build defect or required workspace behavior failure | Same frozen-plan code repair, subject to global repair count and model admission. Use current actual source and exact failed checks. |
| Required clean behavior failure with intact archive/source/binding and install/type/build/smoke passed | Same code-repair loop, **not** a new Run or plan; new source verification and new exact ZIP/clean replay required. |
| Optional behavior failure | Fixed delivery policy may produce partial; do not spend an extra hidden model request. Required functionality remains required regardless of verification method. |
| Unknown/contradictory usage, exhausted budget, cancellation, stop unconfirmed | Stop; no further model or verifier process dispatch. Unknown public totals remain null, independently observed lower bounds stay private/typed. |
| Permission/isolation/hash/source mutation/toolchain mismatch or invalid evidence | Fail closed; not a model repair input. No fallback to host execution or altered trust settings. |
| Registry/install/environment/process availability failure | Report infrastructure failure with safe actionable details; no speculative model repair. Initial controller implementation adds **zero** environment retries. A future local retry policy would need its own explicit bound and same active-time ledger. |
| Transient geometry/unstable baseline or same-source conflicting verification outcomes | Classify nondeterminism, preserve both observations. A model may repair actual deterministic behavior under the frozen scope, but may not weaken expectations or fake a target. Missing test preconditions/incorrect plan assumptions go to plan review, not repeated blind code rewrites. |
| Proven/claimed post-freeze plan invalidity or scope conflict | Never edit Spec/Plan/required/steps. End with an explicit replan-required diagnostic/proposal for host review. It is not ordinary implementation clarification and not automatic budget recovery. |

An observed29px result versus20px expected is a real failed assertion, not by itself proof the plan is invalid. Code may be repaired to satisfy20px if the whole authorized product remains correct. If a valid implementation cannot meet the frozen requirement, the standards must be reviewed explicitly; no proxy or arbitrary hidden test mode may manufacture compliance.

## 4. Actionable feedback and progress test

Each model request receives complete current editable source, exact frozen Spec/Plan once, inherited implementation answers, stage and current failed-case/check observations, prior passing constraints, and a small previous-source delta. Never replay opaque native Worker history. Keep the existing 12KiB repair-summary/64KiB frozen-scope/128KiB complete-prompt bounds. Oversized complete scope fails before inference; do not truncate requirements. Full untrusted logs/screenshots remain evidence rather than being copied into the prompt.

Failure summaries must retain: stage (including clean), source hash, case/step ID, safe locator/actual match count, expected versus actual text/count/box/delta, and whether sampling was stable. The current compact feedback drops the explicit `expected` field and can truncate nested delta values: replace this with a host-allowlisted per-failure schema that prioritizes expected/actual essentials and explicit omitted-detail counts. Compiler errors retain bounded actual relative file/line diagnostics; arbitrary stdout is never authority. Every proposed model repair is checked against this current evidence; a claim of success never skips verification.

Progress is not “a different summary string.” Compare accepted controlled editable-source inventory hashes and failure fingerprints (`stage/check or case+step/expected/actual category`), excluding timestamps/temporary paths. Rules:

- After an initial implementation/repair completes, record before/after hashes and actual changed files. If a repair makes no permitted source change, terminate `no_source_change`; do not rerun the same verifier or spend another model call.
- If it returns to an already failed source hash under the same frozen plan, record `source_cycle` and stop. Never retry a lucky flaky verification of that identical source.
- Same failure fingerprint after changed source records no measurable progress and the observed difference; it never resets budgets. At most the remaining original repair can try a materially different fix; the second identical failure or exhausted repair count stops. One repeated message is not promoted into a successful attempt.
- A repair must run actual workspace verification and, if eligible, a new exact export/clean verification. A successful workspace run cannot erase the earlier clean failure.

## 5. Deterministic geometry and usable planning primitives

These are controller/verifier components, not substitutes for the controller:

1. IR adds generic `collection_count` that expands to existing initial `expect_count` with a literal bounded count. The original delta invariant remains nonzero. Role collection locators still require their real accessible name; precise feedback says which field is absent and lists lawful source-backed label/testId alternatives. No wildcard/empty name or automatic role correction.
2. Geometry `save_box` obtains a bounded continuous stable baseline; geometry assertions require a short continuous stable matching sample window, not any transient intersection. Retain timeout/Run/browser budgets. Record final successful and failed actual/expected samples and stability duration. This is finite observation, not indefinite stability proof.
3. Generic optional explicit `setupActions` are compiled before baseline collection/box capture using existing allowed actions. They execute real declared app controls only: never freeze the browser clock, inject app state, disable timers by instrumentation or synthesize a test-only control. If pause disables the tested movement, that is not a valid precondition. Plan descriptions must state the actual behavioral assumptions; the Worker cannot invent a hidden permissive paused mode to satisfy tests.
4. True entity binding stays required: no markers/proxies; fixed viewport is not the movable entity. Source/DOM identity and sustained gameplay still need appropriate source/browser review. Automatic policy receipt is not arbitrary goal truth.

Existing frozen plans are never recompiled or rewritten by these changes. Old reports and the two user failures remain immutable. Better planning primitives apply only to newly prepared plans; existing code repairs remain under their original exact plan.

## 6. Clean-round evidence and final gate

Preserve each export/clean result in a unique future-owned round directory: exact ZIP, export manifest, clean report, source/lock/toolchain hashes, logs/screenshots and result. Bind round index to the preceding actual source attempt/controller decision. No failure file is overwritten by the next round; all exports are bounded by at most `maxRepairRounds+1` and existing bytes/time budgets. Disposable independent install caches may be cleaned only after complete evidence receipts are sealed; source/ZIP/report/failure evidence remains.

Old strict DeliveryReport has one `cleanBuild`/`exportManifest` pointer. Keep it pointing to the current final clean result. Earlier complete clean-report/manifest/ZIP receipts can be retained as typed existing evidence descriptors (JSON report/ZIP trace with source/spec/plan binding), plus the private controller round index. This supports audit without adding a new wire variant. If Web later needs a first-class clean-round timeline, that is a separately reviewed additive DTO, not a prerequisite for correcting the execution loop.

During an eligible clean failure, persist a **nonfinal** report and failed-clean evidence, then return a typed failure to the controller. Only a final stop creates final blocked. A successful repair produces a new workspace attempt and a new exact archive; all current required cases must pass the new clean verification. Finalization has one common fence: active execution and no cancel, known/in-budget usage, confirmed process stopping, current source hash unchanged, actual toolchain exact, latest attempt valid, latest clean bound to that source/archive, fixed policy admissible, artifact byte limits and event idempotence. Only then emit `artifact.ready`; API still validates bytes/auth/head/fences and publishes. No stage-specific catch may emit a successful candidate.

## 7. Budget, cancellation, crash and migration

No new model allowance: Prepare and Worker still share original Run totals; planning child budget and the original single structured retry stay bounded; code repair remains at most2 and actual model steps/input/output/activeMs remain cumulative. A repair is admitted only after previous requests settled/stopped, known remaining usage, and measured remaining output/time sufficient for another complete request; no mutable-usage alias or unexplained zero delta counts as affordability. Cached input is counted exactly once under existing accounting. Asking an ordinary question does not reset counters; approved original plan does not create a second Run or billable start.

Cancellation wins against late model/verifier/export results. Await SDK disposal and kill/reconcile current stage jobs before terminal/unlock. If a model request was in flight, usage remains unknown; a stopped process does not turn its usage into zero. Broker/Agent crash preserves the pending intent and evidence; on restart reconcile external jobs then interrupt, do not automatically rerun generation, repair or clean install. Existing accepted queue and safe waiting-input handling remain available. Retry of the identical HTTP start observes the original ledger, not a new attempt.

New controller journal version is private. Existing completed/failed reports are read unchanged; legacy in-flight work is not retroactively claimed fully metered or converted to new rounds. Upgrade uses the existing drain → confirm stop → stop services → recheck → full backup gate. No user task or old private receipt is rewritten for migration.

## 8. Plan repair versus replan authority

- **Pre-freeze:** same immutable Seed and same unique Preparation may correct its proposed IR/semantic mapping once within existing limits. API alone validates/freezes the successful bundle.
- **Post-freeze code repair:** same Seed/Spec/Plan/required/steps and current source lineage; only allowed source edits change. This covers ordinary compile/behavior defects, including eligible clean failures.
- **Post-freeze replan:** controller can propose the need and evidence, never mutate the bundle. Minimum implementation safely fails with an explicit reason and uses the existing reviewed-new-task path if the user authorizes a new task under API quota policy. It cannot revive an old Run, reset budgets or treat the unrelated “one credit token continuation” authorization as permission to change tests.

If the product requires an automatic same-credit superseding plan/execution under the same user mandate, this conflicts with the present one-Run/one-Preparation/immutable-wrapper assumptions. API/Agent must first agree an additive authority protocol: semantic scope equality, old stop/late-publication fence, source checkpoint ownership, new IDs/hashes, remaining budget and credit attribution, explicit user confirmation and idempotent supersession. No such authority is silently introduced by Agent. Root/API decide this policy; ordinary question answers cannot change acceptance.

## 9. Implementation and independent acceptance slices

1. Implement pure controller reducer/admission/failure projection + private append-only intent/result receipts; tests across every stage and crash/cancel boundary, no model/browser needed. Integrate existing orchestration without weakening gates.
2. Add usable planning primitives/aggregate feedback and stable geometry/success observations. Real local browser generic regressions: animation transient20→settled29 must fail20±4; true settled20 passes; drifting baseline rejects; actual declared precondition stabilizes; invalid precondition still fails; static collection cardinality works, malformed name/unsupported roles still reject.
3. Route required clean behavior failures through the same controller repair bound. Actual Fake + real host compile/browser/independent ZIP test: workspace pass → real clean-only failure → one actual source repair → workspace pass → new exact ZIP/clean pass. Assert original failed ZIP/report/evidence bytes unchanged and all same-plan hashes maintained. Also actual exhausted repair/unchanged-source repair/install or hash failure → no further model call/candidate.
4. Test full phase-fault matrix: below. Run existing strict contract checks and relevant regression groups, then the full Agent suite/check/build before integration. Root independently exercises actual HTTP API↔Agent, cancellation/restart/quota idempotence. Only after those pass may Root authorize one separately bounded real representative task on new test data; never use the user's remaining quota or replay their terminal Runs without explicit authorization.

| Fault injected | Required observation |
|---|---|
| JSON/schema/semantic invalid; second invalid; insufficient remaining output | One shared structured retry at most; no source writes before freeze; final safe reason/receipts. |
| No source change, source cycle, same failure repeated | Persisted no-progress decision, bounded stop, no verifier/model roulette. |
| Type/build/workspace required behavior failure | Actionable typed feedback; source change; new attempt; same frozen plan; normal budgets. |
| Workspace pass but clean required behavior fail | Failure enters the same remaining repair budget; first clean archive/evidence retained; final current clean and same source required. |
| Clean install/hash/toolchain/isolation/unknown usage failure | No code-repair model call; diagnostic says environment/trust/budget rather than fake code fix. |
| Animation transient, autonomous drift, bad units or invalid precondition | No first-hit green; actual/stability facts preserved; code repair or explicit plan review classified honestly. |
| Cancel at each stage; late finish after cancel; SIGKILL before/after intent/result | Stop reconciliation before terminal/unlock; no late artifact/publication; no duplicate model effect on restart. |
| Same PUT/outbox repeated; waiting answer resumed | Original request/body/counters preserved; no second used charge or hidden inference. |
| All auto pass but required manual 3D/entity review fails | Remains incomplete product acceptance; partial is not manual approval, no “fully accepted” claim. |

## 10. Review decisions requested

The first implementation can use existing wire DTOs/events/evidence routes and is entirely Agent-owned; API/Web need no new business status to correct same-plan clean repair. Coordinate their interpretation of nonfinal clean failure versus terminal failure and preserve existing publication fences. An optional typed public clean-round timeline and automatic same-credit replan are **separate G0 decisions**, not bundled into the stability fix. No model calls or deployment are authorized by this document.
