# Parallel development rules

Read `docs/architecture.md`, your interface document, and `docs/parallel-plan.md` before implementation.

- `apps/web` owns presentation, view state, API client, and Mock API. It must not import backend or DSH implementation.
- `apps/api` owns public HTTP, identity, project authorization, quotas, queue, business state, persistence, publication, and Fake Agent.
- `apps/agent` owns the internal execution HTTP service, DSH adaptation, sessions, isolated workspaces, verification, and immutable candidate artifacts.
- Shared wire contracts live only in `packages/contracts`; do not duplicate status enums, event types, or DTOs.
- Run contract checks plus your track's tests before integration. No real API key is required for ordinary unit or contract tests.
- Never store model keys in fixtures, generated applications, browser bundles, or workspace snapshots.
- A DSH turn completion is not application verification or version publication.
- Independent development must use separate worktrees or disjoint owned paths. Protocol changes require a coordinated contract commit and matching fixture/test changes before consumers update.
- Do not change another track's implementation to make your tests pass; report the incompatible contract or coordinate the fix.
- Do not expose DSH management, raw runtime endpoints, Docker socket, arbitrary host paths, or model credentials to visitors.
