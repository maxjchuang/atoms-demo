# Backend: public API and version delivery

Node/Fastify service implementing the v0.1.0 public protocol. The API owns identity, quotas, project locks, durable task state and final publication. It talks to the Agent over authenticated HTTP; no DSH implementation is imported.

## Start

Use the root `pnpm dev:demo` for an explicit Fake DSH integration, or `pnpm dev` with the root `.env` configured for real DSH. The root launcher supplies ports and service credentials without printing them.

To run the API independently, configure the variables in `.env.example` in the process environment:

```bash
pnpm --filter @atoms/api start
```

Entrypoints read environment variables; they do not automatically read `apps/api/.env`. The root launcher reads the root `.env`.

Default endpoints:

- Workspace: `http://localhost:5173`, with `/api` proxied to API port 3001.
- API: `http://localhost:3001`.
- Preview: `http://127.0.0.1:3002`, intentionally a different hostname from the workspace.
- Runtime: `http://127.0.0.1:4100`, internal only.

Different ports alone do not isolate cookies. Open the workspace using **localhost**, with preview using **127.0.0.1**. Preview is a separate static-only server and has no API proxy.

`ATOMS_ENABLE_DEMO=true` and `ATOMS_DEMO_CODE` explicitly provision a local development access code. Defaults are disabled; production rejects demo seeding. The root local launcher enables this intentionally. No code is printed by the seed script.

Supported aliases: `ATOMS_SERVICE_TOKEN` / `INTERNAL_SERVICE_TOKEN`, `ATOMS_ALLOWED_ORIGINS` / `ALLOWED_ORIGINS`, `PREVIEW_PUBLIC_URL` / `PREVIEW_ORIGIN`, `API_DATA_DIR` / `ATOMS_DATA_DIR`.

## Independent verification

```bash
pnpm --filter @atoms/api check
pnpm --filter @atoms/api build
pnpm --filter @atoms/api test:contract
```

Tests start an actual Fake Runtime HTTP listener and a temporary SQLite database; public requests use Fastify injection. No model key, DSH, browser UI or external model request is needed.

Covered: session/ownership, quota reservation, idempotency, plan confirmation and answer delivery, same-project serialization, cancellation versus late success, response loss after acceptance, event paging, manifest/file hash validation, signed preview, source and evidence access, immutable restore, and API restart reconciliation.

The Fake Runtime is explicit synthetic test infrastructure. Its check reports are labelled fixtures; they are not compiler or browser evidence. Real Runtime + Fake DSH integration separately verifies actual compilation and browser smoke.

## Persistence and recovery

`node:sqlite` stores an atomically persisted JSON state snapshot in `api.sqlite`; one API process owns this database. The initial database schema is created on startup. This deliberately simple first implementation is not a multi-process queue or normalized production schema.

Task creation, quota reservation and dispatch intent persist together. Runtime PUT retries use the same execution ID. Source events are ingested in sequence and projected to project events. Successful artifact files are downloaded to a staging directory, checked against manifest hashes and moved into immutable version storage before the publication transaction.

API restart replays existing execution IDs without repeating model execution. Unreachable Runtime keeps its project lock; the API does not claim that unavailable execution has stopped.

## Security and current limits

- Experience codes and session tokens are hashed. Idempotency records for login retain the issued Set-Cookie value to support exact retries; protect the local database and data directory.
- Mutations check Origin/Fetch Metadata, idempotency and ownership. Login is rate limited per remote IP. Generation quota and Runtime budgets are separate controls.
- Internal artifact endpoints require a service token and are not intended for public routing.
- Artifact publication rejects forbidden paths, missing required checks, missing evidence, oversized files and hash mismatches. Source exports omit environment/credential directories.
- Preview uses HMAC-signed version paths and restrictive response headers. It does not grant access to workspace APIs.
- The queue, rate limiter and scheduler are single-process. Do not run multiple API replicas against the same database.
- Cursor pagination is suitable for the small demo dataset; large mutable histories require indexed keyset pagination.
- Production Docker/network boundaries and public tunnel access require the separate deployment gate; running this local service does not certify sandbox isolation.
