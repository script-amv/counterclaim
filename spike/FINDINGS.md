# PayPal dispute findings — updated 2026-11-06

**Verdict: the November 5–6, 2026 (UTC) app run verified a real sandbox path from buyer-filed dispute to synced closure.** Earlier local mock results only verified CLI request construction. The observations below distinguish the app run from the throwaway CLI, which has no AI layer. We chose the seller-favour outcome using a sandbox control; it says nothing about real-world win rates or evidence sufficiency.

## a) Creating the dispute and API visibility

**Confirmed in documentation:** the buyer can open a case against a sandbox transaction in the Resolution Center at https://sandbox.paypal.com. Use a sandbox personal buyer, distinct from the business seller. The current test guide also documents buyer-side `POST /v1/customer/disputes`, with buyer transaction ID, buyer credentials and `PayPal-Auth-Assertion`. [Sandbox testing](https://developer.paypal.com/disputes/test-go-live).

**Important availability caveat:** PayPal's public specification describes create/cancel/change-reason and certain other operations as limited release. Do not assume ordinary seller client credentials grant buyer-side creation. The browser path avoids depending on that entitlement. [PayPal-owned OpenAPI specification](https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/customer_disputes_v1.json).

**Observed November 5–6 (UTC):** the buyer filed an item-not-received dispute on a $10 sandbox payment. It was readable by ID immediately, appeared in the list endpoint about four minutes later, and was imported by the app’s cron sync. This is not a visibility SLA. Browser eligibility waits and webhook latency remain separate unknowns. The runbook's 30-second poll interval and 15-minute investigation threshold are operator choices, not PayPal promises. Preserve the merchant-visible case ID and use `show` directly if listing lags.

## b) Evidence formats, reasons and states

