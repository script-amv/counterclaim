# Counterclaim: design

Working name. An AI agent that helps small online sellers answer PayPal disputes: it builds a sourced case file, recommends fight, offer or refund, and submits evidence only after the seller approves.

## Goal and constraints

- **Outcome:** a strong entry to the PayPal AI Hackathon. Deadline: Nov 12, 2026, 12:00 PT (Nov 13, 05:00 JST).
- **Scored equally:** implementation, design, impact, innovation, presentation. Judges may score from the video and text alone, and AI-driven analysis may be used.
- **Required:** PayPal sandbox and AI both central, working build, public open-source repo with a detected license, public YouTube video under 3 minutes, English materials.
- **Prize targets:** a Grand Prize or Best Use of PayPal + AI / Most Impactful, plus Best Use of AG Grid. Render hosting may also qualify for its prize.

## What the sandbox test proved

One real dispute went from payment to `RESOLVED_SELLER_FAVOUR` on Nov 5, 2026 (case `PP-R-ZAT-10196609`).

| Finding | Design consequence |
| --- | --- |
| Observed path: filed, seller evidence, buyer's turn, escalate, claim stage, evidence, adjudicate | Model states from PayPal's fields, not a fixed script |
| Actions come and go between states, and calls outside them are refused | Offer an action only if PayPal's current `links` include it |
| Link names use underscores (`provide_evidence`) | Normalize `_` and `-` |
| After claim-stage evidence, `adjudicate` took about 29 minutes to appear | Saved case state, background sync, honest waiting UI |
| The app could not create disputes by API (`No permissions to set target_client_id`) | Cases are filed through the sandbox website and prepared ahead of the demo |
| `evidence-file` plus a JSON `input` part works | Use this for uploads |
| Forced settlement says nothing about real-world evidence quality | Label it as a sandbox control everywhere, including the video |

## Users and core flow

The user is a small online seller without a chargeback team.

1. **Queue:** an AG Grid table of disputes with amount, reason, stage, deadline, next action and evidence strength.
2. **Investigate:** the agent reads the dispute, the PayPal order and the seller's records (shipping proof, customer messages, policies).
3. **Case file:** a timeline and claims. Every claim cites a source record. Missing proof is listed as a gap.
4. **Recommend:** fight, offer or refund, with the money reasoning. The agent may advise against fighting. That honesty is the product's main differentiator.
5. **Approve:** the seller edits and approves. Nothing is sent to PayPal before this.
6. **Submit:** the app generates an evidence PDF and calls `provide-evidence`, then tracks the case to its outcome.

## Architecture

Next.js with TypeScript, deployed as one service on Render, with SQLite on a persistent disk.

- **`paypal/`:** the only code that talks to PayPal. OAuth, Orders, Disputes, webhook signature verification. Base URL fixed to sandbox.
- **`cases/`:** stored cases, event history, PayPal sync by webhook plus polling. Derives available actions from `links`.
- **`agent/`:** a tool loop through OpenRouter, defaulting to DeepSeek V4 Flash with the model set by environment variable, producing a schema-validated case file. Provider-isolated so tests use a fake.
- **`guard/`:** deterministic checks the model cannot override. Every claim cites a real record, each action is currently offered by PayPal, and each submission matches a recorded approval.
- **`evidence/`:** PDF packet generator, enforcing PayPal's file rules (under 10 MB).
- **`records/`:** a demo store's seeded orders, shipments and messages, clearly labelled as demo data.
- **`ui/`:** queue, case file, approval and timeline.

The PayPal Agent Toolkit only exposes read and accept-claim dispute tools, so evidence goes through REST. The agent reads through tools and never holds a write tool.

## Failure handling

- **Refused action:** re-fetch the dispute, show the new state, never retry blindly.
- **Upload timeout:** check case state before retrying, because uploads aren't safely repeatable.
- **Model failure or invalid output:** show the raw facts and let the seller continue by hand. Never submit partial output.
- **Webhooks late or missing:** polling keeps state correct.
- **Stored document text:** treated as data, so a buyer message can't instruct the agent.

## Demo and judge access

- **Hosted demo:** public URL with prepared real sandbox cases at different stages.
- **Limited cases:** resolved cases can't be replayed, so keep a pool, plus a labelled read-only replay of a recorded real case.
- **Run it yourself:** the README covers keys, sandbox accounts and filing a dispute.
- **Secrets:** keys live only in host settings and ignored `.env` files. AI calls are rate limited on the public demo.

## Honesty rules

No invented statistics. Impact claims need sources. Demo data and sandbox controls are labelled. The product assists sellers and doesn't promise wins.

## Testing

Unit tests for state derivation and guard rules, including every state seen in the real run. Contract tests against a recorded sandbox trace. Agent tests with a fake model, including a prompt-injection case. One live end-to-end run before submission. A separate Codex run reviews each stage, never the one that built it.

## Out of scope

Live PayPal, multi-seller accounts and billing, real store integrations, and appeals.

## Schedule

| Dates (JST) | Work |
| --- | --- |
| Nov 5-6 | Foundation: PayPal client, cases, sync, recorded trace |
| Nov 6-8 | Agent, guard, evidence, UI |
| Nov 8-9 | Independent review, deploy, prepare cases |
| Nov 9-11 | Polish, impact sources, README, video |
| Nov 11-12 | Final live run, then submit about a day early |
