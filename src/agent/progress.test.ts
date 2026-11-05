import { expect, it } from 'vitest';
import { CaseStore } from '../cases/storage';
import { investigate } from './loop';
import { scripted } from './test-fixtures';
import { syntheticDispute } from '../records';
it('persists actual tool progress while the next model response is pending', async () => {
  const store = new CaseStore(':memory:'); const d = syntheticDispute('strong-delivery'); store.save(d); store.assignScenario(d.dispute_id,'strong-delivery');
  const fake = scripted('strong-delivery'); let call = 0;
  const result = await investigate(store, { model: 'offline-test', complete: async (...args) => {
    if (call++ === 1) { const run = store.runs(d.dispute_id).at(-1)!; expect(run.status).toBe('running'); expect(run.toolCalls).toHaveLength(2); }
    return fake.complete(args[0]);
  } }, d.dispute_id);
  expect(result.run.status).toBe('completed'); store.close();
});
