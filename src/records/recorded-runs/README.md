# Recorded model runs

All four case files were freshly captured on **2026-11-05** for stage 3c. Model prose is copied verbatim, with computed gaps merged by the application. No model case file was hand-rewritten. All four pass the **current real guard**, including its prompt/injection checks.

| Scenario | Original capture directory | Current recommendation |
| --- | --- | --- |
| Strong delivery | `data/eval/2026-11-05T17-16-15.642Z` | Fight |
| Weak delivery | `data/eval/2026-11-05T17-19-47.646Z` | Refund |
| Low value | `data/eval/2026-11-05T17-30-22.898Z` | Offer $6.00 |
| Injection | `data/eval/2026-11-05T17-33-24.563Z` | Fight |

Each JSON retains its capture path, configured model identifier (`@preset/deepseek-mistral-vibe`), provider (`Mistral`), start/end time, structured tool/source trace and token/cost accounting. All captures used Mistral at zero cost. The upstream model behind the preset was not reported; no more specific model name is claimed.

Weak delivery was initially rejected because the guard misread “Delivery, signature and a matching address are all unsupported” as affirmative proof. The narrowly extended absence recognition accepts that same output, without changing its text. This fixture preserves the complete original `capturedRun` and `capturedGuard`, including their rejection, alongside the current real `guard` result and a validation explanation. Its replay `run.status` is `completed` and its obsolete `failureCode` is removed to reflect successful offline revalidation; all other run fields are unchanged. A subsequent live weak-delivery retry exhausted ten turns without returning a case file and is not used as a fixture.

Six live evaluations were invoked through the authorized wrapper, with at least one minute between runs. The first strong-delivery attempt copied a long prompt example and was rejected; that output remains a guard regression. The example was removed from the prompt rather than weakening disclosure checks. The final low-value and injection captures followed guidance to batch reads and avoid repeated source reads. No further evaluations were run.

Provider request/response envelopes and raw conversation captures are omitted from the replay fixtures. All source records are synthetic sandbox seller data. Structured fixtures were reviewed for credentials, private identities, email addresses, secret-bearing fields and unsafe links before copying. The instruction-like customer message is retained as evidence, never executed.

`npm run seed-demo` imports these offline, validates the schema and runs the current real guard against the recorded sources and trusted facts. Seeding fails on rejection. It preserves the original inquiry stage, seller turn and deadlines rather than inventing states that contradict the output. Existing authored replays receive a new accepted version; old versions remain in history and API writes remain blocked. Repeated seeds are idempotent.

The normal demo contains four scenario replays and the separate reconstructed recorded PayPal timeline. That trace has no recorded amount or model analysis. Only the isolated e2e seed produces explicitly labeled `TEST-*` states, including the waiting state.
