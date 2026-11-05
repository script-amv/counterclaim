import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { caseFileSchema, type AgentRun } from '../agent/schema';
import { SYSTEM_PROMPT } from '../agent/loop';
import { mergeComputedGaps, trustedFacts } from '../agent/facts';
import { checkCaseFile } from '../guard/case-file';
import { recordsForScenario, scenarioIds, syntheticDispute } from '../records';

it.each(scenarioIds)('%s replay has readable prose, relevant gaps and accepted provenance', scenario => {
  const recorded = JSON.parse(readFileSync(`src/records/recorded-runs/${scenario}.json`, 'utf8')) as {
    origin: string; caseFile: unknown; run: AgentRun; guard: { accepted: boolean };
  };
  const file = caseFileSchema.parse(recorded.caseFile);
  const prose = [file.summary, ...file.timeline.map(t => t.event), ...file.claims.map(c => c.text),
    ...file.gaps.flatMap(g => [g.missing, g.why_it_matters]), file.recommendation.reasoning,
    file.recommendation.confidence.reason, file.evidence_draft.seller_note].join(' ');
  expect(prose).not.toMatch(/\b[A-Z]+(?:_[A-Z]+)+\b|\b(?:MoneyFacts|TrustedFacts|INQUIRY|net_if_won|net_if_lost|address_matches)\b|\b(?:signed|delivered)\s*[:=]\s*(?:true|false)\b|\b(?:DEMO|REPLAY)-|\b(?:strong-delivery|weak-delivery|low-value|injection)-(?:order|shipment|tracking_event|cost|customer_message|policy)-\d+/);
  expect(prose).not.toMatch(/\bUSD\s*-?\d/);
  expect(prose).toMatch(/\$\d+\.\d{2}\b/);
  if (file.recommendation.action === 'fight') {
    expect(file.gaps.map(g => g.missing).join(' ')).not.toMatch(/willing|settle|settlement/i);
  }
  const facts = trustedFacts(syntheticDispute(scenario), recordsForScenario(scenario));
  expect(mergeComputedGaps(file, facts)).toEqual(file);
  expect(checkCaseFile(file, recorded.run.sources, [SYSTEM_PROMPT], facts)).toMatchObject({ accepted: true, reasons: [] });
  expect(recorded.guard.accepted).toBe(true);
  expect(recorded.run).toMatchObject({ provider: 'Mistral', cost: 0, status: 'completed' });
  expect(recorded.origin).toMatch(new RegExp(`^data/eval/.+/${scenario}\\.json$`));
});
