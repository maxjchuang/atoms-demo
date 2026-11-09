# Unified repair controller — API boundary design

Status: bounded implementation proposal, no new provider authorization. Baseline is the supervisor's current budget/requirements candidate; the existing user service/data is not an implementation sandbox. Agent's `REPAIR-CONTROLLER-DESIGN.md` owns the private decision machine; Web's `AGENT-REPAIR-CONTROLLER-UX-DESIGN.md` owns presentation. This document owns business state, accounting, durable HTTP and publication. The first increment uses existing strict execution/conversation/delivery DTOs. A new M4 protocol is not a prerequisite.

## 1. Observed causes and first increment

The API did not drop the new requests, start both project writers together, or replace a successful version with a template. It correctly refused publication. The actual delivery gap is that a candidate can pass local verification but fail the independent clean check, and the current runtime treats that new, useful failure as terminal instead of routing it back into the remaining same-plan repair budget. A second failure occurred before any Worker because a new plan could not satisfy the schema. These are different phases and must not be presented as “add tokens and retry”.

Implement the smallest coherent loop:

1. Before freeze, the existing unique Preparation may perform its already authorized bounded structured correction. Seed, source identity, total budget and planning share remain immutable; no second Preparation ID can reset spending.
2. After freeze, workspace verification and **required clean-export verification** both feed the same remaining code-repair loop (maximum two repairs, shared Run budget). A clean failure is a nonfinal observation while another repair is allowed. The actual failed checks, source hash and immutable logs become the repair input; model output must produce a real source change before claiming a code repair.
3. Each changed source gets a new workspace attempt, exact ZIP/manifest and fresh clean installation/verification under the **same frozen Spec/Plan**. Old source/attempt/export/clean evidence remains immutable.
4. Publish only the final candidate whose current source, frozen plan, required workspace checks, exact archive and clean verification satisfy the existing API gates. Exhaustion/cancel/interruption/no-progress is a final failure with evidence, not partial success.
5. A post-freeze **plan defect** is not a code-repair opportunity. End or explicitly suspend the original contract with clear `PLAN_REVIEW_REQUIRED` guidance; require an independently reviewed new task. No automatic same-credit replan, new quota, changed required flags/DSL or ordinary-question approval can bypass this.

The controller should classify code failure, environment/tool failure, plan defect, budget exhaustion and unknown cause before deciding. Infrastructure/tool automatic retry is **zero in this increment**: report the bounded operational failure without asking the model to change product code. A future independently approved same-operation tool-retry policy would need its own bound within the same active-time budget and must not be called a source repair or erase a prior failure. Source unchanged + repeated failed verification is no-progress/flakiness evidence, not permission to rerun until a lucky pass. The Agent lane defines the bounded private policy and its tests; API must not invent a classifier from prose.

## 2. Existing API behavior that already supports the loop

- One project owns one writer from dispatch through terminal reconciliation. `latest_on_dispatch` chooses the actual latest successful source when dispatched; exact review has a separate stale-base fence. Router consultation and intent queueing are independent of this writer.
- API persists the one Preparation request/hash before PUT and the immutable execution wrapper before Worker PUT. Repeated PUT uses the same ID/body. Runtime must return stored state for an accepted identity; a network error is not a request to infer again.
- Phase/check/message events can describe repeated generating/verifying/repairing cycles using current enums. Public sequence numbers are API-contiguous; source sequence de-duplication prevents replay on restart. A failed check or a `running` provisional report is not a final Run failure.
- API `loadReport` already accepts higher-revision provisional reports, validates seals/source ownership/evidence and rejects same-revision body changes. Once final, another hash is rejected. Publication requires a terminal successful snapshot, known within-budget usage, a final acceptable report, real candidate bytes and exact ZIP validation, then the current cancel/base/status transaction fence.
- Workspace attempts carry repairRound/previousAttempt and typed source/plan/binding hashes. The existing report holds the final cleanBuild/exportManifest. Earlier clean/export records can be preserved as hash-bound report/log evidence plus factual progress messages in increment one; do not claim that an additional typed multi-clean public timeline already exists.

