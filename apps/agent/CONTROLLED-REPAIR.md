# Single-Run controlled repair gate

This tool is an isolated validation harness, not an application feature or a new API endpoint. It does not modify the existing three real CodeRuns, original reports, source artifacts, project API database, Router sessions or live services. No general fault framework or additional fault modes are provided.

## Source and plan boundary

The real branch reads the reviewed V4 **public artifact/source/report only**. It verifies the manifest and every listed file's exact bytes/hash, report and inner-object hashes, matching source inventory, original real `model_output/dsh` provenance and original clean-pass metadata. It refuses Fake or previously controlled baseline reports. The source-version label is supplied by the trusted operator; the source bytes are bound by the original report/source hash. It does not read the old native home, hidden reasoning, API database or model credential.

The reviewed real baseline is:

- `version_b7c360e659a778d45caa`, original execution `execution_4e095f6110983813c94d`.
- Source hash `f5018b6fbae5d627d66ce42617dae6123df0521d583b2d52ff572f9e484fa225`.
- Original report hash `36cc91c2d8cdac35d4f6340c43a256d088891486b4a40f13c616ebcac23fa75b`.
- Original plan hash `b81dd3b8e42041344a132cb30dfe2870b30b556f471ac78a370a9ad13228aa17`.
- **8 cases / 70 steps / 15 required criteria**, including the explanation-text case and all original add/edit/delete/search/drag/refresh assertions. Nothing is replaced with the smaller Fake profile.

The isolated new context keeps the complete Goal, Seed items/source refs and all required flags. Its wire planning mode is the existing **host_profile**. Only necessary new Run/Seed/Spec/Plan identities, timestamps, origin and hashes are rebound; original `cases`, `steps`, expectations, parameters, `coverage` and `criteria` are compared exactly. A constructor-registered captured profile has a fixed hash bound to the source/report/plan/version. No provider step is invented for this host preparation.

## Actual failure and repair

The existing constructor-level adapter injection wraps the normal delegate. Initial input source loading is explicitly host work: it emits no model meter/start and does not claim a new model generation. Two optional trusted constructor callbacks bind the captured host profile and the one source fault. They are not wired to `main`, environment settings or HTTP/model DTOs. The source-baseline wrapper refuses use without controlled provenance.

Within the actual Run active-time budget, before fault injection, the original source must first pass real type/build/smoke and **all captured cases**. If it does not, the Run stops; the harness does not repair it or create a replacement. Baseline evidence is stored separately under that new execution's `controlled/baseline-evidence`, with source/plan hashes and zero model requests. Fake fixture authoring is an explicitly separate bounded host setup before the Run; it is not billed as provider work.

The single reviewed fault prepends an import to `src/main.tsx` and creates `src/atoms-controlled-fault.ts`. This module executes before app imports and replaces localStorage with a write-no-op proxy, without changing the original reads or React state. Both setItem and property writes are suppressed. The patch does not depend on component/function names. Exact base and injected source bytes, both edits' before/after bytes and hashes, origin V4/report/source/plan and new frozen-plan hash are retained. The initial attempt is `controlled_regression`, not a natural model defect or a new DSH-generated baseline.

The real browser must fail persistence/reload cases while basic gates and unrelated captured cases pass. Only then does the normal **deepseek-official / deepseek-flash DshAdapter**, Worker low, receive the actual failed-check facts and current sources. The host never removes the fault in real mode. The model must repair the source and remove the marked fault behavior/marker; an empty unused module is permitted because the structured adapter has no delete operation. Tests/required/plan hash remain fixed. The final model-output/dsh attempt must pass **all original 8 cases** and the exact ZIP must independently install/typecheck/build/smoke/replay those same cases. Existing manual gaps remain partial rather than being relabeled complete.

## Fixed limits and failure behavior

