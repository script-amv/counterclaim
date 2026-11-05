import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { CaseStore } from '../cases/storage';
import { CaseService } from './service';
import { detailView } from './views';
import { syntheticDispute } from '../records';
import { investigate } from '../agent/loop';
import { scripted, draft } from '../agent/test-fixtures';

const store = new CaseStore(':memory:');
afterEach(() => vi.restoreAllMocks());
afterAll(() => store.close());
async function setup() {
  const d = syntheticDispute('strong-delivery');
  d.dispute_id = crypto.randomUUID();
  store.save(d); store.assignScenario(d.dispute_id, 'strong-delivery');
  const { version } = await investigate(store, scripted('strong-delivery'), d.dispute_id);
  const client = new Proxy({}, { get() { throw Error('Network forbidden'); } });
  const service = new CaseService(store, client as ConstructorParameters<typeof CaseService>[1]);
  return { d, version: version!, service, reviewed: detailView(store, d.dispute_id) };
}
it('rejects approval of a snapshot that changed since review', async () => {
  const { d, version, service, reviewed } = await setup();
  store.save({ ...d, dispute_life_cycle_stage: 'CHARGEBACK' });
  await expect(service.approve(d.dispute_id, version.id, reviewed.snapshotFingerprint)).rejects.toMatchObject({ status: 409 });
  expect(store.approvals(d.dispute_id)).toEqual([]);
});
it('rechecks the reviewed snapshot after asynchronous packet generation', async () => {
  const { d, version, service, reviewed } = await setup();
  const pending = service.approve(d.dispute_id, version.id, reviewed.snapshotFingerprint);
  store.save({ ...d, dispute_life_cycle_stage: 'CHARGEBACK' });
  await expect(pending).rejects.toMatchObject({ status: 409 });
  expect(store.approvals(d.dispute_id)).toEqual([]);
});
it('refuses a stale edit without creating a version or replacing the first edit', async () => {
  const { d, version, service } = await setup();
  const first = draft('strong-delivery'); first.summary = 'First seller edit';
  const saved = service.edit(d.dispute_id, first, version.id);
  expect(() => service.edit(d.dispute_id, draft('strong-delivery'), version.id)).toThrow(expect.objectContaining({ status: 409 }));
  expect(store.versions(d.dispute_id).at(-1)?.id).toBe(saved.id);
  expect(store.versions(d.dispute_id)).toHaveLength(2);
});
