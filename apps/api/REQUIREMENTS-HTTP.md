# Cumulative requirements: independent HTTP exercise

This is a local synthetic HTTP exercise, not a provider, compiler/browser or public isolation proof. Use fresh scratch data and unused ports; do not point it at5180, private review-real, a public namespace or an existing user project. The ordinary contract command is:

```sh
pnpm --filter @atoms/api exec tsx --test test/requirements.test.ts
```

It drives actual HTTP to the Fake Runtime and normal public API requests. The fixture source contains no Agent implementation import. The explicit clear-change fixture below deliberately treats supplied requests as structured changes; it makes no natural-language intent accuracy claim.

## Start two isolated services

Create a new owner-private scratch directory; keep the same path in the API terminal and request terminal. Example ports15901(API),15902(preview),15910(Fake Runtime) are separate from user services.

```sh
req_demo_dir=$(mktemp -d /tmp/atoms-req-http.XXXXXX)
chmod 700 "$req_demo_dir"
```

Runtime terminal, from the repository:

```sh
env -i PATH="$PATH" HOME="$HOME" NODE_ENV=test \
  ATOMS_SERVICE_TOKEN=synthetic-req-http-service-only AGENT_PORT=15910 \
  pnpm --filter @atoms/api dev:fake-delivery-runtime
```

API terminal (set `REQ_DEMO_DIR` to the just-created path, not existing data):

```sh
env -i PATH="$PATH" HOME="$HOME" NODE_ENV=test \
  ATOMS_SERVICE_TOKEN=synthetic-req-http-service-only \
  API_DATA_DIR="$REQ_DEMO_DIR" API_PORT=15901 PREVIEW_PORT=15902 \
  AGENT_URL=http://127.0.0.1:15910 PREVIEW_PUBLIC_URL=http://127.0.0.1:15902 \
  ATOMS_ENABLE_DEMO=true ATOMS_DEMO_CODE=synthetic-req-http-code \
  pnpm --filter @atoms/api start
```

The clean environment does not inherit model keys or public/private deployment configuration. There is no Docker/tunnel operation or implicit provider fallback.

Set the explicit synthetic coordinator mode via its service-authenticated fixture endpoint:

```sh
curl -fsS http://127.0.0.1:15910/__fixture/requirements \
  -H 'Authorization: Bearer synthetic-req-http-service-only' \
  -H 'Content-Type: application/json' --data '{"mode":"clear_change_fixture"}'
```

## Public request sequence

Use a private0600 cookie jar inside the scratch directory; never print Set-Cookie or copy it into a browser bundle. The experience code and service token above are test-only literals. An HTTP client can execute these exact requests (mutations require a new Idempotency-Key, retained unchanged for retries):

1. POST `/api/v1/sessions` with `{"code":"synthetic-req-http-code"}`; preserve the returned cookie privately.
2. POST `/api/v1/projects` with `{"title":"requirements HTTP fixture"}`. Keep its projectId.
3. Three POSTs to `/api/v2/projects/:projectId/messages`, each with a different stored key, `mode:"ask"`, `runMode:"plan"`, and `input:{kind:"text",content:...}`. Contents, in order: `做一个俄罗斯方块游戏`, `要做成 3D 版的`, `要支持电脑自动接管模式`.
4. Poll each existing `/api/v2/coordination-turns/:id` or read the workspace. No construction Run should exist. Polling never submits another message.
5. GET `/api/requirements/v1/projects/:projectId` with `X-Atoms-Requirements-Version:0.1.0`. Its snapshot should contain all three original source texts as requested candidates and `base:{kind:"empty_project"}`. This is not an existing game.
6. GET `/api/requirements/v1/proposals/:lastProposalId`, same header. Review the complete goal, every acceptance/source mapping and any explicit withdrawal/suggestion. Retain the entire snapshot/draft. Old summaries remain readable on their original revisions; they are not silently rebased.
7. POST that same path + `/accept`, same requirements header and one retained Idempotency-Key, with `expectedSummaryRevision`, `expectedProposalRevision`, `expectedSnapshot:{id,hash,revision}` from the reviewed summary, and `expectedBase:summary.snapshot.base`. Only this explicit action creates the new Run. An older v2 accept cannot bypass required full-scope review.
8. GET the existing Run and normal delivery report. API's actual Seed must contain the full cumulative goal and required original game/3D/control texts, not just the final AI sentence. The Fake fixture's source/report/ZIP hashes are real synthetic bytes, but its verification stages are not claims of actual compilation or a playable3D implementation.

To request another full review, first GET the current snapshot and edit a draft. Only after the user explicitly sends it POST `/api/requirements/v1/projects/:id/review` with `input:{kind:"text",content:<actual edited text>}` and exact `expectedSnapshot:{id,hash,revision}`. It is fixed ask/plan, creates a real user-message/coordination turn, and adds no product requirement or construction Run. Ordinary input and typed review have different immutable purposes. Consult/status does not add scope. Open clarification or unparsed later text blocks external acceptance/continuation until resolved/dismissed; no question is silently answered.

## Source policy and preservation

Normal clear auto intents retain latest_on_dispatch. If the first full intent is already authorized/building, a subsequent clear auto intent may queue; at dispatch it uses the actual newest successful source and the complete authorized requirement Seed, even if no published version existed when Router read context. Multiple **unaccepted** ask/requested inputs still require a full review. Independent typed scope_review and proposal refresh produce exact_version proposals, including an exact empty baseline; later head drift fails before Prepare rather than silently switching source. Ordinary proposal policy is displayed explicitly; accepted-current-state validation and dispatch policy are separate.

Withdrawal/replacement/acceptance appends a new authority snapshot and summary revision. The reviewed snapshot/draft remains byte-equivalent in the accepted summary; older rows/source messages/proposals/failed Run/Seed/report are not retroactively repaired. Legacy import creates only a new candidate ledger from trusted original provenance; omitted old3D requirements are not retroactively treated as accepted. Missing published source yields sourceAvailable=false/hash=null and cannot become a template-based modification. Cross-session duplicate accepts return the same Run/credit reservation. Known defective frozen plans require a new reviewed task, not a paid budget continuation.

Actual API↔Agent interoperability, browser checks and a bounded real model representative task are manager-controlled later gates. No real provider call or user3D rerun is authorized by these instructions.
