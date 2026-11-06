# Counterclaim

Counterclaim helps a small online seller decide how to answer a PayPal dispute by assembling a case file with inspectable sources. It can recommend fighting, offering a settlement, or accepting the claim—including “Don’t fight this one” when the evidence is weak. The seller reviews the response, approves a specific version, inspects its evidence PDF where applicable, and separately chooses whether to send it to the PayPal sandbox.

**Hosted demo:** [REPLACE WITH HOSTED DEMO URL](https://COUNTERCLAIM-DEMO-URL.example) — placeholder, not a deployed service.

## Try it as a judge

Open the demo queue at `/`; no account or operator code is needed to read cases. Open **REPLAY-weak-delivery** for the advice against fighting, **REPLAY-strong-delivery** for cited delivery claims, **REPLAY-low-value** for a settlement offer, and **REPLAY-injection** for a customer message containing hostile instructions. Select a citation to open its source, read the missing-proof gaps and money outcomes, then inspect the tool activity and guard results. `/how-it-works` explains the method.

Open `PP-R-ZAT-10196609` for the reconstructed real sandbox timeline. Replays cannot be investigated, edited, approved or sent—even with an operator code. The approval page explains the sending contract, but an approved PDF is available only for an eligible, approved non-replay case. Visitor access does not include credentials or write access.

## What is real, and what is demo data?

| Part | Provenance and boundary |
| --- | --- |
| PayPal integration | REST client is fixed to the real PayPal **sandbox** origin. It supports dispute reads, evidence, offers, claim acceptance and webhook signature verification. There is no production mode. |
| Recorded sandbox case | The design records a real Nov 5 payment-to-resolution run. Eleven snapshots reconstruct sanitized state summaries; they are not raw API responses. The terminal state comes from the supplied design, not a retained terminal response. [Trace provenance](src/paypal/__fixtures__/trace/README.md). |
| Seller evidence | Orders, shipments, tracking, policies, costs and messages are synthetic demo records, not connected store or carrier data. Unassigned sandbox cases have no seller records. |
| Replay case files | Four unedited model outputs captured Nov 6, 2026 through OpenRouter, reporting provider Mistral and zero cost, using `@preset/deepseek-mistral-vibe`. The underlying model was not reported. All four captures passed the current prompt/guard; imports revalidate them offline. [Capture provenance](src/records/recorded-runs/README.md). |
| Live investigation | An operator can explicitly investigate a non-replay case using the configured model. The model has read tools only and cannot submit. |

**Sandbox settlement says nothing about real-world outcomes.** The recorded seller-favour resolution used PayPal’s sandbox adjudication control. It does not demonstrate that the evidence would win a real claim, and Counterclaim promises neither wins nor recovery rates.

## Architecture

One Next.js App Router service runs React, TypeScript and Node’s built-in SQLite. AG Grid Community provides the case queue; `pdf-lib` generates evidence PDFs; Zod validates API and model data.

```text
PayPal sandbox → verified webhook / authenticated sync → SQLite case history
Seller demo records + safe dispute fields → read-only agent tools → OpenRouter
Model case file → deterministic guards → seller review → version-bound approval
Approved note / offer / PDF → fresh PayPal action check → sandbox REST write
```

- `src/paypal/`: sandbox-only OAuth, paginated reads, writes without automatic retries, raw webhook verification.
- `src/cases/`: persisted snapshots, history, runs, versions, approvals, replay flags and submission attempts.
- `src/agent/`, `src/records/`: bounded model loop and synthetic records. Tools: `get_dispute`, `get_order`, `list_records`, `read_record`. No trusted Orders ID resolver is wired into the runtime, so Orders lookup remains an explicit gap; a capture ID is not assumed to be an order ID.
- `src/guard/`, `src/evidence/`: citation, typed-fact, privacy and repeated-instruction checks; computed gaps and strength; PDF generation. Source existence cannot prove source truth.
- `src/api/`, `src/app/`, `src/ui/`: public privacy-filtered reads and operator-authenticated mutations. Approval hashes bind the version, action, note, amounts, metadata and exact PDF bytes. Editing clears approval. Sending re-fetches PayPal and checks the current stage and action links. Uncertain writes stay locked across restarts.

Money outcomes use the disputed amount and one unambiguous same-currency item/shipping cost record. They are conditional cash outcomes, not expected value: they exclude win probability and unrecorded fees.

## Run it yourself

Requires **Node 26.x**, matching `package.json`, and npm. No production PayPal credentials are needed for the offline demo.

```sh
npm ci
npm run seed-demo
npm run dev:offline
```

Open `http://localhost:3000`. Seeding imports four recorded model replays and the reconstructed sandbox timeline into `./data/counterclaim.db`, revalidates them with the current guard, and is idempotent. Existing marked replays receive the fresh case file and full capture provenance as a new version; older runs and versions remain in history. The offline launcher disables dotenv loading and blocks remote fetch. It cannot perform live investigations or submissions.

For sandbox integration, configure process/host environment variables below. Local `npm run dev` uses Next’s normal dotenv loading behavior; `.env.example` lists most settings. Never publish secrets or put them in `NEXT_PUBLIC_*` variables. Production compilation uses `scripts/build-env.cjs` to disable dotenv loading; clients initialize lazily.

| Variable | Purpose / default |
| --- | --- |
| `DATABASE_PATH` | SQLite file; local default `./data/counterclaim.db`. Render: **`/var/data/counterclaim.db`**. |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Seller REST app’s **sandbox** credentials. |
| `PAYPAL_WEBHOOK_ID` | Registered sandbox webhook’s ID, not an event ID. |
| `OPENROUTER_API_KEY` | Required for live model investigation. |
| `OPENROUTER_MODEL` | Default `deepseek/deepseek-v4-flash`; replay captures used the preset named above, which must exist in your account to reuse it. |
| `OPERATOR_CODE` | Strong secret for mutations; unset fails closed. Enter through the UI’s operator access control; server checks every request. |
| `CRON_SECRET` | Separate strong secret for `GET /api/cron/sync`; unset disables sync endpoint. |
| `MAX_INVESTIGATIONS_PER_DAY` | Global UTC daily cap, default `50`; `0` disables investigations. |
| `AGENT_MAX_TOKENS` | Cumulative input/output token budget per investigation, default `150000`. |

Investigations also have a persisted per-IP hourly cap and a default ten-turn limit. A deployment must use one trusted proxy that appends or overwrites `X-Forwarded-For`; verify that behavior before relying on per-IP limits.

### Prepare and file a sandbox dispute

The detailed operator commands and state-dependent checks are in [spike/RUNBOOK.md](spike/RUNBOOK.md). The spike CLI loads **its own** `spike/.env`; app settings do not automatically configure it. The following steps are for a later operator-run sandbox session and make real sandbox requests.

1. In the [PayPal developer dashboard](https://developer.paypal.com/), create a business sandbox seller, a separate personal sandbox buyer, and a REST sandbox app owned by the seller. Verify dispute read/update permissions and tracking scope; stop if required entitlements are missing.
2. Use the runbook’s `create-order` command, approve its URL as the **buyer**, then `capture` as the seller. Retain the distinct order and capture IDs. Tracking upload is separate from dispute evidence and is not verification of physical delivery.
3. Sign in as the buyer at [sandbox.paypal.com](https://sandbox.paypal.com/), select the completed payment in Activity, and use Report a problem / Resolution Center to file an item-not-received dispute. Record the merchant-visible case ID from the seller account. The tested app could not create disputes by API; use the browser path. Eligibility and visibility delays are not guaranteed.
4. Configure the app’s sandbox webhook URL as `https://YOUR_HOST/api/webhooks/paypal`, with `CUSTOMER.DISPUTE.CREATED`, `.UPDATED`, `.RESOLVED`, and save its webhook ID. Alternatively trigger authenticated `GET /api/cron/sync` to import/poll cases. A webhook simulator does not create or advance a dispute.
5. To attach synthetic seller evidence to that local case, run `npm run assign-scenario -- <disputeId> strong-delivery` (also `weak-delivery`, `low-value`, `injection`). This assigns demo records only. Start `npm run dev`, open the case, unlock operator access and investigate.
6. Follow the actual current stage and links, completing buyer escalation in the sandbox browser when offered. Evidence submission needs a seller response state and its action link. Review/edit, approve the saved version, inspect the generated PDF, then send separately. Offers and claim acceptance send their note/action payload without a PDF. A planned refund is not proof of an issued refund.
7. Re-fetch the dispute after each action. Sandbox `require-evidence` and `adjudicate` controls require review state and their respective links; neither is a Counterclaim UI button. The observed adjudication wait was about 29 minutes. Never retry a write blindly after a timeout; an unknown Counterclaim attempt stays locked and needs manual reconciliation.

See [PayPal’s sandbox testing guide](https://developer.paypal.com/disputes/test-go-live). A fresh end-to-end run through the completed app remains to be verified; the earlier spike run is not that verification.

### Render hosting

[`render.yaml`](render.yaml) defines one paid web service, one persistent disk and one HTTP cron job. It has been checked against Render’s current [Blueprint reference](https://render.com/docs/blueprint-spec), [Node version selection](https://render.com/docs/node-version), [persistent disks](https://render.com/docs/disks) and [cron documentation](https://render.com/docs/cronjobs) on Nov 6, 2026. Both Node runtimes use the bounded `engines.node: 26.x`; remove conflicting host Node overrides. No deployment is implied.

At initial Blueprint creation, supply every `sync: false` value in host settings. Set `DATABASE_PATH=/var/data/counterclaim.db`; suggested model budget/cap values are in the table. Keep SQLite and its WAL files on that disk, with **one application instance**. Build: `npm ci --include=dev && npm run build`. Start: `npm run seed-demo && npm start -- --hostname 0.0.0.0 --port "$PORT"`. The seed runs at startup because the disk is unavailable during build. Health check: `/api/health` checks SQLite, not external provider availability.

The cron runs every five minutes in UTC and calls `/api/cron/sync` over HTTPS; it never mounts the database. Set its `COUNTERCLAIM_URL` to the actual web URL and its `CRON_SECRET` to the same secret as the web service. It needs no PayPal or model credentials. `sync: false` prompts only at initial creation; add/update values manually for an existing Blueprint. Automatic deploys are disabled. Hosting, disk and cron incur Render charges. An external scheduler can instead send the same authenticated GET if you choose not to provision the cron.

## Testing

```sh
npm run lint
npm run typecheck
npm test
npm run build
node scripts/run-ts.mjs scripts/import-recorded-runs.ts --check data/eval/2026-11-06T00-57-31.720Z
npx playwright install chromium
npm run e2e
```

Vitest injects fake providers and blocks external fetch. Coverage includes state/action derivation, reconstructed trace contracts, model-tool behavior, money facts, guards, privacy, version-bound approval and uncertain submissions. Playwright uses an isolated `data/e2e.db`, explicit `TEST-*` fixtures and a production server with dotenv loading disabled and remote fetch blocked. It covers public reads, replay enforcement, review/edit/approval behavior, citations, sorting and responsive screenshots. Browser launch requires an environment that permits Chromium; API-only checks can run with `npm run e2e -- e2e/api.spec.ts`.

`node spike/run-mock.mjs` exercises the earlier CLI against a local mock only. `npm run eval` is a separate opt-in **live OpenRouter** evaluation, not part of offline testing. Historical captures establish recorded behavior, not reproducibility on a future provider run. These are reproduction commands, not a claim that they were rerun while preparing these materials.

### Troubleshooting evidence submission

Inspect an existing frozen approval using the app's database, without credentials or network:

```sh
node scripts/run-ts.mjs scripts/diagnose-submit.ts '<dispute-id>' '<approval-id>' --dry-run
```

Supply environment variables externally, including `DATABASE_PATH` for a nondefault database. The diagnostic never loads dotenv or spike files. Dry run prints only the redacted request shape, part sizes and note lengths. It reads the frozen approval without regenerating the packet or changing approved content.

To save the exact frozen `evidence-file` bytes locally, add `--save-pdf <path>`:

```sh
node scripts/run-ts.mjs scripts/diagnose-submit.ts '<dispute-id>' '<approval-id>' --dry-run --save-pdf '/tmp/evidence.pdf'
```

This option requires `--dry-run`, never sends anything, and refuses to overwrite an existing file. The destination path and PDF contents are not printed. Restored evidence sections apply to new approvals; existing approvals retain their original frozen bytes.

For an intentional live sandbox submission, supply sandbox credentials externally and omit `--dry-run`:

```sh
node scripts/run-ts.mjs scripts/diagnose-submit.ts '<dispute-id>' '<approval-id>'
```

This uses the app's submission service and multipart builder for one provide-evidence write, without write retries. OAuth and fresh reads are additional calls. Approval, privacy, current-action and duplicate/uncertain-attempt guards remain active. The attempt is persisted and the dispute reconciled; output includes HTTP status and safe error fields. Failed or unknown outcomes exit nonzero. An unknown outcome locks further sending and requires manual inspection before retrying. A successful diagnostic is a real submission; do not submit it again from the UI.

To change the evidence type or packet, review and approve a new version and use its new approval ID; an old approval retains its original payload. Use the returned structured error to distinguish evidence/tracking validation, state/action and permission failures. Arbitrary response prose and request values are redacted from diagnostics.

## Tools used

Next.js, React, TypeScript, Node `node:sqlite`, PayPal sandbox REST APIs, OpenRouter, AG Grid Community, Zod, `pdf-lib`, Vitest, Playwright and ESLint. OpenAI Codex assisted with submission documentation and source research. The UI bundles Fraunces and DM Sans under their included SIL Open Font License notices. Render is the supplied hosting target, not a claimed deployed integration.

## Limitations

Sandbox only; one seller; synthetic store records; no live store/carrier integration or verified runtime Orders linkage. Webhook delivery and text-only accept-claim metadata were not exercised by the recorded spike. The Nov 6 capture batch passed all four scenarios once; imports also revalidate offline. This does not establish repeatability across future live evaluations. Prompt-injection checks can miss attacks and reject valid prose. No demonstrated time saving, win-rate improvement or real seller revenue impact is claimed.

Public reads filter known private identities and emails, but raw snapshots stored locally may contain personal data. Access control for hosting/storage, retention and backups remain operator work. SQLite and sync serialization require one app process. Cases outside PayPal’s listing window must already be imported to remain pollable. Uncertain submissions have no automatic unlock. Production readiness and a fresh app-level sandbox end-to-end run remain unverified.

Problem evidence and actual fee/protection conditions are documented in [impact sources](docs/impact-sources.md). Card-network chargeback survey results are not PayPal dispute statistics or small-seller estimates.

## License

[MIT](LICENSE), copyright 2026 the Counterclaim contributors. Third-party dependencies and bundled fonts retain their own licenses.
