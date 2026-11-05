# Counterclaim — stage 2

A sandbox-only seller dispute backend: PayPal sync, a sourced AI case file, deterministic guards, approval, PDF evidence and guarded actions. There is no seller UI in this stage. Every seeded seller record and generated packet is labelled sandbox demo data. The app does not promise wins.

## Run and verify

Requires Node 26 (developed on 26.13.0), including built-in `node:sqlite`.

```sh
npm ci
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
```

For a single-process host such as Render, use build command `npm ci && npm run build` and start command:

```sh
npm start -- --hostname 0.0.0.0 --port "$PORT"
```

Mount a persistent disk at `/var/data` and set `DATABASE_PATH=/var/data/counterclaim.db`. The database and its WAL files must share that persistent directory. Use one application process and preserve the disk across deploys; `./data` is not persistent on an ephemeral host.

The placeholder is at `/`. Builds use process environment only: `scripts/build-env.cjs` prevents Next from loading dotenv files during compilation. Tests disable external fetch and inject fake providers. Runtime clients initialize lazily. Next's development server retains its normal dotenv loading behavior; no development server or real provider call was run for stage 2.

Configure runtime environment variables from `.env.example`:

- Sandbox `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`.
- `DATABASE_PATH`, default `./data/counterclaim.db`.
- `OPENROUTER_API_KEY`, and optional `OPENROUTER_MODEL`, default `deepseek/deepseek-v4-flash`.
- `OPERATOR_CODE`, a strong operator secret. Case mutations require `Authorization: Bearer <OPERATOR_CODE>` and fail closed with 503 when unset. Public case/PDF reads do not require this secret.

Also set `CRON_SECRET` in the host environment. Schedule `GET /api/cron/sync` with `Authorization: Bearer <CRON_SECRET>`; unset means disabled (503). No scheduler is provisioned here. Verified PayPal webhooks reconcile `resource.dispute_id`; original JSON text is preserved inside the verification request. Supported events are `CUSTOMER.DISPUTE.CREATED`, `.UPDATED`, `.RESOLVED`.

## Demo records and investigation

Import/sync a sandbox dispute, then explicitly assign demo seller data:

```sh
npm run assign-scenario -- <disputeId> strong-delivery
```

Scenarios: `strong-delivery` (signed delivery to matching address), `weak-delivery` (stalled tracking, mismatched address), `low-value` (partial proof, customer willing to settle), `injection` (malicious instructions inside a customer message). Each has an order, shipment, tracking event, message, policy and recorded costs. Assignments persist in `case_scenarios`. Unassigned cases have no seller records. This command changes local demo data only.

The agent has exactly four read-only tools: `get_dispute`, `get_order`, `list_records`, `read_record`. Tool results are marked untrusted data. It cannot call PayPal writes. Runs default to ten turns and a cumulative 150,000-token budget (`AGENT_MAX_TOKENS`), with conservative accounting when usage is absent (`tokensEstimated` marks estimates in the API/eval). Provider responses are bounded to 1 MiB. OpenRouter uses fetch with a 120-second timeout and retries once on 429/5xx, requesting `provider.require_parameters=true` only for ordinary model IDs. For `@preset/` models the provider field is omitted so preset routing holds. Runs record actual provider, turn count and a safe fixed failure code; tool argument, unknown-tool and unavailable-record errors are returned to the model within the turn limit. Fenced or surrounding-text JSON is accepted, with one schema repair using safe issue paths and codes.

A PayPal capture/transaction ID is not assumed to be an Orders v2 ID. `get_order` reports an explicit gap unless a trusted order resolver is supplied to the investigation service. No unsupported order linkage or buyer details are sent to the model. Seeded seller orders remain available through records.

`MoneyFacts` uses only the disputed amount and a single same-currency cost record. Net if won is disputed amount minus item/shipping cost; net if lost is negative item/shipping cost. Missing, ambiguous or mixed-currency costs produce gaps. These conditional cash outcomes assume neither win probability nor unrecorded fees.

For opt-in live-model evaluation, set the key in the process environment and invoke:

```sh
npm run eval
```

The stage 2c diagnostic options are `--capture` and `--scenario <strong-delivery|weak-delivery|low-value|injection>`. Capture writes full case files, per-turn model messages/replies, safe numeric HTTP failure diagnostics, run/tool/source traces and guard results under a timestamped, git-ignored `data/eval/` directory. Inputs are synthetic demo cases only. `EVAL_CAPTURE=1` and `EVAL_SCENARIO` provide the same controls for launchers that do not forward arguments. Requests are paced by `EVAL_REQUEST_DELAY_MS` (default 30000) and scenarios by `EVAL_DELAY_MS` (default 5000). Both delays are bounded to 0–30000 ms.

Use only the authorized wrapper for the current live evaluation; these options do not authorize other launchers or routes. HTTP refusals expose status numbers and a fixed classification, never provider error text. Allowance failures stop immediately; transient 429/5xx failures retry once after a delay, honoring seconds/date `Retry-After` up to 30 seconds. Longer retry windows stop rather than retry early. A run exits nonzero for rejected/missing case files or unexpected strong/weak/low-value recommendations.

