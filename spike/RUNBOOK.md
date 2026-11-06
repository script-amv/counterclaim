# Throwaway dispute spike runbook

All commands below start in the workspace root unless a block says `cd spike`. Node 20+ is required. No npm install. Everything created by these commands stays under `spike/`. Do not enable shell tracing or dump environment variables. The CLI loads `spike/.env` automatically and does not save tokens.

## Observed app run — November 5–6, 2026 (UTC)

These commands are a reproduction guide, not a claim that every CLI step below ran. The completed app was exercised on a fresh $10 sandbox item-not-received case:

1. Buyer filed in the browser. Direct ID lookup worked immediately; listing lagged about four minutes. App cron sync imported the case.
2. A real investigation using `@preset/deepseek-mistral-vibe` via Mistral (reported cost 0) was rejected when the guard misread a signed negative figure. After the fix, the next recommended fight with high confidence at about 15,000 tokens.
3. Approved INQUIRY evidence using `PROOF_OF_DELIVERY_SIGNATURE` failed with HTTP 400 `EVIDENCE_TYPE_IS_NOT_ALLOWED`. The app now shows PayPal's safe error fields. A new approval using `PROOF_OF_FULFILLMENT` with tracking was accepted: `WAITING_FOR_BUYER_RESPONSE`.
4. Buyer-side inspection revealed internal costs in the note. The fix uses an allowlisted outbound packet and one outbound text check. Economics, gaps, recommendation, confidence, and cost/policy records stay out; approval shows exclusions. Inspect both seller and buyer views on future runs.
5. Buyer escalated. About six minutes later the case became CHARGEBACK, seller's turn. The app synced it and blocked the old INQUIRY approval. After fixing a carrier-name privacy false positive, a new investigation recommended fight. The second submission was accepted: UNDER_REVIEW.
6. About 30 minutes after evidence, `adjudicate` appeared. We selected `SELLER_FAVOR`; about three minutes later the case showed `RESOLVED_SELLER_FAVOUR`. The app synced it as closed.

**We picked the sandbox outcome. Forced sandbox outcomes say nothing about real-world win rates.** Timings are observations, not service guarantees. Actual webhook delivery and this flow's use of `require-evidence` remain unverified. All four scenario replays were re-recorded November 6 from unedited passing real captures: strong → fight, weak → refund, low-value → offer, injection → fight without repeating the injection.

## 1. Reproduce the credential-free mock run

```sh
node spike/run-mock.mjs
```

Expected final line: `PASS: all subcommands, browser stand-ins, multipart proof + tracking, seller win, state guards, host guards, secret-output checks. Local mock only; no PayPal API calls.`

Read `spike/output/mock-run.txt`. `output/delivery.pdf` is a synthetic local fixture, not real delivery evidence. The runner binds to an ephemeral `127.0.0.1` port and closes the mock at the end. It never contacts PayPal, even if credentials exist in the environment.

For a manual mock session, terminal A:

```sh
node spike/mock-paypal.mjs
```

Terminal B:

```sh
cd spike
export BASE=http://127.0.0.1:8787
export CARRIER_NAME=FEDEX TRACKING_CARRIER=FEDEX TRACKING_NUMBER=MOCK-TRACK-123
node dispute-spike.mjs token
node dispute-spike.mjs create-order
curl -fsS -X POST "$BASE/__mock/approve"
node dispute-spike.mjs capture ORDER-MOCK-1
node dispute-spike.mjs track CAPTURE-MOCK-1
curl -fsS -X POST "$BASE/__mock/create-dispute"
node dispute-spike.mjs list
node dispute-spike.mjs show PP-MOCK-1
curl -fsS -X POST "$BASE/__mock/escalate"
node dispute-spike.mjs require-evidence PP-MOCK-1 SELLER_EVIDENCE
node dispute-spike.mjs evidence PP-MOCK-1 output/delivery.pdf
node dispute-spike.mjs show PP-MOCK-1
node dispute-spike.mjs adjudicate PP-MOCK-1 SELLER_FAVOR
node dispute-spike.mjs show PP-MOCK-1
```

The three `/__mock/*` POSTs stand in for browser steps; **they are invented local test endpoints, never PayPal APIs**. The printed mock approval URL is a label for the POST stand-in, not an interactive page. Stop terminal A with Ctrl-C. Local BASE accepts only HTTP `localhost`, `127.0.0.1`, or `[::1]` origins. Local mode always uses dummy credentials. No overrides to another remote API origin are accepted; redirects are never followed.

