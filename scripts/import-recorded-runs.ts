/** Offline projection of eval captures. Never rewrite model text or load credentials. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { caseFileSchema, type AgentRun } from '../src/agent/schema';
import { SYSTEM_PROMPT } from '../src/agent/loop';
import { trustedFacts } from '../src/agent/facts';
import { publicDispute } from '../src/api/privacy';
import { checkCaseFile } from '../src/guard/case-file';
import { recordsForScenario, scenarioIds, syntheticDispute } from '../src/records';

const args = process.argv.slice(2);
const check = args.includes('--check');
const directory = args.find(arg => arg !== '--check');
if (!directory || !/^data\/eval\/\d{4}-\d{2}-\d{2}T[\d.-]+Z\/?$/.test(directory)) {
  throw Error('Supply a data/eval/<capture timestamp> directory, optionally with --check');
}
const expected = { 'strong-delivery': 'fight', 'weak-delivery': 'refund', 'low-value': 'offer', injection: 'fight' };
const fixtures = scenarioIds.map(scenario => {
  const origin = join(directory, `${scenario}.json`);
  const raw = readFileSync(origin, 'utf8');
  // Scan the entire capture, including conversations omitted from the fixture.
  // Diagnostics deliberately never echo matched text.
  if (/(?:bearer\s+[\w.-]+|sk-[\w-]{12,}|-----BEGIN [\w ]*PRIVATE KEY|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i.test(raw) ||
      /(?:authorization|x-api-key|"(?:api_key|access_token|refresh_token|password|cookie|headers|buyer|payer|email|phone|full_name)"\s*:)/i.test(raw)) {
    throw Error(`${scenario}: sensitive capture content; import refused`);
  }
  const capture = JSON.parse(raw) as { caseFile: unknown; run: AgentRun; guard: { accepted: boolean } };
  const file = caseFileSchema.parse(capture.caseFile);
  const dispute = syntheticDispute(scenario);
  const records = recordsForScenario(scenario);
  const safeDispute = publicDispute(dispute);
  for (const source of capture.run.sources) {
    const known = source.id.startsWith('dispute.')
      ? safeDispute[source.id.slice(8) as keyof typeof safeDispute]
      : records.find(record => record.id === source.id);
    if (known === undefined || !isDeepStrictEqual(source.data, known)) {
      throw Error(`${scenario}: source differs from synthetic data; import refused`);
    }
  }
  const guard = checkCaseFile(file, capture.run.sources, [SYSTEM_PROMPT], trustedFacts(dispute, records));
  if (!capture.guard.accepted || !guard.accepted || capture.run.status !== 'completed' ||
      file.recommendation.action !== expected[scenario]) throw Error(`${scenario}: capture failed replay validation`);
  // Copy the recorded objects verbatim; validation results never replace capture metadata.
  return { path: `src/records/recorded-runs/${scenario}.json`, fixture: {
    origin, label: 'Recorded model run', caseFile: capture.caseFile, run: capture.run, guard: capture.guard,
  } };
});
// Validate all four before writing any fixture.
for (const { path, fixture } of fixtures) {
  if (check) {
    if (!isDeepStrictEqual(JSON.parse(readFileSync(path, 'utf8')), fixture)) throw Error(`${path}: differs from capture`);
  } else writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);
}
console.log(`Four replay fixtures ${check ? 'verified against' : 'imported from'} synthetic captures; current guard accepted all. No network calls.`);
