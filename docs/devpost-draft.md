# Counterclaim

## Inspiration

A small seller facing a payment dispute needs to decide whether the evidence supports a response before spending time writing one. A tool that always argues for the seller can make that decision worse.

There is evidence of a real handling burden, with limits: Riskified’s vendor-sponsored research reports that 18% of surveyed merchants spend more than 20 minutes per dispute. That is not a small-seller or PayPal-specific estimate. [Riskified, April 15, 2024](https://www.riskified.com/blog/costs-of-chargebacks/). Our [impact source notes](impact-sources.md) document the scope, fees and policy conditions. We have not measured Counterclaim’s effect on handling time or recovery.

## What it does

Counterclaim builds a sourced case file for a PayPal sandbox dispute. It reads the available records, shows claims beside citations, lists missing proof and recommends fighting, offering a settlement or accepting the claim. Its most useful answer can be: “Don’t fight this one.”

The seller can open a citation, inspect the source and edit the response. Code checks citations, typed delivery facts, money, privacy and repeated instructions. Code also computes material gaps and evidence strength rather than relying on model confidence. Conditional money outcomes exclude unrecorded fees and do not predict a win.

The approval page states exactly what will be sent and shows excluded internal items. An allowlisted packet and an outbound text check keep economics, gaps, recommendation, confidence, and cost/policy records out of the response. Approval binds a particular version and payload, including the exact PDF bytes for evidence submission. The seller inspects that PDF and separately sends the response. The server re-fetches PayPal’s current stage and action links immediately before dispatch. Uncertain submissions stay locked to prevent a blind duplicate.

The public demo is read-only. Four cases replay recorded model outputs against synthetic seller records; a separate case reconstructs a real sandbox timeline. Neither replay can send anything. The method and data labels remain visible throughout.

## How we built it

Next.js and React serve the interface and API in a single Node process. SQLite stores dispute snapshots, history, investigations, case-file versions, approvals and submission attempts. AG Grid Community provides the queue, including filters, sorting and totals separated by currency. Locally bundled Fraunces and DM Sans provide the typography.

The agent runs through OpenRouter with four read-only tools: `get_dispute`, `get_order`, `list_records` and `read_record`. Tool results are untrusted data. Zod validates the structured case file; deterministic guards validate its claims and approval eligibility. The model has no PayPal write tool.

A separate sandbox-only REST adapter handles OAuth, dispute sync, webhook verification and approved writes. `pdf-lib` builds the evidence packet. The supplied Render Blueprint uses one web service with a persistent SQLite disk and an HTTP cron job. The public demo runs on Vercel in read-only mode, without provider credentials or a database service.

## Challenges we ran into

The November 5–6, 2026 (UTC) sandbox run exposed failures that a local mock could not. A buyer filed an item-not-received dispute on a $10 payment. It was readable by ID immediately but took about four minutes to appear in the list endpoint; the app's cron sync then imported it.

The first real investigation was rejected because a guard misread a signed negative figure. After the fix, the next run recommended fight with high confidence, using about 15,000 tokens. Later, another guard treated a carrier-name field as private. Fixing that false positive allowed a fresh investigation after escalation. These were real runs using `@preset/deepseek-mistral-vibe` via Mistral, with reported cost 0.

PayPal refused the approved INQUIRY submission with HTTP 400 `EVIDENCE_TYPE_IS_NOT_ALLOWED` for `PROOF_OF_DELIVERY_SIGNATURE`. We preserved and displayed the safe error fields. `PROOF_OF_FULFILLMENT` with tracking was accepted and moved the case to `WAITING_FOR_BUYER_RESPONSE`.

The buyer's view revealed a more serious problem: our note exposed the seller's internal costs. We replaced that path with an allowlisted outbound packet and one outbound text check. Economics, gaps, recommendation, confidence, and cost/policy records are excluded. The approval screen shows what stays out.

After the buyer escalated, the case became CHARGEBACK, seller's turn, about six minutes later. The app synced the stage change and blocked the old INQUIRY approval. A new investigation recommended fight; the second submission was accepted and moved the case to UNDER_REVIEW.

## Accomplishments that we’re proud of

The app handled a fresh sandbox dispute through import, real investigation, approval, accepted evidence submissions, escalation and closure. It also surfaced a refused evidence type and prevented an approval from an earlier stage from being reused.

All four scenario replays were re-recorded November 6 from unedited passing real captures: strong evidence → fight, weak evidence → refund, low value → offer, and injection → fight without repeating the injection. Imports revalidate them offline. One accepted injection example does not establish general resistance to attacks or repeatability across future model runs.

About 30 minutes after evidence, the sandbox adjudication control appeared. We chose `SELLER_FAVOR`; about three minutes later PayPal showed `RESOLVED_SELLER_FAVOUR`, and the app synced it as closed. **We selected the outcome with a sandbox control. It says nothing about real-world win rates or whether the evidence would win.**

## What we learned

The buyer's view is part of testing the response. A useful internal investigation contains costs, gaps and advice that must never become buyer-facing evidence. Human approval needs a clear outbound boundary and must bind the actual response bytes.

A dispute changes while the seller works. Current stage and action links must be checked again before sending. List visibility, escalation and sandbox controls can lag; the observed four-, six- and 30-minute waits are case observations, not service guarantees.

A guard can catch unsafe output and still reject valid figures or fields. Keeping the rejected output and source trace made narrow fixes possible. Model confidence did not settle evidence eligibility, privacy or the eventual outcome.

## What’s next

Re-record the video on a fresh sandbox case, verify actual webhook delivery and the accept-claim metadata contract, and repeat live-model evaluations. The earlier capped evaluation did not establish two consecutive full passing runs; offline fixture validation does not replace that.

Before any production use, add trusted store/order linkage, stronger operator identity and seller isolation, retention and backup policies, and a reviewed path for manually reconciling unknown writes. Test with consenting sellers to measure handling time and decision quality. Production PayPal, live store integration and appeals remain outside this prototype.

## Built with

Next.js, React, TypeScript, Node.js, SQLite (`node:sqlite`), PayPal sandbox REST APIs, OpenRouter, AG Grid Community, Zod, pdf-lib, Vitest, Playwright, ESLint, Fraunces and DM Sans. Recorded runs reported provider Mistral through the configured `@preset/deepseek-mistral-vibe` preset; the upstream model was not reported. Render configuration is included. OpenAI Codex assisted with submission documentation and research.

## Submission links to fill before publishing

- Hosted demo: [counterclaim.vercel.app](https://counterclaim.vercel.app)
- Public source repository: [script-amv/counterclaim](https://github.com/script-amv/counterclaim)
- Public English YouTube video, under three minutes: **[REPLACE WITH PUBLIC VIDEO URL]**
- License: [MIT](../LICENSE)