Code audit also found that higher provisional report revisions currently validate each object seal but do not compare prior sealed attempt/evidence identity contents. Add an append-only prefix/hash guard for already published attempts and retained evidence descriptors; never mutate a sealed failed observation into passed under the same ID. A running round should use progress/check events until its finished observation is sealed. This is an API integrity fix within the current DTO, not a protocol expansion.

Current `Run.checks` is a latest-check snapshot, not a history ledger. Each round must use distinct stable message/evidence/attempt IDs; do not overwrite a previous failure message with “passed”. Historical events/reports/evidence remain the audit trail. The final report may point to the latest source and clean result, but no old final report/attempt may be rewritten or re-labelled.

## 3. Terminal and publication fence

| Observation | API action | Forbidden action |
| --- | --- | --- |
| failed workspace/clean check, report.final=false, execution still running/repairing | Retain active writer/reservation or existing used charge; project real progress | Finish Run, release lock, publish or create another Run |
| new source + new validated nonfinal report revision | Append/materialize its verified evidence | Reuse an old archive/check result as if it verified the new source |
| controller succeeds | Recompute/verify current candidate and exact clean/export bindings; atomic publication | Treat model completion or local-only pass as delivery |
| final exhausted/cancelled/interrupted snapshot + reconciled terminal events/report | Finish original Run under existing stop/status fence | Start a replacement automatically or refund known spent inference |
| transport failure/uncertain PUT/cancel | Preserve same outbox and truthful syncing/cancelling state | Assume stopped, free a writer or replay new inference |

Runtime must emit execution.failed only after deciding that repair cannot continue and owned resources have reached the existing confirmed terminal lifecycle. Intermediate clean failure must not use that terminal event. API cannot repair premature authenticated terminal events by guessing future controller intent. A focused integration test must prove both producer ordering and API lock behavior.

## 4. Accounting and planning failures

A normal Run is reserved on admission and becomes used once at the first authoritative billable planning/Worker start. Read-only planning may consume the one construction allowance even with zero Worker/source output; the UI must distinguish this from a free metadata read. A same-Run repair does not create another reservation, reset modelSteps/activeMs or re-charge the allowance. Cached reads/writes participate in effective input accounting according to the fixed meter policy; settled requests are de-duplicated by their actual identity, with no mutable-before/after alias.

Known API gap: `delivery.finalUsage` is currently populated for executing snapshots but not terminal Preparation snapshots. Persist the actual terminal `snapshot.usage` unchanged on planning failed/cancelled/interrupted; preserve null input/output. Missing metrics must remain missing/unknown, never zero. Do not retroactively backfill existing user Runs or claim an exact chain total with unknown old segments. Root's current reports/usage stay immutable.

The producer already sends a controlled `PLANNING_FAILED + PLAN_REVIEW_V1` count envelope. API validates its finite grammar and emits the existing human Chinese Run/delivery error; private envelope/report/hash stay intact. For final clean failure, derive a similarly bounded human explanation from actual report stage/case counts (e.g. independent clean behavior failed), not arbitrary provider text or private stack traces. Public existing report remains the detailed source. Exact remaining-budget/next-decision fields are not currently provided; do not fabricate them in UI.

## 5. Cancel, restart and no-progress

- Persist each command/phase decision before its side effect. Model request pending/settled, source application, attempt completion, archive completion and evidence publication need distinct private durable checkpoints.
- A model request with unknown settlement after crash is not automatically re-issued. This increment uses only stop/reconcile→interrupted; it does not automatically apply a stored response or resume an interrupted computation. Verified non-inference recovery from an already durable response is a future policy, not implemented or a current acceptance claim.
- Never reset repairRound, model steps, token use, active compute time, environment retry count or archive generation on PUT replay/restart. Waiting for user/queue is not invented active compute; uncertain time/usage cannot support verified publication.
- Cancel owns the actual SDK/tool/browser process group or isolated job; terminal acknowledgement follows stop confirmation. It cannot cancel another project's resources. Lost acknowledgement keeps the API in reconciliation, not false “stopped”.
- Each code-repair decision records previous/new source hash and the actual failure fingerprint. Repeated same source/failure under the bounded policy ends no_progress; changed source still must pass the same tests. Independent clean flakiness must not be hidden by taking the last lucky run.

## 6. Boundary contracts and ownership

