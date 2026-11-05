import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CaseStore } from './storage';
import { CaseSync } from './sync';
import { disputeSchema } from '../paypal/schemas';
import { trace } from '../paypal/test-fixtures';

const stores: CaseStore[] = [];
const paths: string[] = [];
function store(path = ':memory:') { const s = new CaseStore(path); stores.push(s); return s; }
afterEach(() => { for (const s of stores.splice(0)) s.close(); for (const p of paths.splice(0)) rmSync(p, { recursive: true, force: true }); });
const states = trace.map(d => disputeSchema.parse(d));

describe('SQLite case sync', () => {
  it('replays every real change exactly once and is idempotent on redelivery', async () => {
    const db = store(); let current = states[0]!;
    const sync = new CaseSync(db, { getDispute: async () => current, listDisputes: async () => [current] });
    for (const state of states) {
      current = state;
      expect((await sync.syncDispute(state.dispute_id)).changed).toBe(true);
      expect((await sync.syncDispute(state.dispute_id)).changed).toBe(false);
    }
    expect(db.history(current.dispute_id)).toHaveLength(states.length);
    expect(db.get(current.dispute_id)).toEqual(states.at(-1));
    expect(db.history(current.dispute_id).map(e => e.snapshot.status)).toEqual(states.map(s => s.status));
  });
  it('compares unknown data while ignoring object and link ordering', () => {
    const db = store(); const current = states[2]!;
    expect(db.save(current)).toBe(true);
    expect(db.save({ ...current, links: [...current.links!].reverse() })).toBe(false);
    expect(db.save({ ...current, future_field: { buyer_message: 'fake message' } })).toBe(true);
    expect(db.get(current.dispute_id)?.future_field).toEqual({ buyer_message: 'fake message' });
    expect(db.history(current.dispute_id)).toHaveLength(2);
  });
  it('persists cases and migrations across reopen and enforces append-only history', () => {
    const directory = mkdtempSync(join(tmpdir(), 'counterclaim-')); paths.push(directory);
    const path = join(directory, 'nested', 'case.db');
    const first = store(path); first.save(states[0]!); first.close();
    const second = store(path);
    expect(second.get(states[0]!.dispute_id)).toEqual(states[0]);
    expect(second.save(states[0]!)).toBe(false);
    const raw = new DatabaseSync(path);
    try {
      expect(() => raw.exec('DELETE FROM case_events')).toThrow('append-only');
      expect(() => raw.exec("UPDATE case_events SET kind='changed'")).toThrow('append-only');
    } finally { raw.close(); }
  });
  it('syncAll includes locally known cases missing from the remote list', async () => {
    const db = store(); db.save(states[0]!);
    const another = { ...states[2]!, dispute_id: 'FAKE-SECOND' };
    const fetched: string[] = [];
    const sync = new CaseSync(db, {
      listDisputes: async () => [another, another],
      getDispute: async id => { fetched.push(id); return id === another.dispute_id ? another : states.at(-1)!; },
    });
    expect(await sync.syncAll()).toEqual({ synced: 2, changed: 2 });
    expect(new Set(fetched)).toEqual(new Set([states[0]!.dispute_id, another.dispute_id]));
  });
  it('continues refreshing other cases when one fails, then reports the incomplete poll', async () => {
    const db = store();
    const failed = { ...states[0]!, dispute_id: 'FAKE-FAILED' };
    const good = { ...states[2]!, dispute_id: 'FAKE-GOOD' };
    const fetched: string[] = [];
    const sync = new CaseSync(db, {
      listDisputes: async () => [failed, good],
      getDispute: async id => {
        fetched.push(id);
        if (id === failed.dispute_id) throw new Error('fake inaccessible case');
        return good;
      },
    });
    await expect(sync.syncAll()).rejects.toThrow('Some disputes failed to sync (1)');
    expect(fetched).toEqual([failed.dispute_id, good.dispute_id]);
    expect(db.get(good.dispute_id)).toEqual(good);
    expect(db.history(good.dispute_id)).toHaveLength(1);
    await expect(sync.syncAll()).rejects.toThrow('Some disputes failed to sync (1)');
    expect(db.history(good.dispute_id)).toHaveLength(1);
  });
  it('serializes concurrent fetches for a case and rejects mismatched response IDs', async () => {
    const db = store(); let index = 0;
    const sync = new CaseSync(db, { listDisputes: async () => [], getDispute: async () => {
      const result = states[index++ === 0 ? 0 : 2]!;
      await new Promise(resolve => setTimeout(resolve, index === 1 ? 20 : 0));
      return result;
    } });
    await Promise.all([sync.syncDispute(states[0]!.dispute_id), sync.syncDispute(states[0]!.dispute_id)]);
    expect(db.get(states[0]!.dispute_id)?.status).toBe('WAITING_FOR_SELLER_RESPONSE');
    await expect(sync.syncDispute('WRONG-ID')).rejects.toThrow('Dispute ID mismatch');
    expect(db.get('WRONG-ID')).toBeUndefined();
  });
  it('rolls back snapshot updates when history insertion fails', () => {
    const directory = mkdtempSync(join(tmpdir(), 'counterclaim-')); paths.push(directory);
    const path = join(directory, 'case.db'); const db = store(path); db.save(states[0]!);
    const raw = new DatabaseSync(path);
    raw.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON case_events BEGIN SELECT RAISE(ABORT, 'test failure'); END"); raw.close();
    expect(() => db.save(states[2]!)).toThrow('test failure');
    expect(db.get(states[0]!.dispute_id)).toEqual(states[0]);
    expect(db.history(states[0]!.dispute_id)).toHaveLength(1);
  });
});
