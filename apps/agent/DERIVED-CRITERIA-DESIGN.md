# Internal model criteria refinement (supervisor-decided projection)

This is an Agent-owned model format, not a new shared/public DTO. Existing completed model and host-profile records remain read-only replay data; new model requests use the refined format only after local acceptance. No historical Run/Preparation is revived.

```json
{
  "criteria": [
    {"ref":"r0","description":"A concrete automatic behavior","sourceSeedRefs":["s0"]},
    {"ref":"r1","description":"A concrete human verification item","sourceSeedRefs":["s0"]}
  ],
  "cases": [
    {"ref":"c0","name":"Behavior check","criterionRefs":["r0"],"steps":[{"op":"open_current_app"}]}
  ],
  "coverage": [
    {"criterionRef":"r0","method":"automated","caseRefs":["c0"],"reason":null},
    {"criterionRef":"r1","method":"manual","caseRefs":[],"reason":"This concrete subcriterion needs human verification."}
  ]
}
```

The example is syntax only and does not authorize shallow coverage or substitute for the original goal. Host generates opaque criterion IDs. Derived `required` is the OR of its trusted source Seed items' required flags; the model cannot supply required, IDs, hashes, permissions or optional-source evidence. Every Seed must have at least one derived mapping. Multiple derived criteria may share one Seed, and a derived criterion may cite multiple Seeds. Refs/sources must exist and be unique within their respective lists.

Each derived ref has exactly one coverage entry. Cases refer only to derived refs; case/automated-coverage edges must agree both ways. Manual/unsupported coverage has no cases. Invalid data is rejected with safe static rule codes and case/criterion field paths; the host does not drop cases, merge coverage, rename variables or change manual into automatic coverage. JSON and DSL/relationship errors retain one common structural retry and the original cumulative budget.

## Frozen shared constraint requiring a compatible projection

`FrozenDeliveryBundle` additionally requires a verbatim canonical Spec criterion with the original Seed item ID/description/required flag for every Seed item. It is not enough for the original goal to exist only in Spec.originalGoal and Seed. Spec permits added derived criteria, with a total maximum of 50.

Supervisor-decided compatible projection: retain each canonical Seed criterion and add all derived criteria; project the canonical criterion's coverage conservatively from all mapped derived children. An unautomated child must leave the canonical parent unautomated; only all-automatic children can supply its union of child cases and the required host-owned backlinks. Derived model methods/assertions themselves stay unchanged. Parent projection is metadata, never additional model tests or evidence. Manual required gaps remain partial. If total canonical+derived criteria exceeds the frozen limit, reject rather than remove a Seed.

If a pure-derived wire Spec is required instead, the currently frozen shared validation would need a separately authorized coordinated change. No such shared edit is part of this task.

The shared pure projection/independent check lives in `@atoms/contracts/delivery-projection`. Parent manual has precedence over unsupported, with all concrete child gaps listed in stable bounded summaries. The coordinated shared baseline is now frozen (f79284e / main a1c7c23); Agent consumes the same helper and API integrates it on its own track. No rollout marker is added because upgrade uses a complete nonterminal drain/backup gate.


## Local compiler and compatibility evidence

Fresh model output must contain `criteria`, `cases` and `coverage` in this format. Existing completed `host_profile` and seed-only `model_proposed` snapshots are loaded without invoking the new compiler, reshaping their Spec or changing their ledger bytes. No failed historical Run is revived.

The local mixed-goal fixture contains the six actual notes behaviors (add/edit/delete/search/drag/refresh) as six distinct automatic leaf criteria/cases (31 DSL steps), plus one required human review leaf, all mapped to the single complete Goal source. It forms a valid FrozenDeliveryBundle under the unchanged strict schema. The canonical Goal and human leaf both remain manual/required with visible gaps; synthetic passed-case policy construction remains partial, not complete. This is specification/policy and mock SDK evidence, not a new paid application verification.

HaEXjt's sanitized forms remain rejected: four cases/39 steps mapped to one manual criterion produce four precise `case_coverage_backlink` issues with case paths; six cases/42 steps with duplicate automatic/manual coverage produce `coverage_duplicate` at the conflicting criterion path. In the mock correction, only one retry returns the genuinely split six-behavior-plus-human plan, preserving the complete Goal and inherited required flags. Counters remain cumulative: two mocked steps, effective input2993 (including cache1024), output2455, and caps8192→7062. These numbers replay recorded usage conventions; they are not a new native provider sample.

All field and variable checks remain shared-schema based. Static relationship rules now identify missing/duplicate derived refs, nonexistent or omitted sources, missing/duplicate coverage, forbidden seed refs in cases, absent/reversed automatic edges, and prior-variable type/order. Safe feedback never includes original model labels/descriptions, output text, source values or hidden reasoning. The host does not deduplicate mixed coverage, drop a case, normalize variable names or replace any asserted expectation.

Reproduce locally with `pnpm --filter @atoms/agent exec tsx --test test/derived-criteria.test.ts test/planning-schema-retry.test.ts test/planning-observation.test.ts test/model-observation.test.ts`. No real provider request is made.

Freeze verification: five new Agent tests, total **71/71 passed** (195.88 s), preserving prior 66; focused format/profile/observation group **18/18**. Agent check/build/diffcheck passed; shared contracts check and **86/86** passed (the six new projection tests are already on the separately frozen shared baseline). Complete log: `/tmp/atoms-agent-derived-criteria-full-tests.log`. Actual additional provider calls: zero. Local mock correction and synthetic policy fixtures do not certify a new real plan or generated application.