One invocation creates exactly one new Run/execution, one host preparation, zero Router Turns, and no published business Version. Initial source import is not a fake provider step 0. Actual repair steps/settled effective tokens and active resource time are accumulated by the existing Runtime; unknown usage fails closed. Limits remain **8 steps / 65536 input / 24576 output / 900000 active ms / repair <=2**, with the existing bounded structured retry. No phase resets a budget. Failure retains the isolated evidence and exits nonzero; it never automatically creates a replacement Run.

Ordinary service defaults are unchanged. No real fault flag or test hook is exposed through wire or model input. The harness uses a fresh loopback-only input service/bearer and fresh Agent data directory, then stops both. Model credentials are supplied only to the real adapter, not generated files, verification/install/browser children or result JSON.

## Commands (operator-controlled)

Local Fake rehearsal, **zero provider calls**:

```bash
pnpm --filter @atoms/agent smoke:controlled:repair -- --fake
pnpm --filter @atoms/agent exec tsx --test test/controlled-repair.test.ts
```

Real mode requires **both** the process env guard and `--real`. Credentials must already be in process environment or the guarded checkout `.env`; missing credentials fail without Fake fallback. Never place the key in command arguments. The following command was executed exactly once by the supervisor after independent review. It is retained for audit, not an instruction to rerun automatically:

```bash
ATOMS_ALLOW_REAL_CONTROLLED_REPAIR=1 pnpm --filter @atoms/agent smoke:controlled:repair -- --real \
  --base-artifact '/var/folders/xk/61y0rx650b1b6pf9wyc5p_tr0000gn/T/atoms-m2-delivery-ryZwrG/agent/executions/execution_4e095f6110983813c94d/artifacts/artifact_execution_4e095f6110983813c94d' \
  --base-version version_b7c360e659a778d45caa
```

The real loader/lineage was checked read-only locally and returned the original 8/70/15 unchanged. **The supervisor executed the single bounded real gate successfully.** Its independently audited result is recorded below. No replacement Run, Router or additional provider request was created by this implementation agent.

## Local evidence, distinct from the real 8-case gate

Fake rehearsal uses the explicit deterministic notes fixture: **6 cases**, not V4's 8. Source origin is `fake_fixture`, final adapter is `fake`, and its step is synthetic. It proves local wiring, true browser failure, provenance, same-plan retry and clean replay; it does not prove DeepSeek repair ability.

- Initial CLI rehearsal accepted: `/var/folders/xk/61y0rx650b1b6pf9wyc5p_tr0000gn/T/atoms-controlled-repair-6id8di` (active 62386ms; 1 synthetic step; persistence-only failure -> 6/6 -> clean 6/6).
- Targeted test accepted: `atoms-controlled-repair-K9OkuG`; invalid-baseline negative: `atoms-controlled-repair-wgCrD7` (one failed Run, no model start/replacement).
- Logs: `/tmp/atoms-controlled-fake-first.log`, `/tmp/atoms-controlled-repair-local-tests.log`.
- Targeted tests: **3/3 passed**, including both guards/no credential access, constructor/wire isolation, actual Fake browser failure/repair, unchanged plan/required, exact source/patch/ZIP hashes, no secret sentinel in ZIP, one Run/zero Router and failed-baseline no replacement. Existing 71-case gates were not redundantly rerun for these optional hooks.

Inside each new output directory: `controlled-context.json` binds original/new identities and hashes; `agent/executions/<id>/controlled/{base,injected}/source/` holds exact source copies; `controlled/baseline-evidence/` holds original-case preflight; `evidence/attempt_0/controlled-patch.json` is the patch bound by `patchHash` and attempt provenance; normal delivery-state/report, attempts, screenshots/logs and `delivery/source.zip` are retained. Source originals remain read-only. Verification currently proves the reported macOS arm64 toolchain only; M3/OS sandbox and public hostile execution are not part of this gate.


## Actual real result, independently audited

Supervisor session31856 exited0/accepted. Isolated evidence root: `/var/folders/xk/61y0rx650b1b6pf9wyc5p_tr0000gn/T/atoms-controlled-repair-8tSEg2`.

