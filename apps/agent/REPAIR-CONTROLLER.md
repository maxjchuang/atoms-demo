# Unified Agent repair controller

Implemented for delivery Preparation/execution without changing public strict DTOs, quota or authorization. Design baseline: [REPAIR-CONTROLLER-DESIGN.md](./REPAIR-CONTROLLER-DESIGN.md). Historical failures and user applications are not rewritten. These regressions use synthetic/Fake adapters plus actual host tools; they do not prove a new real-model task succeeded.

The typed stage/result policy is connected to readonly planning, frozen-plan validation, generation/repair, workspace verification, exact export/clean verification and finalization. Native counters remain authoritative. Intent/result records live in the same fsynced atomically replaced ledger as those counters/events, with request/source/Spec/Plan/binding/toolchain hashes, used/remaining budget observations, failure fingerprint, evidence references and decision. Execution observations count whole-Run planning+Worker usage; Preparation observations use its bounded child budget. Unknown token totals stay null. Expected revision, effect pairing, permitted stage transitions, immutable subject, hash chain and folded pending/failure caches are checked; a pending effect cannot be replayed after restart.

Required code/behavior failures and sound clean-export behavior failures share the original same-plan repair count. Actual missing compiler/browser/install tools, unknown verification causes, trust/hash/isolation failures, cancellation and unknown usage stop without asking the Worker to guess an environment fix. An unchanged-source repair may wait for implementation details before stop only when original repair/model allowance remains. A return to a different already failed source, exhausted allowance, unknown usage or an existing terminal stop cannot be revived through that question. Repeated failure fingerprints exclude transient geometry/timestamps; none resets the budget. Repair feedback retains stage, expected/actual essentials and all failed-case identities within the existing context limits. Every repair receives fresh complete source and exact frozen scope, not native conversation replay.

Every clean round preserves its exact source ZIP, export/clean report and logs/screenshots under a unique round path. Final typed report points to the current clean result; historical JSON/ZIP remain bound existing evidence. ZIP traces are omitted only from the older v1 evidence index whose enum cannot represent them; full manifest file hashes and DeliveryReport typed descriptors retain them for authenticated audit. No kind is relabeled to disguise ZIP content. Candidate creation has a single source/dist/evidence/known-usage/cancellation fence; API independently validates and publishes.

Geometry baselines and assertions require a continuous stable120ms window (bounded by the unchanged step/Run deadlines), not a transient passing sample. Success evidence includes actual delta/stability. A frozen geometry timeout below160ms is unobservable under this policy: validation fails `replan_required`/`PLAN_INVALID` **before any Worker**; it is never treated as a source defect consuming two repairs. No old plan is changed. Newly compiled recipes keep the existing5000ms host-owned step timeout. Generic `collection_count` expands to existing literal `expect_count`; `setupActions` before geometry/collection baselines execute only real declared controls, never alter browser time/app state or fabricate a valid paused mode. Missing role names remain strict errors. No general semantic detector proves entity identity, exact plan correctness or sustained3D gameplay; manual required product acceptance remains separate.

## Zero-Provider HTTP fixture

Fresh synthetic Agent service for a separate API instance:

```sh
env -u DEEPSEEK_API_KEY -u DEEPSEEK_API_KEY_FILE pnpm --filter @atoms/agent exec tsx test/helpers/launch-controller-agent.ts --port 15410 --api-internal-url http://127.0.0.1:15401
```

It prints only address, fresh fixture/data directory and owner600 service-token **file path**, never the token. Configure the independent API with that token, Agent URL, and `model_proposed` planning; use this actual public task text: `Render decimal 1.5 with fixed en-US convention regardless of browser language.` Public requests remain the normal create-project/Run APIs; the service adds no production debug endpoint. The fake planner freezes that exact explicit decimal convention. Initial authored code uses ambient Intl locale: workspace passes, actual clean browser fr-FR displays1,5 and fails; Fake repair changes the actual formatter to explicit en-US, then new workspace/exact ZIP clean pass. The controlled locale is constructor-only, Fake-only, no env/wire activation. This is a controlled environment/repair regression, never a natural model defect claim.

Negative fixtures: append `--scenario no_change` (second Worker returns identical source; when original repair/model allowance remains, an implementation question is raised before stop; no additional verification/export occurs while waiting) or `--infra-failure` (actual browser executable absent; one Worker, infrastructure stop). Cancel through the API while verification/install is active to check no late candidate. Stop with Ctrl-C/SIGTERM; metadata prints Worker calls and retained evidence path. Restart only the launcher's own owner-checked temp fixture with `--resume-fixture <printed fixtureRoot>`; configuration and synthetic token are preserved, running work is interrupted, no model effect replayed. Existing user data paths, nonsynthetic token files and Provider environment are refused.

## Independent regression commands

```sh
pnpm --filter @atoms/agent exec tsx --test --test-concurrency=1 test/repair-controller.test.ts test/controller-restart.test.ts
ATOMS_KEEP_AGENT_TEST_DATA=1 pnpm --filter @atoms/agent exec tsx --test --test-concurrency=1 test/controller-clean-loop.test.ts
pnpm --filter @atoms/agent exec tsx --test --test-concurrency=1 test/controller-geometry.test.ts test/verification-diagnostics.test.ts
# From apps/agent: full serial suite
pnpm exec tsx --test --test-concurrency=1 test/*.test.ts
```

API/Agent HTTP integration, publication/quota/restart fences and any subsequent real-model verification remain supervisor acceptance gates. No automatic same-credit replan/supersession or new browser permissions were introduced.

## Safe diagnostic dependency graph

Known controlled-source TypeScript code errors no longer hide independently obtainable diagnostics. After trusted configuration/source checks, TS runs first. An infrastructure/global/unknown TS failure stops. A recognized source-code error remains a failed required gate, while the verifier deletes only the current candidate's old dist and attempts a fresh Vite build. Only a successful current-source build permits smoke; only usable smoke permits frozen behavior diagnosis. Failed build, cancellation, trust failure or unknown infrastructure never runs old dist. Compiler and observed case failures enter one bounded private feedback envelope (`repair-feedback-v2`); required type/build/smoke gates must all pass on the repaired current source before export/publication. Already observed required diagnostic behavior failures cannot be washed into not_run. This is a dependency graph, not blind parallel execution or a relaxed delivery policy.

Generic regressions in `verification-dag.test.ts` actually produce simultaneous TS+browser faults, repair once using both observations, and pass a new independent ZIP; type failure with passing behavior still blocks. Stale-dist/build failure, infrastructure and cancellation paths stop honestly. `geometry-boundary.test.ts` and `frozen-geometry-boundary.test.ts` cover setup versus one measured effect, unchanged legacy-plan refusal with zero Worker calls, and existing drag/press/reload compatibility. These are synthetic host-tool proofs; the failed real task remains failed and is not certified by them.