No new public DTO is necessary for the first increment: existing nonfinal report revisions, phase/progress/check events, immutable evidence, final snapshot/usage and normal API read/report endpoints suffice. Agent owns the private typed RepairController and decision journal. API owns Run state, exact outbox, quota settlement, scope/source/base/cancel/publication authority and evidence verification. Web renders actual host messages, workspace attempts and final clean case results; it must not infer real repair count from phase transitions or promise a successful outcome.

A later multi-plan-per-Run capability would conflict with today's one-Preparation/immutable-wrapper/single-bundle report. If explicitly required, it needs an independent negotiated version with immutable plan epochs, host authorization receipt linking old failure/new plan, unchanged product scope/required criteria, real remaining budget and all old evidence. It cannot be smuggled into an old DTO or called an ordinary budget continuation. Until separately approved, use a newly reviewed linked task with explicit quota policy; do not automatically mint a free successor, add credits or edit the old plan. Preserving failed source for a **changed-scope** task likewise needs an explicit draft-source authorization path; a failed draft is not a published Version and the same-semantics budget endpoint cannot be repurposed.

## 7. Focused gate matrix for increment one

| Injection / sequence | Required API assertions |
| --- | --- |
| workspace fail→repair→workspace pass→clean fail→remaining repair→both pass | One Run/one used allowance, actual source changes, all attempts/evidence retained, no intermediate version/lock release, one final version |
| required clean fail→repair budget exhausted | blocked final, no publish, source/ZIP/evidence retained; no silent partial downgrade |
| unchanged repair output or repeated failure | bounded no-progress terminal result, no retry until luck/no step reset |
| transient install/tool timeout | Zero automatic infrastructure retries; typed final cause, no model source-repair claim/token offer |
| bad schema before freeze / semantic unusable before freeze | One Preparation/body, bounded correction, no Worker before valid freeze, actual terminal usage/nulls retained |
| plan defect after freeze | old bundle/required/DSL/report unchanged; no code-repair loop against an invalid standard; explicit re-review action |
| cancel during workspace, archive or clean retry | actual stop reconciliation, no late publish; used once if inference occurred |
| API restart/lost PUT or events during a repair | same execution/body/seq, no repeated model/quota charge, lock retained |
| Runtime crash with pending model or completed tool evidence | no blind provider replay, confirmed stop/reconcile→interrupted only; no automatic saved-response recovery |
| malicious/same-revision report rewrite/source/archive swap | API rejects; prior final version/report unchanged |

First API implementation/test scope: (a) persist terminal planning usage accurately; (b) HTTP FakeRuntime stage injection proving provisional failed-clean retains writer and enters another repair; (c) sealed provisional attempts/evidence append-only plus final report/source/ZIP gates remain strict with multi-round evidence; (d) bounded human final-clean failure projection using existing fields. Existing cancellation/restart/sequence regressions run unchanged. No new real model run, data migration, default budget increase or protocol redesign is authorized by this document.

## Appendix: current user project facts (read-only audit)

Consistent DB/WAL/SHM clone only; original source bytes unchanged across capture. Project7b367b9c6a994de9807e has two failed Runs, no Version. R819... was admitted09:21:07, waited for plan confirmation, Worker started09:22:30 and failed09:24:15 after clean behavior4/5 despite local repair reaching5/5. Clean install/typecheck/build/smoke passed and source hash stayed unchanged; API correctly blocked. Final usage records3steps,26,291input,14,292output (including planning1step/1,744input/1,004output).

R11dd... was admitted queued09:22:01, but got its execution only09:24:15.192 after R819 failed; Preparation Seed was created09:24:15.390 and planning began09:24:16.732. It failed schema validation09:24:28 with no Worker. No same-project parallel Prepare froze an earlier empty baseline. Independent Router coordination ran before that, as designed.

R11dd's Seed contains both original user requests (game and automatic control), all required, and explicitly requests a complete new app from empty source. Both use latest_on_dispatch; with no successful predecessor there was no published base to reuse. Falling back to the trusted template is the current policy, not deletion of a successful app. It is less efficient than a separately authorized failed-draft fork, which does not yet exist for changed scope. Each Run was marked started by real planning inference, so this project used2; the same code's total used3 includes the older failed3D Run, reserved0. API lacks persisted terminal planning token totals for R11dd, so no zero-token claim is valid.
