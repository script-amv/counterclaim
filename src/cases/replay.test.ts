import { describe, it, expect } from 'vitest';
import { CaseStore } from './storage';
import { syntheticDispute } from '../records';
import { CaseService } from '../api/service';
import { queueRow } from '../api/views';
describe('offline replay boundary', () => {
  it('persists provenance and refuses every service write before any network call', async () => {
    const store = new CaseStore(':memory:'); const d = syntheticDispute('strong-delivery'); store.save(d); store.markReplay(d.dispute_id);
    const client = new Proxy({}, { get() { throw new Error('Network boundary crossed'); } });
    const service = new CaseService(store, client as ConstructorParameters<typeof CaseService>[1]);
    expect(queueRow(store, d.dispute_id).replay).toBe(true);
    expect(() => store.assertMutable(d.dispute_id)).toThrow('Read-only replay');
    expect(() => service.edit(d.dispute_id, {}, 'missing')).toThrow('Read-only replay');
    await expect(service.approve(d.dispute_id, 'missing', store.snapshotFingerprint(d.dispute_id))).rejects.toThrow('Read-only replay');
    await expect(service.submit(d.dispute_id, 'missing')).rejects.toThrow('Read-only replay');
    store.close();
  });
});

it('never refreshes a replay from PayPal', async () => {
  const { CaseSync } = await import('./sync');
  const store = new CaseStore(':memory:'); const d = syntheticDispute('strong-delivery'); store.save(d); store.markReplay(d.dispute_id);
  const sync = new CaseSync(store, { getDispute: async () => { throw Error('Network boundary crossed'); }, listDisputes: async () => [d] });
  expect(await sync.syncAll()).toEqual({ synced: 0, changed: 0 });
  expect((await sync.syncDispute(d.dispute_id)).changed).toBe(false);
  store.close();
});
