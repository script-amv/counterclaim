# Evidence for the seller problem

Checked November 6, 2026. Figures below describe their source populations, not Counterclaim results. Card chargebacks, PayPal claims and ordinary customer complaints are different processes. Small sellers face evidence collection and response decisions, but the available surveys do not establish a representative rate for small online sellers specifically. No independent, small-seller-specific estimate of nonresponse or response labor was verified; those numbers are deliberately not invented.

## Research figures

| Topic / figure | Exact scope and short description | Publisher, publication date and working source | Reliability / permitted use |
| --- | --- | --- | --- |
| Disputed purchase value: **US$94** | Mean chargeback purchase amount, p. 10; excludes handling costs and fees. | Mastercard, **March 2025**, *The chargeback window of opportunity*, [report](https://www.mastercard.com/content/dam/mccom/shared/news-and-trends/insights/2025/2025-global-chargebacks-outlook/pdf/2025-state-of-chargebacks-report.pdf#page=10). | Datos Insights research sponsored by the network; larger merchants, not small sellers. |
| Not contesting: **16%** | Low-dollar write-offs as a share of chargebacks, p. 12; not necessarily missed responses. | Mastercard, **March 2025**, [report](https://www.mastercard.com/content/dam/mccom/shared/news-and-trends/insights/2025/2025-global-chargebacks-outlook/pdf/2025-state-of-chargebacks-report.pdf#page=12). | Same sponsored survey; self-reported classifications, not a share of sellers. |
| Representment: **54.2%** | U.S. lifecycle diagram says merchants represent this share of chargebacks, p. 15. Its complement, **45.8%**, is not represented in that diagram (arithmetic inference), not a measured share of sellers ignoring cases. | Mastercard, **March 2025**, [report](https://www.mastercard.com/content/dam/mccom/shared/news-and-trends/insights/2025/2025-global-chargebacks-outlook/pdf/2025-state-of-chargebacks-report.pdf#page=15). | Issuer-side view, not universal nonresponse; methodology p. 28. |
| Time: **18% spend more than 20 minutes per dispute** | Self-reported handling time; not elapsed case-resolution time or a universal average. | Riskified / Alon Livneh, **April 15, 2024**, [Three surprising costs of chargebacks](https://www.riskified.com/blog/costs-of-chargebacks/), “Operational headaches.” | Vendor marketing summarizing its commissioned study; no independent replication verified. Not PayPal-specific or small-seller-specific. |
| Time/process burden: **55%** | Respondents saying the chargeback process is too time-consuming, not the share failing to respond. | Riskified / Alon Livneh, **April 15, 2024**, [same article](https://www.riskified.com/blog/costs-of-chargebacks/). | Same vendor source and sampling caveats. Useful as reported sentiment, not a productivity benchmark. |

Mastercard’s methodology describes Datos interviews with **840 midsize/large merchants** and **23 financial institutions**, across the U.S., U.K., Brazil and Australia in **Q4 2024** ([March 2025 report, p. 28](https://www.mastercard.com/content/dam/mccom/shared/news-and-trends/insights/2025/2025-global-chargebacks-outlook/pdf/2025-state-of-chargebacks-report.pdf#page=28)). The sample is not representative of microbusinesses.

Riskified’s underlying report is dated **March 2024** and describes interviews with **more than 300 chargeback managers** from leading merchants worldwide, conducted with Paladin Fraud ([publisher’s report page](https://www.riskified.com/resources/report/chargeback-challenges-global-insights/)). This is vendor-sponsored research, even when repeated by an industry association.

## Published PayPal fees: specify the seller market

These are **U.S. merchant-account terms**, not global rates. Transaction currency alone does not establish the seller’s jurisdiction. Publisher: **PayPal**, *Merchant Fees*, last updated **November 4, 2026**. Reliability: primary fee schedule, authoritative for the listed market subject to current account terms; not an independent study.

| Figure | Exact short description | Source |
| --- | --- | --- |
| **US$15** | Standard Dispute Fee for a USD transaction under the U.S. schedule. Exceptions apply; not every dispute incurs it. | [PayPal Merchant Fees — Standard Dispute Fees](https://www.paypal.com/us/business/paypal-business-fees#dispute-fees) |
| **US$30** | High Volume Dispute Fee for USD under the same schedule. | [PayPal Merchant Fees — High Volume Dispute Fees](https://www.paypal.com/us/business/paypal-business-fees#dispute-fees) |

PayPal’s **U.S. User Agreement**, updated **November 4, 2026**, sets the high-volume threshold at a dispute ratio of **1.5% or more** and **more than 100 sales transactions** over the previous **three full calendar months**. It lists standard-fee exclusions including un-escalated inquiries, direct resolutions, qualifying Seller Protection cases, buyer-filed PayPal unauthorized claims, seller wins, and transaction values below **twice** the standard fee. High-volume exclusions are narrower; restricted activity can override normal tier criteria. These are primary contractual rules, not estimates. [PayPal User Agreement, “Dispute fees”](https://www.paypal.com/us/legalhub/paypal/useragreement-full#dispute-fees).

The agreement distinguishes a separate chargeback fee for transactions outside buyer-account/Guest Checkout processing. A lost Purchase Protection claim can also mean forfeiting the purchase amount and original shipping, with original PayPal sale fees retained. Do not add all fee types together as if each applied to every claim. [Same agreement, “Chargeback fees” and “Impact of various purchase protection processes on sellers”](https://www.paypal.com/us/legalhub/paypal/useragreement-full).

## Seller Protection is conditional

Publisher: **PayPal**. Document: *U.S. Seller Protection Program*, last updated **January 26, 2026**. Reliability: primary contractual policy; eligibility remains PayPal’s determination and varies by seller market. [Published policy](https://www.paypal.com/us/legalhub/paypal/seller-protection).

The U.S. policy covers eligible unauthorized and item-not-received transactions under its conditions. Item-not-received claims filed as card-issuer chargebacks are excluded; significantly-not-as-described claims are excluded too. Basic requirements include shipping to the Transaction Details address, valid shipment/delivery proof and timely replies to documentation requests. Item-not-received protection requires proof of delivery. Intangibles have additional requirements; exclusions and account/transaction eligibility still apply. A delivery scan in Counterclaim’s synthetic records is not an eligibility determination.

## What these sources justify

Evidence is scattered, responding takes work, fees can matter, and choosing to write off a weak case can be rational. Those observations motivate Counterclaim’s cited claims, visible gaps and option not to fight. They do not establish demand for this specific product or prove savings. No measured recovery improvement, time reduction, seller adoption, global loss total, “all-in cost multiplier,” or universal small-seller nonresponse rate is claimed.

## Internal observation

- About 29 minutes: the wait for PayPal's `adjudicate` action after claim-stage evidence, seen once on sandbox case `PP-R-ZAT-10196609` on Nov 5, 2026. This is a single sandbox observation from our own run, not a timing guarantee.
