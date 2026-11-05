import type { Dispute, DisputeSummary } from '../paypal/schemas';
import type { CaseStore } from './storage';

export interface DisputeReader {
  getDispute(id: string): Promise<Dispute>;
  listDisputes(): Promise<DisputeSummary[]>;
}
export class CaseSync {
  private readonly pending = new Map<string, Promise<unknown>>();
  constructor(private readonly store: CaseStore, private readonly paypal: DisputeReader) {}

  /** Serialize the fetch too, so an older in-flight read cannot overwrite a newer one. */
  syncDispute(id: string): Promise<{ changed: boolean; dispute: Dispute }> {
    if (this.store.isReplay(id)) return Promise.resolve({ changed: false, dispute: this.store.get(id)! });
    const previous = this.pending.get(id) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(async () => {
      const dispute = await this.paypal.getDispute(id);
      if (dispute.dispute_id !== id) throw new Error('Dispute ID mismatch');
      return { changed: this.store.save(dispute), dispute };
    });
    this.pending.set(id, task);
    const cleanup = () => { if (this.pending.get(id) === task) this.pending.delete(id); };
    void task.then(cleanup, cleanup);
    return task;
  }
  async syncAll(): Promise<{ synced: number; changed: number }> {
    const remote = await this.paypal.listDisputes();
    // PayPal's listing window can omit old cases that still need to be refreshed.
    const ids = new Set([...remote.map(d => d.dispute_id), ...this.store.ids()].filter(id => !this.store.isReplay(id)));
    let changed = 0;
    let failed = 0;
    for (const id of ids) {
      try { if ((await this.syncDispute(id)).changed) changed++; }
      catch { failed++; }
    }
    // Refresh every reachable case, but retain a failed cron status for monitoring.
    if (failed) throw new Error(`Some disputes failed to sync (${failed})`);
    return { synced: ids.size, changed };
  }
}