- New Run `run_controlled_446a4f19249e41aca2183a`, execution `execution_controlled_a684df287f0244fb9b7893`, preparation `preparation_controlled_08c07082433a4adeb732d2`; exactly one execution and zero Router Turns.
- Original V4 Goal, all Seed items, Spec criteria, required flags, cases/70 steps and coverage compare equal to the original report. All **8 cases / 15 required criteria** remain; this is not the six-case Fake fixture. Only legal metadata rebind changes the original plan hash `b81dd3b8e42041344a132cb30dfe2870b30b556f471ac78a370a9ad13228aa17` to frozen `da0bc554e5ab9d931b42523d4dd1c6208ac1dad3a087504673cc9786a80d8321`.
- Host pre-fault baseline passed all 8 original cases with zero new model requests, under the Run's active-time budget. Base source inventory equals original V4 `f5018b6fbae5d627d66ce42617dae6123df0521d583b2d52ff572f9e484fa225`.
- Attempt0 is explicitly **controlled_regression**: type/build/smoke pass, six unrelated cases pass, and only refresh-persistence cases `case_7` (step_7_6) / `case_8` (step_8_9) fail. It is not a natural model defect or a new model-generated initial application.
- The two-edit patch is 2464 bytes, SHA256 `121777143aa155abb925a2c2ef68da0aa6718054bc91c4acb8e8fc15c3ce1659`. Exact base/injected source copies and each edit's before/after hashes match independently. Injected source inventory is `c944081789e8416e5caf2cc653e4e3750f0a4ea5bcc9e95855a388bdac48ec53` and matches attempt0's actual source hash/provenance.
- After the one real Worker step, file events record actual model-applied edits to main, fault module and App. Attempt1/repairRound1 is **model_output/dsh**, all basic gates and all 8 cases pass. The host did not remove the real fault. Both attempts retain identical frozen plan/spec hashes and stable source before/after each verification.
- Exact final ZIP independently installs/typechecks/builds/smokes and replays all 8 cases. ZIP SHA256 `b142d0c2aae25ee838e9d874ace4610db2dd45abae7e3cfd501116e68b92630d`, 14723 bytes. Every archive file fingerprint, exact contents-manifest bytes/hash and final source inventory were independently rechecked; no fault marker remains. Final source hash is `4289f7eddb75613c15d0cb87b43227263373134dfdcc749aef42ba5888f58816`.
- Native settled usage: **1 step**, noncached input9675 + cacheRead256 + cacheWrite0 = **effective input9931**, output4842, native total14773. `requestSettled=true`, unknown input/output samples0, private/public usage known, pending=false. Total active102861ms includes host verification/repair/export; no budget reset or expansion. No provider step0 is fabricated.
- Final report hash `3980ef07ed9f8ef554c7c1d0d6a62bf61313f1751a697b9849d2551cdbe5d6a3`; quality remains **partial**, with original human-required gaps unchanged. This gate proves controlled real repair under the frozen plan; it does not certify all subjective/framework requirements or a natural-defect sample.

Read paths under the evidence root: `controlled-context.json`, `controlled-result.json`, `agent/executions/execution_controlled_a684df287f0244fb9b7893/delivery-state.json`, its `controlled/baseline-evidence/baseline-summary.json`, `controlled/{base,injected}/source/`, `evidence/attempt_0/controlled-patch.json`, normal attempt logs/screenshots and `delivery/source.zip`; native numeric usage is `agent/dsh/project_ad7a08e8a7b7b839befc/token-accounting.jsonl`. No key, native reasoning or original source text is reproduced here.

The original V4 report remains hash `36cc91c2d8cdac35d4f6340c43a256d088891486b4a40f13c616ebcac23fa75b`; all original three real CodeRun records and earlier failed attempts remain untouched. Verification is still only the reported macOS arm64 environment with Node26.5.0/pnpm10.33.0. Docker/Linux/OS sandbox, public hostile execution and M3 remain unproved by this repair gate.
