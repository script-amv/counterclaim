# Counterclaim

## Inspiration

A small seller facing a payment dispute needs to decide whether the evidence supports a response before spending time writing one. A tool that always argues for the seller can make that decision worse.

There is evidence of a real handling burden, with limits: Riskified’s vendor-sponsored research reports that 18% of surveyed merchants spend more than 20 minutes per dispute. That is not a small-seller or PayPal-specific estimate. [Riskified, April 15, 2024](https://www.riskified.com/blog/costs-of-chargebacks/). Our [impact source notes](impact-sources.md) document the scope, fees and policy conditions. We have not measured Counterclaim’s effect on handling time or recovery.

## What it does

Counterclaim builds a sourced case file for a PayPal sandbox dispute. It reads the available records, shows claims beside citations, lists missing proof and recommends fighting, offering a settlement or accepting the claim. Its most useful answer can be: “Don’t fight this one.”

The seller can open a citation, inspect the source and edit the response. Code checks citations, typed delivery facts, money, privacy and repeated instructions. Code also computes material gaps and evidence strength rather than relying on model confidence. Conditional money outcomes exclude unrecorded fees and do not predict a win.

The approval page states exactly what will be sent. Approval binds a particular version and payload, including the exact PDF bytes for evidence submission. The seller inspects that PDF and separately sends the response. The server re-fetches PayPal’s current stage and action links immediately before dispatch. Uncertain submissions stay locked to prevent a blind duplicate.

The public demo is read-only. Four cases replay recorded model outputs against synthetic seller records; a separate case reconstructs a real sandbox timeline. Neither replay can send anything. The method and data labels remain visible throughout.

## How we built it

Next.js and React serve the interface and API in a single Node process. SQLite stores dispute snapshots, history, investigations, case-file versions, approvals and submission attempts. AG Grid Community provides the queue, including filters, sorting and totals separated by currency. Locally bundled Fraunces and DM Sans provide the typography.

The agent runs through OpenRouter with four read-only tools: `get_dispute`, `get_order`, `list_records` and `read_record`. Tool results are untrusted data. Zod validates the structured case file; deterministic guards validate its claims and approval eligibility. The model has no PayPal write tool.

A separate sandbox-only REST adapter handles OAuth, dispute sync, webhook verification and approved writes. `pdf-lib` builds the evidence packet. The supplied Render Blueprint uses one web service with a persistent SQLite disk and an HTTP cron job. Hosting is prepared, not claimed as deployed.

## Challenges we ran into

The records distinguish an early feasibility report from later observations. [spike/FINDINGS.md](../spike/FINDINGS.md) predates the live run and labels its local mock as unproven against PayPal. The later [design record](superpowers/specs/2026-11-05-counterclaim-design.md) and [trace provenance](../src/paypal/__fixtures__/trace/README.md) document the real sandbox findings.

Available actions appeared and disappeared as the dispute changed state. The observed relation names used underscores. Calls outside the allowed state were refused. We normalized relation spellings and based sending on fresh links, rather than a fixed sequence of buttons.

After claim-stage evidence, the sandbox adjudication link took about 29 minutes to appear in that run. We store case history and support polling instead of treating a delayed control as immediate failure. Dispute creation by API failed with `No permissions to set target_client_id`, so the runbook uses the buyer’s sandbox website to file a case. Multipart evidence used a JSON `input` part with `evidence-file`; documentation differences made the mock alone insufficient proof.

The AI checks had their own failures. A guard interpreted “Delivery, signature and a matching address are all unsupported” as affirmative delivery proof. The original model output was retained and revalidated after a narrow negation fix. Another run copied a long prompt example and was rejected; we removed that example instead of relaxing the disclosure guard. A weak-delivery retry exhausted its turn limit. [Recorded-run provenance](../src/records/recorded-runs/README.md).

We also could not treat a capture ID as a verified Orders ID. The runtime keeps that missing lookup visible as a gap.

## Accomplishments that we’re proud of

The application can advise against fighting and show the records behind that advice. The interface connects claims, sources, gaps and the seller’s final response without hiding the uncertainty.

The recorded fixtures preserve actual model prose, tool traces and a guard false positive. The current guard rechecks them offline. A hostile customer message remains evidence rather than becoming an instruction in the accepted replay response; that example is not a general proof of injection resistance.

Approval and sending are separate operations. Version binding, persisted submission gates and unknown-outcome locks enforce that distinction on the server, including across restarts. Offline tests use fake providers; browser tests isolate their database and block remote fetch.

The earlier real sandbox spike reached seller-favour resolution using a sandbox control. That established a sandbox integration path, not an end-to-end validation of the completed app. **Sandbox settlement says nothing about real-world outcomes.**

## What we learned

A payment integration is a changing state machine, not a sequence that always completes on cue. Evidence tools need to preserve missing information and distinguish observed facts from reconstructed history.

A model can produce useful prose and still copy instructions or fail to finish. A guard can protect a boundary and still misunderstand negation. Keeping the original output, rejection reasons and source trace made these problems reviewable.

Human approval has to bind the actual response bytes. An attractive preview alone does not establish what the server will send.

## What’s next

Run and record a fresh end-to-end sandbox submission through the completed app, verify actual webhook delivery and the accept-claim metadata contract, and repeat live-model evaluations. The earlier capped evaluation did not establish two consecutive full passing runs; offline fixture validation does not replace that.

Before any production use, add trusted store/order linkage, stronger operator identity and seller isolation, retention and backup policies, and a reviewed path for manually reconciling unknown writes. Test with consenting sellers to measure handling time and decision quality. Production PayPal, live store integration and appeals remain outside this prototype.

## Built with

Next.js, React, TypeScript, Node.js, SQLite (`node:sqlite`), PayPal sandbox REST APIs, OpenRouter, AG Grid Community, Zod, pdf-lib, Vitest, Playwright, ESLint, Fraunces and DM Sans. Recorded runs reported provider Mistral through the configured `@preset/deepseek-mistral-vibe` preset; the upstream model was not reported. Render configuration is included. OpenAI Codex assisted with submission documentation and research.

## Submission links to fill before publishing

- Hosted demo: **[REPLACE WITH PUBLIC HOSTED URL]**
- Public source repository: **[REPLACE WITH PUBLIC REPOSITORY URL]**
- Public English YouTube video, under three minutes: **[REPLACE WITH PUBLIC VIDEO URL]**
- License: [MIT](../LICENSE)
