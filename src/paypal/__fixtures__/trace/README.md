# Recorded case trace

Case `PP-R-ZAT-10196609`, recorded 2026-11-05. These are **sanitized reconstructions of summaries**, not raw PayPal responses. Source files are unchanged.

| File prefix | Source | Meaning |
| --- | --- | --- |
| 01 | poll.log 19:37:21 | Initial OPEN inquiry under PayPal review |
| 02 | poll.log 19:38:06 | UNDER_REVIEW inquiry |
| 03 | poll.log 19:40:21 | Seller response requested |
| 04 | poll.log 19:40:47 | Evidence submitted; transient review |
| 05 | poll.log 19:41:19 | Buyer's turn |
| 06 | poll.log 19:41:46 | Review after escalation; stale dispute_state |
| 07 | poll.log 19:42:18 | Review after escalation; dispute_state updated |
| 08 | poll.log 19:44:36 onward (truncated summaries) | Seller response requested at CHARGEBACK |
| 09 | poll.log 20:14:29 | CHARGEBACK review with only supporting-info action |
| 10 | poll.log 20:43:10 | Sandbox controls finally available |
| 11 | supplied design and stage 1 brief | RESOLVED_SELLER_FAVOUR |

Relations, statuses, stages and the stale intermediate `dispute_state` are preserved. Reordered links are the same state and have one fixture. The seven required relation sets appear exactly, including the two separate inquiry review phases.

The log records relation names and document counts, not complete link/document objects. Link URLs/methods are reconstructed on the fixed sandbox origin from documented paths. Documents use `fake-delivery.pdf`; no real personal information is included. No dates, amounts, people or emails are invented to make these look like complete responses. Due-date behavior is covered separately with explicitly synthetic test data.

The requested CHARGEBACK evidence source is truncated mid-string (`REQUESTED_FROM_SELL...`); its completion and zero attached documents are reconstructed from the flow and supplied brief. The terminal fixture is reconstructed from the supplied brief/design because poll.log ends when adjudication becomes available. Its retained evidence list is inferred from the prior snapshot. FINDINGS.md contains the earlier pre-live feasibility report and does not itself record terminal JSON; the later supplied design establishes the real run's outcome.