This evaluates synthetic disputes in an in-memory database and never calls PayPal. It prints provider, failure code, guard reasons and warnings, turn count, recommendation, tokens, cost and injection repetition status. The harness stops further requests on missing/non-Mistral provider or nonzero/missing cost, or provider refusal; it never chooses a fallback route. Stage 2b used the explicitly authorized launcher once: Mistral, cost 0, then `provider_refused` at turn 3 before a case file. Stage 2c reached one full passing run (run 14); run 15 rejected injection on a source-scoped negation false positive, fixed afterward with a regression test. The 15-run cap was reached, so the required two consecutive full live passes were not achieved. Full demo captures are in ignored `data/eval/`. Scripts use the installed TypeScript compiler through a local Node loader; they do not download a runner or load dotenv files.

## API for the later UI

Shared request/response types and validation schemas are in [`src/api/contract.ts`](src/api/contract.ts). All JSON responses use `Cache-Control: no-store`.

| Method and path | Request | Response |
| --- | --- | --- |
| `GET /api/cases` | — | `CasesResponse` |
| `GET /api/cases/[id]` | — | `CaseDetailResponse` |
| `POST /api/cases/[id]/investigate` | `{}` | `InvestigateResponse` |
| `PUT /api/cases/[id]/case-file` | `{caseFile}` | `EditCaseFileResponse` |
| `POST /api/cases/[id]/approve` | `{versionId}` | `ApproveResponse` |
| `POST /api/cases/[id]/submit` | `{approvalId}` | `SubmitResponse` |
| `GET /api/cases/[id]/evidence.pdf` | — | PDF bytes, or `ApiErrorResponse` |

Mutation bodies require `Content-Type: application/json`. Requests are limited to 128 KiB. Investigations allow four requests per IP per hour, persisted in SQLite using hashed IPs. A separate transactional global UTC daily cap, `MAX_INVESTIGATIONS_PER_DAY` (default 50, 0 disables investigations), applies regardless of IP and survives restarts. The deployment must use one trusted reverse proxy that appends/overwrites `X-Forwarded-For`; the nearest address (last entry) is used. Missing/invalid addresses share one fallback bucket. Never forward arbitrary client-supplied headers unchanged.

The detail response includes safe dispute fields, case file versions and sources, readable tool traces, history, approval metadata and submission attempts. It omits raw snapshots, buyer identities, provider error bodies, secrets and approved packet base64. Case file text containing known current/historical buyer identity or email is rejected and withheld from responses. Typed trusted facts from seller records and dispute fields drive factual checks, material gaps and evidence strength. Code-computed gaps are merged with model gaps and include unavailable Orders lookup. Recommendation conflicts appear as guard warnings; the model recommendation remains advice. Evidence strength uses computed facts, never model confidence or model gap omissions. Rejected case files retain their guard reasons. Invalid model output gets one repair attempt, then the run fails without saving a partial case file.

Edits create new versions and require new approval. Approval binds the version, action, note, amount, evidence metadata and actual PDF bytes with SHA-256. PDF preview requires approval of the latest version and serves those same bytes only after rechecking their inputs against current and historical private values, including PDF text normalization. Every page is labelled `SANDBOX DEMO DATA`. Files are strictly below 10,000,000 bytes; document/note/tracking limits follow the supplied Disputes OpenAPI. PDFs use standard fonts and normalize unsupported glyphs. A planned refund is never presented as proof that a refund was issued.

Immediately before a write, the server re-fetches the dispute, checks the exact approval hash, current stage, fresh action links and offer limit. A transaction reserves the submission against the latest case-file version. Database gates block edits, new investigations and late results from already-running investigations while dispatch is pending or unknown. A durable unique stage gate also blocks concurrent or repeat submissions. Attempts record `submitting`, `submitted`, `failed` or `unknown`. Transport/body failures, HTTP 408 and 5xx become `unknown`, trigger a state refresh and are never automatically re-sent. Unknown/submitting attempts remain blocked across restarts; there is no automatic reset. A refused action is reconciled and returns the new detail state (409). Sandbox adjudication is a forced outcome, not evidence-quality validation.

## Modules and limitations

- `src/paypal/`: fixed sandbox origin, cached OAuth, paginated reads, writes with no retries, exact raw webhook verification. Full outgoing write contracts are tested.
- `src/cases/`: transactional SQLite migrations, snapshots, immutable event history, sync, scenario assignments, versions, approvals, runs and attempts.
- `src/records/`, `src/agent/`, `src/guard/`, `src/evidence/`: demo store, bounded tool loop, deterministic checks and PDF packet generation.
- `src/api/` and `src/app/api/cases/`: UI contract, privacy projection and guarded server operations.

See [fixture provenance](src/paypal/__fixtures__/trace/README.md). Reconstructed snapshots cover the real observed dispute states; unknown response fields remain in local storage but are not exposed publicly.

Live integration is unconfirmed: the recorded spike did not exercise Orders, webhook delivery or the text-only accept-claim metadata shape. The supplied Disputes OpenAPI omits that JSON schema; the existing adapter uses `{note}`. Real-model tool/schema behavior remains unconfirmed after the stopped opt-in eval. No commits, pushes or deployments were performed.

Raw PayPal snapshots can contain personal data locally. Host access control, retention and backup policy remain deployment work. Snapshot sync serialization is per process; run one application instance. Historical cases outside PayPal's listing window must already be stored/imported to be polled. A later independent stage review and explicitly authorized sandbox end-to-end run are still needed before deployment.