**Confirmed:** JPG/JPEG, GIF, PNG and PDF; each file **less than 10 MB**, total **up to 50 MB per API call**. This CLI sends one file and conservatively enforces less than 10,000,000 bytes. [File rules](https://developer.paypal.com/platforms/disputes/reference/supported-file-types-sizes/).

**Confirmed:** seller evidence requires `WAITING_FOR_SELLER_RESPONSE` and an available provide-evidence link. Inspect requested evidence with source `REQUESTED_FROM_SELLER`. Buyers instead use `WAITING_FOR_BUYER_RESPONSE`. [Integration guide](https://developer.paypal.com/platforms/disputes/integrate-disputes/). Claim-stage seller evidence applies to `CHARGEBACK`, `PRE_ARBITRATION`, or `ARBITRATION`; an `OPEN` inquiry ordinarily uses communication/escalation. Under review, supporting information is a separate action. [Actions by state](https://developer.paypal.com/api/disputes/).

The documented reason-to-evidence mapping is:

| Reason | Relevant evidence |
| --- | --- |
| `MERCHANDISE_OR_SERVICE_NOT_RECEIVED` (INR) | `PROOF_OF_FULFILLMENT`: carrier/tracking or delivery documents/notes; alternatively refund proof |
| `UNAUTHORISED` | Fulfillment, refund proof, or `OTHER` documents/notes |
| `MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED` (SNAD) | `OTHER` documents/notes or refund proof |
| `CREDIT_NOT_PROCESSED`, `DUPLICATE_TRANSACTION`, `INCORRECT_AMOUNT`, `PAYMENT_BY_OTHER_MEANS`, `CANCELED_RECURRING_BILLING`, `OTHER` | Refund proof or `OTHER` evidence appropriate to the reason |

Reason alone does not authorize an action; current requested evidence, status and links govern. This spike implements only fulfillment evidence for INR/unauthorized cases. [Reason-specific evidence](https://developer.paypal.com/disputes/reasons-evidence/).

**Multipart caveat:** the OpenAPI request body names an optional binary `evidence-file`; the integration examples instead name the attachment `file1`, alongside a JSON `input` part. The CLI uses `input` (application/json), `evidence-file`, and matching `documents[].name`, plus `PROOF_OF_FULFILLMENT` with `evidence_info.tracking_info`. The mock checks this exact encoding. In the November 5–6 app run, proof-of-fulfillment evidence with tracking was accepted at both INQUIRY and CHARGEBACK. That verifies the app’s submissions, not every CLI representation or attachment association. See the [specification](https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/customer_disputes_v1.json) and [multipart example](https://developer.paypal.com/platforms/disputes/integrate-disputes/).

## c) Reaching UNDER_REVIEW and sandbox controls

**Confirmed:** escalation moves inquiry to claim; it does not document an unconditional immediate transition to `UNDER_REVIEW`. Follow the case's requested actions and re-fetch details after submitting evidence. [Escalation and actions](https://developer.paypal.com/api/disputes/).

**Confirmed:** both sandbox-only controls require `status=UNDER_REVIEW` **and their respective action link**. `require-evidence` with `action=SELLER_EVIDENCE` moves to `WAITING_FOR_SELLER_RESPONSE`; `adjudicate` accepts `adjudication_outcome=SELLER_FAVOR` or `BUYER_FAVOR`. [Sandbox control prerequisites](https://developer.paypal.com/disputes/test-go-live).

**Observed November 5–6 (UTC):** INQUIRY proof-of-fulfillment submission left the case WAITING_FOR_BUYER_RESPONSE. About six minutes after buyer escalation it became CHARGEBACK, seller’s turn. A second submission was accepted and moved it to UNDER_REVIEW. The adjudicate control appeared about 30 minutes after evidence. We selected SELLER_FAVOR; about three minutes later it showed RESOLVED_SELLER_FAVOUR. The app synced each change and showed closure. The require-evidence control was not verified by this flow. The mock’s immediate transitions are not timing guarantees. The CLI accepts hyphen/underscore relation spelling, validates action paths, and never follows another API host. The seller update scope is `https://uri.paypal.com/services/disputes/update-seller`. [API specification and security definitions](https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/customer_disputes_v1.json).

## d) Webhook simulator versus actual sandbox events

**Confirmed in documentation:** sandbox tests expect `CUSTOMER.DISPUTE.CREATED`, `CUSTOMER.DISPUTE.UPDATED`, and `CUSTOMER.DISPUTE.RESOLVED`. Documented triggers include creating a case, sending a buyer message, and sandbox adjudication in the seller's favor. [Webhook test cases](https://developer.paypal.com/disputes/test-go-live).

The simulator sends mock payloads to a listener, without creating a payment/dispute or changing its state. Mock notifications are not associated with an app, do not appear in the events dashboard, cannot be resent, and cannot use PayPal's postback signature verification. [Simulator limitations](https://developer.paypal.com/api/rest/webhooks/simulator/).

**Unconfirmed here:** current simulator selector availability for all three names, delivery for this merchant/app, delivery timing, and actual adjudication-triggered delivery. No listener or webhook registration is implemented in this CLI. A simulator success is not evidence that actual sandbox events work.

## e) Pitfalls and remaining risks

**Observed community report, not a current guarantee:** a 2021 developer's case moved to review after evidence but had only self/supporting-info links; adjudication failed with `ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE`. The answer suggests evidence/escalation and possibly offer/deny steps; these are case-dependent suggestions, not a verified universal recipe. This is a first-person developer report, not authoritative API documentation. [Stack Overflow report and responses](https://stackoverflow.com/questions/66436952/paypal-disputes-sandbox-testing-trigger-customer-dispute-resolved-event).

Other documented integration traps:

- Use buyer-side transaction IDs for buyer creation and seller-side capture/transaction IDs for seller tracking. Unauthorized cases may expose different buyer and merchant case IDs. [Sandbox tests](https://developer.paypal.com/disputes/test-go-live).
- OAuth scopes/account entitlements must be checked. The CLI requires seller-update for mutations; tracking also needs `https://uri.paypal.com/services/shipping/trackers/readwrite`. [Tracking API](https://developer.paypal.com/api/tracking/v1/trackers-post).
- `track` uses `POST /v1/shipping/trackers`, with one entry in `trackers[]`. The older `/trackers-batch` is deprecated. [Tracking reference](https://developer.paypal.com/api/tracking/v1/). Tracking upload is separate from dispute evidence and is not proof of actual delivery.
- Orders capture defaults to a minimal response; the CLI requests `Prefer: return=representation` to expose capture IDs. [Capture headers](https://developer.paypal.com/api/orders/v2/orders-capture).

**Open risks:** browser eligibility/UI failures; no known visibility SLA; missing action links; scope approval; other multipart representations and attachment association; real carrier validation; sandbox bugs and eventual transitions; webhook delivery. The local mock supplies successful action links by design. Files are checked by extension/size, not content authenticity. Listing shows the first 50 cases from the last seven days (override `START_TIME`); no pagination is implemented. Network requests time out at 30 seconds, and mutations are not automatically retried or persisted. A timeout needs manual inspection before retrying.

## Local verification

Run `node spike/run-mock.mjs`. The runner starts an ephemeral loopback server, exercises every CLI command, simulates browser actions explicitly, validates multipart metadata/file association and tracking, asserts `RESOLVED_SELLER_FAVOUR`, tests premature/resolved actions and production-host rejection, and checks credential/token canaries never appear in output. Transcript: `output/mock-run.txt`. Tested with Node v26.13.0; implementation targets Node 20+ built-in fetch/FormData/Blob. Node 20 itself was not available for a separate runtime run. No npm packages are needed.

## App investigation and outbound findings — November 5–6, 2026 (UTC)

Real investigations used `@preset/deepseek-mistral-vibe` via Mistral with reported cost 0. The first was rejected when a guard misread a signed negative figure. After the fix, the next recommended fight with high confidence at about 15,000 tokens.

At INQUIRY for `MERCHANDISE_OR_SERVICE_NOT_RECEIVED`, `PROOF_OF_DELIVERY_SIGNATURE` was refused with HTTP 400 `EVIDENCE_TYPE_IS_NOT_ALLOWED`. The app now retains and displays PayPal's safe error fields. `PROOF_OF_FULFILLMENT` with tracking was accepted, leaving `WAITING_FOR_BUYER_RESPONSE`, not UNDER_REVIEW.

The buyer's view exposed internal costs in our note. The fix uses an allowlisted outbound packet and one outbound text check: no economics, gaps, recommendation, confidence, or cost/policy records. Excluded items are shown at approval.

When the case became CHARGEBACK after buyer escalation, sync picked up the new stage and the app blocked the old INQUIRY approval. A guard false positive on a carrier-name field was fixed. A new investigation recommended fight, and the second submission was accepted (UNDER_REVIEW).

All four scenario replays were re-recorded November 6 from unedited passing real captures: strong → fight, weak → refund, low-value → offer, injection → fight without repeating the injection. These captures do not establish future repeatability. The eventual seller-favour outcome was selected with sandbox adjudication and says nothing about real-world win rates.
