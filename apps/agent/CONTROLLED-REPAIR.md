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

Real mode requires **both** the process env guard and `--real`. Credentials must already be in process environment or the guarded checkout `.env`; missing credentials fail without Fake fallback. Never place the key in command arguments. The following is a reviewable command for the supervisor; it has not been executed by this implementation agent:

```bash
ATOMS_ALLOW_REAL_CONTROLLED_REPAIR=1 pnpm --filter @atoms/agent smoke:controlled:repair -- --real \
  --base-artifact '/var/folders/xk/61y0rx650b1b6pf9wyc5p_tr0000gn/T/atoms-m2-delivery-ryZwrG/agent/executions/execution_4e095f6110983813c94d/artifacts/artifact_execution_4e095f6110983813c94d' \
  --base-version version_b7c360e659a778d45caa
```

The real loader/lineage was checked read-only locally and returned the original 8/70/15 unchanged. **No actual real repair request has been made for this gate yet.** The supervisor reviews and authorizes exactly one bounded invocation separately.

## Local evidence, distinct from the real 8-case gate

Fake rehearsal uses the explicit deterministic notes fixture: **6 cases**, not V4's 8. Source origin is `fake_fixture`, final adapter is `fake`, and its step is synthetic. It proves local wiring, true browser failure, provenance, same-plan retry and clean replay; it does not prove DeepSeek repair ability.

- Initial CLI rehearsal accepted: `/var/folders/xk/61y0rx650b1b6pf9wyc5p_tr0000gn/T/atoms-controlled-repair-6id8di` (active 62386ms; 1 synthetic step; persistence-only failure -> 6/6 -> clean 6/6).
- Targeted test accepted: `atoms-controlled-repair-K9OkuG`; invalid-baseline negative: `atoms-controlled-repair-wgCrD7` (one failed Run, no model start/replacement).
- Logs: `/tmp/atoms-controlled-fake-first.log`, `/tmp/atoms-controlled-repair-local-tests.log`.
- Targeted tests: **3/3 passed**, including both guards/no credential access, constructor/wire isolation, actual Fake browser failure/repair, unchanged plan/required, exact source/patch/ZIP hashes, no secret sentinel in ZIP, one Run/zero Router and failed-baseline no replacement. Existing 71-case gates were not redundantly rerun for these optional hooks.

Inside each new output directory: `controlled-context.json` binds original/new identities and hashes; `agent/executions/<id>/controlled/{base,injected}/source/` holds exact source copies; `controlled/baseline-evidence/` holds original-case preflight; `evidence/attempt_0/controlled-patch.json` is the patch bound by `patchHash` and attempt provenance; normal delivery-state/report, attempts, screenshots/logs and `delivery/source.zip` are retained. Source originals remain read-only. Verification currently proves the reported macOS arm64 toolchain only; M3/OS sandbox and public hostile execution are not part of this gate.
