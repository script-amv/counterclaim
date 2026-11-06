import { readFileSync, readdirSync } from 'node:fs';
import { disputeSchema } from '../paypal/schemas';
import { syntheticDispute } from '../records';
import { expect, it, vi } from 'vitest';
import { CaseStore } from './storage';
import { seedDemo } from './demo';
import { detailView, queueRow } from '../api/views';
it('seeds five demo cases from accepted recorded outputs with distinct strength and no test states', () => {
  const store = new CaseStore(':memory:');
  seedDemo(store);
  expect(store.ids()).toHaveLength(5);
  for (const [scenario, strength] of [['strong-delivery', 'strong'], ['weak-delivery', 'weak'], ['low-value', 'partial'], ['injection', 'strong']]) {
    const d = detailView(store, `REPLAY-${scenario}`);
    expect(d.case.evidenceStrength).toBe(strength);
    expect(d.case.title).toMatch(/Demo (desk lamp|notebook) · Order/);
    expect(d.caseFileVersions.at(-1)?.guard.accepted).toBe(true);
    expect(d.runs.at(-1)?.model).toBe('@preset/deepseek-mistral-vibe');
    expect(d.runs.at(-1)?.startedAt).toMatch(/^2026-11-06/);
  }
  expect(store.history('PP-R-ZAT-10196609')).toHaveLength(11);
  expect(queueRow(store, 'PP-R-ZAT-10196609').amount).toBeNull();
  expect(store.ids().map(id => queueRow(store, id)).filter(r => r.whoseTurn !== 'none').reduce((sum,r) => sum + Number(r.amount?.value ?? 0), 0)).toBe(372);
  seedDemo(store);
  expect(store.versions('REPLAY-strong-delivery')).toHaveLength(1);
  store.close();
});
it('refreshes stale capture provenance even when the model and case file match', () => {
  const store = new CaseStore(':memory:');
  seedDemo(store);
  const id = 'REPLAY-strong-delivery';
  const originalRun = store.runs(id)[0]!;
  const originalVersion = store.versions(id)[0]!;
  store.saveRun({ ...originalRun, id: 'old-run', startedAt: '2026-11-05T17:16:15.654Z', tokens: 1 });
  store.importReplayVersion({ ...originalVersion, id: 'old-version', runId: 'old-run' });
  seedDemo(store);
  expect(store.versions(id)).toHaveLength(3);
  expect(store.runs(id).at(-1)).toEqual({ ...originalRun, id: expect.any(String) });
  expect(store.versions(id).at(-1)?.runId).toBe(store.runs(id).at(-1)?.id);
  expect(store.runs(id).find(run => run.id === 'old-run')?.tokens).toBe(1);
  expect(() => store.assertMutable(id)).toThrow('Read-only replay');
  seedDemo(store);
  expect(store.versions(id)).toHaveLength(3);
  store.close();
});
it('upgrades authored replays without unlocking service writes or overwriting history', () => {
  const store = new CaseStore(':memory:');
  seedDemo(store);
  const id = 'REPLAY-strong-delivery';
  const original = store.versions(id)[0]!;
  store.importReplayVersion({ ...original, id: 'old-authored-test-version', caseFile: { ...original.caseFile, summary: 'Old authored summary' } });
  seedDemo(store);
  expect(store.versions(id)).toHaveLength(3);
  expect(store.versions(id)[1]?.caseFile.summary).toBe('Old authored summary');
  expect(store.versions(id)[2]?.caseFile).toEqual(original.caseFile);
  expect(() => store.assertMutable(id)).toThrow('Read-only replay');
  store.close();
});

it('rolls back snapshots, runs and versions when replay marking fails', () => {
  const store = new CaseStore(':memory:');
  const mark = vi.spyOn(store, 'markReplay').mockImplementation(() => { throw Error('simulated crash'); });
  expect(() => seedDemo(store)).toThrow('simulated crash');
  expect(store.ids()).toEqual([]);
  expect(store.runs('REPLAY-strong-delivery')).toEqual([]);
  expect(store.versions('REPLAY-strong-delivery')).toEqual([]);
  mark.mockRestore(); seedDemo(store);
  expect(store.ids()).toHaveLength(5);
  store.close();
});
it('repairs an unmarked recorded trace prefix and finishes its timeline', () => {
  const store = new CaseStore(':memory:');
  const names = readdirSync('src/paypal/__fixtures__/trace').filter(n => n.endsWith('.json')).sort();
  for (const name of names.slice(0, 3)) store.save(disputeSchema.parse(JSON.parse(readFileSync(`src/paypal/__fixtures__/trace/${name}`, 'utf8'))));
  seedDemo(store);
  expect(store.history('PP-R-ZAT-10196609')).toHaveLength(11);
  expect(store.isReplay('PP-R-ZAT-10196609')).toBe(true);
  store.close();
});
it('never reclassifies a genuine case that collides with the trace ID', () => {
  const store = new CaseStore(':memory:');
  store.save({ ...syntheticDispute('strong-delivery'), dispute_id: 'PP-R-ZAT-10196609' });
  expect(() => seedDemo(store)).toThrow('Replay ID already in use');
  expect(store.isReplay('PP-R-ZAT-10196609')).toBe(false);
  store.close();
});

it.each([false, true])('repairs an unmarked recorded run with version present: %s', withVersion => {
  const source = new CaseStore(':memory:'); seedDemo(source);
  const id = 'REPLAY-strong-delivery';
  const store = new CaseStore(':memory:');
  store.save(source.get(id)!); store.assignScenario(id, 'strong-delivery');
  store.saveRun(source.runs(id)[0]!);
  if (withVersion) store.addVersion(source.versions(id)[0]!);
  seedDemo(store);
  expect(store.isReplay(id)).toBe(true);
  expect(store.versions(id)).toHaveLength(1);
  expect(() => store.assertMutable(id)).toThrow('Read-only replay');
  store.close(); source.close();
});
it('refuses to classify a genuine case from its reserved-looking replay ID alone', () => {
  const store = new CaseStore(':memory:');
  store.save({ ...syntheticDispute('strong-delivery'), dispute_id: 'REPLAY-strong-delivery' });
  store.assignScenario('REPLAY-strong-delivery', 'strong-delivery');
  expect(() => seedDemo(store)).toThrow('Replay ID already in use');
  expect(store.isReplay('REPLAY-strong-delivery')).toBe(false);
  store.close();
});
