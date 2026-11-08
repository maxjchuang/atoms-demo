# Reviewed exact continuation of the fourth real attempt

This runner preserves the fourth attempt's two successful real deliveries and its strict auto-admission failure. It does not rerun the first two Code tasks, alter a model proposal, change admission policy, or claim the third task auto-started. The only authorized continuation is an explicit acceptance of the reviewed exact-version proposal, followed by one read-only quality consultation.

## Fixed action and accounting

- Proposal: `proposal_91e10bb774cd2b59b217`, revision 1, project `project_ad7a08e8a7b7b839befc`.
- Exact input: `version_86330d74e662946d74e9`, actual displayed **V3**, restored from V1 `version_1e80ef9242bc941ab31e`.
- The model goal's `v2` is an existing context alias for that exact ID. It is not actual displayed V2. The original goal/history remains verbatim; the Worker baseline must be the exact restored V3 ID.
- Existing evidence: 2 successful Code Runs, 3 Versions including the restore, 1 completed Router Turn whose admission remains `proposed`.
- Remaining authorization: at most 1 new Code Run and 1 read-only quality Turn. Final totals are 3 Code Runs, 4 Versions, 2 Router Turns. No replacement task, new preparation after failure, automatic clarification, or budget expansion is permitted.

## Default dry-run

From the repository root:

```sh
pnpm --filter @atoms/contracts exec tsx ../../tests/integration/delivery-resume.mjs --directory ORIGINAL_DATA_DIRECTORY
```

This reads only the API-owned SQLite state and emits the safe proposal receipt, actual V3/restoration interpretation, current counts, and canonical receipt hash. It does not load `.env`, create credentials/files, start a service, contact a provider, submit a message, or accept a proposal. Root independently reviews the exact receipt and hash.

```sh
pnpm --filter @atoms/contracts exec tsx ../../tests/integration/delivery-resume.mjs --help
```

## Preconditions for a separately authorized execution

1. Root confirms the approved receipt and original data path. All original/integration child services must be stopped. `lsof` checks the API DB and relevant service/data working directories, excluding the runner itself; inability to prove stop fails closed.
2. All existing Runs/coordination Turns are terminal and writer locks clear. An existing failed/interrupted third Run is not revived.
3. Root creates a full stopped-service copy outside the original directory, preserving timestamps and symlinks, for example with `cp -a`. The runner compares the entire tree's paths, types, sizes, timestamps and raw symlink targets, then hashes every regular file as opaque Buffer streams. Native transcripts/credentials are not decoded, parsed or printed; only overall match, counts and byte totals are reportable. Symlinks are never followed for backup comparison.
4. The original two Runs, the original three Versions excluding preview URL cache fields, all original manifest files, reports, precise source ZIPs and original `runner-error.log` receive a separate immutable fingerprint. Those bytes and facts must remain unchanged throughout continuation.
5. `DEEPSEEK_API_KEY` must already be available in root's execution environment. This runner never loads a dotenv file or stores the model key. The key is passed only to Agent. API/Web/browser child environments use explicit allowlists; browser children receive no model or internal-service credentials.

Execution syntax, only after root authorizes it:

```sh
ATOMS_ALLOW_REAL_DELIVERY_INTEGRATION=1 \
ATOMS_ALLOW_REAL_DELIVERY_ROUTER=1 \
ATOMS_ALLOW_REAL_DELIVERY_RESUME=1 \
pnpm --filter @atoms/contracts exec tsx ../../tests/integration/delivery-resume.mjs \
  --directory ORIGINAL_DATA_DIRECTORY \
  --backup ROOT_VERIFIED_FULL_COPY \
  --receipt-hash ROOT_REVIEWED_HASH \
  --execute --real
```

The three guards, `--execute`, `--real`, matching hash, stopped-service gate and backup verification precede all runtime startup and proposal acceptance. Model and Router budgets remain the original 8/3 step envelopes and original time/token ceilings.

## Private control files and idempotency

Execution creates `resume-control/` with mode 0700. `resume-local-secrets.json` is a non-symlink regular file with mode 0600 containing only new test service/preview secrets plus persistent accept/ask idempotency keys. It never contains a provider key or browser Cookie. Login uses a stable nonsecret key derived from the approved receipt hash. Existing credentials are reused exactly. An existing execution lock fails closed; root must inspect a stale lock before any manual removal.

The immutable `review.json` stores the approved receipt, original evidence fingerprint and backup result. Separate `accepted-run.json` and `quality-turn.json` bind the exact returned IDs. A transport response loss first reconciles persisted API state; at most the identical request and same idempotency key is retransmitted. No new key is generated to work around failure. Subsequent invocations require a new consistent backup of the current stopped data and refuse nonterminal work; they do not resurrect a failed third task or add a third consultation.

## Execution checks

The runner logs in with the original test experience code, re-reads and matches the proposal's ID/revision/goal/source/origin/exact base/expiry, and accepts it explicitly. It verifies the resulting Seed's `explicit_proposal_acceptance`, the exact V3 input and parent, a new immutable binding/report, permitted complete/partial publication, actual evidence bytes, identical legacy/delivery ZIP aliases and archive hash, source diff, and a freshly signed preview URL.

Secret rotation intentionally invalidates old preview signatures. The API rebuilds cached preview URLs for the current secret/origin; valid URLs remain stable on polling. Old cursor signatures can be discarded and pages requested from the beginning. Source bytes and reports are not rewritten to refresh capabilities.

After the single remaining quality ask, the runner checks the frozen delivery facts and original Router budget/usage. The real Web CLI is read-only and must preserve sealed cursors, revisions, entity IDs and both quotas. API and Runtime restart with the same persisted resume secrets; the sealed checkpoint must remain exactly equal. No additional Code or Router operation is permitted during either check.

Final `resume-acceptance.json` explicitly records `reviewed_exact_accept_not_auto`, original evidence preservation, total counts, read-only Web verification and strict restart. Child logs remain under the private control directory. The original failed runner log and all three earlier failed attempts remain untouched. Errors stop execution; they never trigger a new task or claim auto-admission success.

## Ordinary local tests

```sh
pnpm --filter @atoms/contracts exec tsx --test ../../tests/integration/delivery-resume.test.mjs
```

These use synthetic temporary API state, local file fixtures and tiny CLI probes only. No original evidence directory, live service, browser, real API key or paid model is required. Passing them verifies runner policy and guards, not the separately authorized real continuation.
