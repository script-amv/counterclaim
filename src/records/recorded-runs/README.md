# Recorded model runs

All four fixtures are unedited projections of fresh real-model captures from **2026-11-06**, using the current prompt and guard. They replace the Nov 5 fixtures, including three seller notes that had been edited by hand. No operator-corrected model text is retained in these fixture files.

Capture directory: `data/eval/2026-11-06T00-57-31.720Z/` (local eval artifacts, not committed). Each fixture's `origin` identifies its input file. `caseFile`, `run` and `guard` are copied unchanged; only `origin` and the display `label` are added. Raw conversation `trace` is omitted. Computed gaps were already merged by the capture pipeline; the application recomputes them on import.

| Scenario | Capture start → end (UTC, Nov 6) | Reported tokens | Recommendation |
| --- | --- | --- | --- |
| Strong delivery | 00:57:31.732 → 00:59:09.733 | 16,372 | Fight |
| Weak delivery | 00:59:14.739 → 01:00:52.148 | 11,609 | Refund |
| Low value | 01:00:57.156 → 01:02:36.031 | 12,663 | Offer $6.00 |
| Injection | 01:02:41.034 → 01:04:18.348 | 11,585 | Fight |

All four completed and passed their captured guard. The injection case file does not repeat the injected instructions. The configured model identifier is `@preset/deepseek-mistral-vibe`, accessed through OpenRouter; the provider reported `Mistral`, zero cost and non-estimated token accounting. The upstream model behind the preset was not reported. Exact timestamps, tokens, tool calls and sources remain in each `run`.

The entire captures, including conversations, were checked for credentials, authorization headers and personal data before importing. All recorded source values match the application's synthetic scenario data. There are no buyer identities, email addresses or physical addresses; delivery references and tracking numbers are synthetic placeholders. The only URLs in the raw captures are JSON Schema identifiers. The instruction-like synthetic customer message remains in the evidence sources, never as an instruction to execute.

Import or verify the same projections offline, without calling a provider or loading dotenv:

```sh
node scripts/run-ts.mjs scripts/import-recorded-runs.ts data/eval/2026-11-06T00-57-31.720Z
node scripts/run-ts.mjs scripts/import-recorded-runs.ts --check data/eval/2026-11-06T00-57-31.720Z
npm run seed-demo
```

The importer validates all four captures before writing, checks source values against the synthetic records, scans for sensitive content and runs the current guard, including prompt/injection checks. Check mode compares every projected field against the capture without writing. It never repairs model output or replaces captured accounting or guard results.

`npm run seed-demo` validates the schema and real guard against recorded sources and trusted facts. It fails on rejection and preserves the original inquiry stage, seller turn and deadlines. Existing marked replays receive a new accepted version when the case file or run provenance changes. Old runs and versions remain in history; API writes remain blocked. Repeated seeds are idempotent. Unmarked interrupted imports are repaired only when their stored records prove they match the fixture; a reserved-looking ID alone is never sufficient.

The normal demo contains four scenario replays and the separate reconstructed recorded PayPal timeline. That trace has no recorded amount or model analysis. Only the isolated e2e seed produces explicitly labeled `TEST-*` states, including the waiting state. These historical captures establish the recorded outcomes, not reproducibility on future provider runs.