## 2. Prepare another real SANDBOX run

**Human/browser:** at https://developer.paypal.com create/select a sandbox business seller and a separate sandbox personal buyer. Create a REST sandbox app owned by that seller. Obtain its sandbox client ID/secret and verify dispute permissions; an ordinary checkout app may need additional scope/entitlement configuration. If OAuth lacks seller-update, stop and resolve access through PayPal before attempting mutations.

```sh
cd spike
cp .env.example .env
chmod 600 .env
```

**Human/editor:** put only the seller sandbox app credentials in `.env`, using the two existing keys. Do not paste credentials into a command line, transcript or issue. Then in this terminal:

```sh
unset BASE
node dispute-spike.mjs token
```

Expected: OAuth HTTP 200 and scope names; the access token is never printed. Check for `https://uri.paypal.com/services/disputes/update-seller`, read access for listing, and `https://uri.paypal.com/services/shipping/trackers/readwrite` for tracking. `.env` must not contain a local BASE value. [Scope setup](https://developer.paypal.com/platforms/disputes/set-up/).

## 3. Create, approve, capture and track one payment

```sh
node dispute-spike.mjs create-order
```

Record the printed order `id` and approval URL. This creates a USD 10.00 capture-intent order. [Orders reference](https://developer.paypal.com/api/orders/v2/orders-create).

**Human/browser:** open the printed sandbox approval URL and sign in as the personal buyer. Approve the order. Do not pay as the seller. Return to the terminal after approval; no callback server is required for this manual spike.

Replace the placeholder below with the actual ID; then record `captures[].id` from the capture result:

```sh
ORDER_ID='REPLACE_WITH_ORDER_ID'
node dispute-spike.mjs capture "$ORDER_ID"
CAPTURE_ID='REPLACE_WITH_CAPTURE_ID'
```

**Human:** choose carrier/tracking details appropriate to this sandbox shipment and put a PDF/image documenting delivery under `spike/output/`. Use a simple filename such as `delivery.pdf`. Never use the generated mock fixture as real evidence. The example carrier is FEDEX; replace the tracking placeholder. `CARRIER_NAME` is the disputes enum; `TRACKING_CARRIER` is the shipping API enum, which can differ. Shipment upload is recorded as `SHIPPED`; it does not assert verified delivery.

```sh
export CARRIER_NAME=FEDEX
export TRACKING_CARRIER=FEDEX
export TRACKING_NUMBER='REPLACE_WITH_SANDBOX_SHIPMENT_TRACKING'
node dispute-spike.mjs track "$CAPTURE_ID"
```

If tracking rejects the capture ID, inspect the seller's sandbox transaction details and retry with the seller transaction ID. Do not substitute the buyer's transaction ID. Inspect HTTP/error output; a tracking upload is separate from evidence submission. [Tracking request and scope](https://developer.paypal.com/api/tracking/v1/trackers-post).

## 4. Open an INR dispute as the buyer

**Human/browser:** at https://sandbox.paypal.com sign in as the personal buyer. Open Activity, select the completed USD 10 payment, choose Report a problem / Resolution Center, and open an item-not-received case. Exact labels can vary. Record the case ID, and inspect the seller business account's Resolution Center for its merchant-visible case ID. If the UI disallows immediate creation, record the displayed condition and wait/escalate to developer support; there is no verified universal wait duration.

```sh
node dispute-spike.mjs list
DISPUTE_ID='REPLACE_WITH_MERCHANT_VISIBLE_CASE_ID'
node dispute-spike.mjs show "$DISPUTE_ID"
```

If it is absent, repeat list/show manually about every 30 seconds; after 15 minutes record the elapsed time and investigate. Those timings are this runbook's choices, not a PayPal SLA. `list` defaults to the last seven days and first 50 cases; optionally set `START_TIME` to an ISO UTC timestamp to change the window. A known merchant ID can be queried directly with `show`.

A buyer create-dispute API also exists but is not implemented here: it needs buyer-side credentials/assertion and may be limited release. This runbook intentionally uses the documented browser path. [Sandbox case creation](https://developer.paypal.com/disputes/test-go-live).

## 5. Follow the current stage and evidence action

Use `show` after every browser/API action. In the app run, initial INQUIRY fulfillment evidence left the case waiting for the buyer; buyer escalation and a fresh CHARGEBACK submission then reached review. Re-investigate and approve the new stage; do not reuse the INQUIRY approval. The next command depends on the actual state:

- **OPEN / INQUIRY:** human/browser, use the buyer Resolution Center to escalate to a claim when offered. Do not accept/refund/close the claim. Then run `show` again. Escalation changes the lifecycle stage; it does not guarantee immediate review.
- **WAITING_FOR_SELLER_RESPONSE with provide-evidence:** submit the initial API evidence using the command below, then run `show` until PayPal moves the case onward. This may be necessary before the sandbox require-evidence helper becomes usable.
- **UNDER_REVIEW with require-evidence:** proceed to the require-evidence command.
- **Any other state, or missing link:** stop dependent mutations, complete the case-specific requested browser action or investigate with PayPal. Neither sandbox helper can force an arbitrary case into review.

Initial evidence command, **only when waiting for seller response with its link present**:

```sh
node dispute-spike.mjs evidence "$DISPUTE_ID" output/delivery.pdf
node dispute-spike.mjs show "$DISPUTE_ID"
```

Once review and the require-evidence link are present:

```sh
node dispute-spike.mjs require-evidence "$DISPUTE_ID" SELLER_EVIDENCE
node dispute-spike.mjs show "$DISPUTE_ID"
```

Expect waiting for seller response and a provide-evidence link. Then:

```sh
node dispute-spike.mjs evidence "$DISPUTE_ID" output/delivery.pdf
node dispute-spike.mjs show "$DISPUTE_ID"
```

The CLI sends multipart `input` JSON and `evidence-file`, proof-of-fulfillment tracking info, and matching document name. Inspect `SUBMITTED_BY_SELLER` evidence in the follow-up detail. The app’s fulfillment submissions were accepted in the November 5–6 run. Publication examples still differ on file-part naming; inspect each actual result. For EVIDENCE_TYPE_IS_NOT_ALLOWED, review the evidence type and approve a new packet rather than retrying the frozen approval. [Evidence example](https://developer.paypal.com/platforms/disputes/integrate-disputes/).

## 6. Force the sandbox seller win and verify it

Wait for `UNDER_REVIEW` **and** `adjudicate` in `show`. The observed wait was about 30 minutes after evidence. If either remains absent on a new run, record the case status, link names, debug ID and elapsed time; that new run is still awaiting the control. Once both exist:

```sh
node dispute-spike.mjs adjudicate "$DISPUTE_ID" SELLER_FAVOR
node dispute-spike.mjs show "$DISPUTE_ID"
```

Verify the terminal seller-favour outcome in the detail and evidence history. The observed terminal outcome was `RESOLVED_SELLER_FAVOUR`, synced by the app as closed. This command selects a sandbox outcome; it does not test whether the evidence would win or establish real-world win rates. An HTTP 200 from adjudication alone is insufficient. [Sandbox adjudication](https://developer.paypal.com/disputes/test-go-live).

## 7. Optional webhook verification by a human

The CLI has no webhook listener. To verify delivery, configure an existing HTTPS listener for this same sandbox seller REST app and subscribe to `CUSTOMER.DISPUTE.CREATED`, `CUSTOMER.DISPUTE.UPDATED`, and `CUSTOMER.DISPUTE.RESOLVED` **before** repeating steps 3–6 with a fresh payment. Record actual notifications and inspect the app's sandbox Webhook Events dashboard; verify signatures using the configured sandbox webhook ID. A buyer message provides a documented UPDATED trigger. Correlate actual case IDs and event IDs and allow duplicate delivery. [Sandbox webhook tests](https://developer.paypal.com/disputes/test-go-live), [webhook integration](https://developer.paypal.com/api/rest/webhooks/rest/).

The webhook simulator can test listener connectivity using mock events; it cannot create/advance this dispute. Check whether its current event selector offers the three names. Keep simulator results separate from actual sandbox events. [Simulator](https://developer.paypal.com/api/rest/webhooks/simulator/).

## Completion record

Keep sanitized observations under `spike/output/`: runtime version, order/capture/dispute IDs, elapsed visibility/transition times, HTTP statuses, debug IDs, link names, evidence metadata, final outcome, and webhook observations. Never record credentials, access tokens, authorization headers or buyer personal data. On network timeout inspect current state before retrying: mutations have no automatic idempotency/retry handling. The dated app run above is complete. For a fresh run, report its own results and gaps; do not substitute the mock or earlier observations for new verification.
