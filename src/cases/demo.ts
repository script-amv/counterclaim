/** Offline fixture import. No provider is imported or called. */
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import type { AgentRun } from '../agent/schema';
import { caseFileSchema } from '../agent/schema';
import { trustedFacts, mergeComputedGaps } from '../agent/facts';
import { checkCaseFile } from '../guard/case-file';
import { scenarioIds, syntheticDispute, recordsForScenario } from '../records';
import { disputeSchema } from '../paypal/schemas';
import type { CaseStore } from './storage';

export function seedDemo(store: CaseStore) {
  return store.transaction(() => {
    for (const scenario of scenarioIds) {
      const recorded = JSON.parse(readFileSync(`src/records/recorded-runs/${scenario}.json`, 'utf8')) as { run: AgentRun; caseFile: unknown };
      // Keep the recorded status, deadlines and stage. Changing them would contradict the output.
      const d = syntheticDispute(scenario);
      d.dispute_id = `REPLAY-${scenario}`;
      const existing = store.get(d.dispute_id);

      const facts = trustedFacts(d, recordsForScenario(scenario));
      const caseFile = mergeComputedGaps(caseFileSchema.parse(recorded.caseFile), facts);
      const sources = recorded.run.sources;
      const guard = checkCaseFile(caseFile, sources, [], facts);
      if (!guard.accepted) throw Error(`${scenario}: ${guard.reasons.join('; ')}`);
      if (existing && !store.isReplay(d.dispute_id)) {
        // A reserved-looking ID alone is not evidence of an interrupted import.
        const runs = store.runs(d.dispute_id);
        const versions = store.versions(d.dispute_id);
        const recordedRun = (run: AgentRun) => JSON.stringify({ ...run, id: recorded.run.id, disputeId: recorded.run.disputeId }) === JSON.stringify(recorded.run);
        const proven = store.scenario(d.dispute_id) === scenario &&
          store.history(d.dispute_id).every(e => JSON.stringify(e.snapshot) === JSON.stringify(d)) &&
          runs.length > 0 && runs.every(recordedRun) &&
          versions.every(v => runs.some(r => r.id === v.runId) && JSON.stringify(v.caseFile) === JSON.stringify(caseFile) && JSON.stringify(v.sources) === JSON.stringify(sources)) &&
          !store.approvals(d.dispute_id).length && !store.attempts(d.dispute_id).length;
        if (!proven) throw Error('Replay ID already in use');
        store.markReplay(d.dispute_id);
      }
      const previous = store.versions(d.dispute_id).at(-1);
      if (previous && JSON.stringify(previous.caseFile) === JSON.stringify(caseFile) && store.runs(d.dispute_id).some(r => r.id === previous.runId && r.model === recorded.run.model)) continue;
      store.save(d);
      store.assignScenario(d.dispute_id, scenario);
      const runId = randomUUID();
      store.saveRun({ ...recorded.run, id: runId, disputeId: d.dispute_id });
      const version = { id: randomUUID(), disputeId: d.dispute_id, runId, createdAt: recorded.run.endedAt ?? recorded.run.startedAt, caseFile, sources, guard };
      if (existing) store.importReplayVersion(version);
      else { store.addVersion(version); store.markReplay(d.dispute_id); }
    }
    const tracePath = 'src/paypal/__fixtures__/trace';
    const id = 'PP-R-ZAT-10196609';
    const snapshots = readdirSync(tracePath).filter(n => n.endsWith('.json')).sort()
      .map(name => disputeSchema.parse(JSON.parse(readFileSync(`${tracePath}/${name}`, 'utf8'))));
    const history = store.history(id);
    if (store.get(id) && !store.isReplay(id)) {
      const proven = history.length > 0 && history.length <= snapshots.length &&
        history.every((event, i) => JSON.stringify(event.snapshot) === JSON.stringify(snapshots[i])) &&
        !store.scenario(id) && !store.runs(id).length && !store.versions(id).length &&
        !store.approvals(id).length && !store.attempts(id).length;
      if (!proven) throw Error('Replay ID already in use');
    }
    for (const snapshot of snapshots.slice(history.length)) store.save(snapshot);
    store.markReplay(id);
  });
}
