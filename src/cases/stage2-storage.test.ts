import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { CaseStore } from './storage';
import { syntheticDispute } from '../records';
import { investigate } from '../agent/loop';
import { scripted } from '../agent/test-fixtures';
import { CaseService } from '../api/service';

it('persists scenario assignment, run provenance, approval and unknown attempt across restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'counterclaim-stage2-')); const path = join(dir, 'cases.db');
  let store = new CaseStore(path);
  try {
    const d = syntheticDispute('low-value'); store.save(d); store.close();
    const result = spawnSync(process.execPath, ['scripts/run-ts.mjs', 'scripts/assign-scenario.ts', d.dispute_id, 'low-value'], { env: { ...process.env, DATABASE_PATH: path }, encoding: 'utf8' });
    expect(result.status).toBe(0); expect(result.stdout).toContain('Sandbox demo scenario assigned');
    store = new CaseStore(path); expect(store.scenario(d.dispute_id)).toBe('low-value');
    const { version } = await investigate(store, scripted('low-value'), d.dispute_id);
    const paypal = { getDispute: async () => d, provideEvidence: async () => ({}), acceptClaim: async () => ({}), makeOffer: async () => { throw new Error('Transport failed'); } };
    const service = new CaseService(store, paypal); const a = await service.approve(d.dispute_id, version!.id); await service.submit(d.dispute_id, a.id);
    store.close(); store = new CaseStore(path);
    expect(store.runs(d.dispute_id)[0]!.toolCalls.length).toBeGreaterThan(0); expect(store.versions(d.dispute_id)[0]!.sources.length).toBeGreaterThan(0);
    expect(store.approvals(d.dispute_id)[0]!.contentHash).toBe(a.contentHash); expect(store.attempts(d.dispute_id)[0]!.status).toBe('unknown');
    await expect(new CaseService(store, paypal).submit(d.dispute_id, a.id)).rejects.toThrow('uncertain');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
it('rate limit expires and an unassigned case has no scenario', () => {
  const store = new CaseStore(':memory:');
  try { expect(store.scenario('unassigned')).toBeUndefined(); for (let i=0;i<4;i++) expect(store.takeInvestigationSlot('ip', 1000)).toBe(true); expect(store.takeInvestigationSlot('ip', 1000)).toBe(false); expect(store.takeInvestigationSlot('ip', 3601000)).toBe(true); } finally { store.close(); }
});
it('enforces the persisted global UTC daily limit across IPs and database connections', () => {
  const dir = mkdtempSync(join(tmpdir(), 'counterclaim-cap-')); const path = join(dir, 'cases.db');
  const a = new CaseStore(path); const b = new CaseStore(path);
  const previous = process.env.MAX_INVESTIGATIONS_PER_DAY; process.env.MAX_INVESTIGATIONS_PER_DAY = '2';
  try {
    const now = Date.UTC(2026, 10, 5, 12);
    expect(a.takeInvestigationSlot('ip-a', now)).toBe(true);
    expect(b.takeInvestigationSlot('ip-b', now)).toBe(true);
    expect(a.takeInvestigationSlot('ip-c', now)).toBe(false);
    expect(b.takeInvestigationSlot('ip-d', now + 86400000)).toBe(true);
  } finally { if (previous === undefined) delete process.env.MAX_INVESTIGATIONS_PER_DAY; else process.env.MAX_INVESTIGATIONS_PER_DAY = previous; a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); }
});
