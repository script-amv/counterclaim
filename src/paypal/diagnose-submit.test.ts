import { expect, it, vi } from 'vitest';
import { diagnoseSubmit } from '../../scripts/diagnose-submit';
import { CaseStore } from '../cases/storage';
import { syntheticDispute } from '../records';
import { investigate } from '../agent/loop';
import { scripted } from '../agent/test-fixtures';
import { CaseService, type ActionClient } from '../api/service';
import { PayPalError } from './client';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { contentHash } from '../guard/submission';

async function setup(path = ':memory:') {
  const store = new CaseStore(path); const dispute = syntheticDispute('strong-delivery');
  store.save(dispute); store.assignScenario(dispute.dispute_id, 'strong-delivery');
  const { version } = await investigate(store, scripted('strong-delivery'), dispute.dispute_id);
  const client = { getDispute: vi.fn(async () => dispute), provideEvidence: vi.fn<ActionClient['provideEvidence']>(async () => ({})), makeOffer: vi.fn(), acceptClaim: vi.fn() };
  const approval = await new CaseService(store, client).approve(dispute.dispute_id, version!.id, store.snapshotFingerprint(dispute.dispute_id));
  return { store, dispute, client, approval };
}
it('dry-run prints only redacted shape, without credentials, network or attempts', async () => {
  const s = await setup(); const lines: unknown[] = [];
  try {
    await diagnoseSubmit(s.store, s.dispute.dispute_id, s.approval.id, true, undefined, x => lines.push(x));
    const output = JSON.stringify(lines);
    expect(output).toContain('evidence-file'); expect(output).toContain('PROOF_OF_FULFILLMENT'); expect(output).toContain('tracking_number');
    expect(output).not.toContain('DEMO-TRACKING'); expect(output).not.toContain(s.approval.content.note);
    expect(s.store.attempts(s.dispute.dispute_id)).toHaveLength(0);
    expect(s.client.getDispute).not.toHaveBeenCalled();
  } finally { s.store.close(); }
});
it('CLI dry-run saves the exact frozen evidence-file even after the case changes, without attempts or leaked output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'counterclaim-pdf-'));
  const database = join(dir, 'case.db'); const path = join(dir, 'saved evidence.pdf');
  const s = await setup(database);
  try {
    const version = new CaseService(s.store, s.client).latest(s.dispute.dispute_id);
    new CaseService(s.store, s.client).edit(s.dispute.dispute_id, { ...version.caseFile, evidence_draft: { ...version.caseFile.evidence_draft, seller_note: 'A later edited note.' } }, version.id);
    const result = spawnSync(process.execPath, ['scripts/run-ts.mjs', 'scripts/diagnose-submit.ts', s.dispute.dispute_id, s.approval.id, '--save-pdf', path, '--dry-run'], {
      encoding: 'utf8', env: { ...process.env, DATABASE_PATH: database },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(await readFile(path)).toEqual(Buffer.from(s.approval.content.evidence!.pdfBase64, 'base64'));
    expect(result.stdout).toContain('evidence-file');
    for (const secret of [path, s.approval.content.note, s.approval.content.evidence!.pdfBase64, 'DEMO-TRACKING', 'A later edited note.']) expect(result.stdout).not.toContain(secret);
    expect(s.store.attempts(s.dispute.dispute_id)).toHaveLength(0);
  } finally { s.store.close(); await rm(dir, { recursive: true, force: true }); }
});
it.each([
  ['--save-pdf', 'output.pdf'],
  ['--dry-run', '--save-pdf'],
  ['--save-pdf', '--dry-run'],
  ['--dry-run', '--save-pdf', 'a.pdf', '--save-pdf', 'b.pdf'],
  ['--dry-run', '--save-pdf', ''],
])('rejects invalid export arguments before opening a database: %j', (...flags) => {
  const result = spawnSync(process.execPath, ['scripts/run-ts.mjs', 'scripts/diagnose-submit.ts', 'dispute', 'approval', ...flags], {
    encoding: 'utf8', env: { ...process.env, DATABASE_PATH: '/dev/null/must-not-open.db' },
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Usage:');
});
it('refuses export outside dry-run before any client calls or file writes', async () => {
  const s = await setup(); const dir = await mkdtemp(join(tmpdir(), 'counterclaim-pdf-'));
  const path = join(dir, 'never.pdf');
  try {
    await expect(diagnoseSubmit(s.store, s.dispute.dispute_id, s.approval.id, false, s.client, () => {}, path)).rejects.toThrow('--dry-run');
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(s.client.getDispute).not.toHaveBeenCalled();
    expect(s.client.provideEvidence).not.toHaveBeenCalled();
    expect(s.store.attempts(s.dispute.dispute_id)).toHaveLength(0);
  } finally { s.store.close(); await rm(dir, { recursive: true, force: true }); }
});
it('does not overwrite existing exports, submit, or mutate frozen approvals', async () => {
  const s = await setup(); const dir = await mkdtemp(join(tmpdir(), 'counterclaim-pdf-'));
  const path = join(dir, 'evidence.pdf'); const lines: unknown[] = [];
  try {
    await diagnoseSubmit(s.store, s.dispute.dispute_id, s.approval.id, true, s.client, x => lines.push(x), path);
    const bytes = await readFile(path);
    await expect(diagnoseSubmit(s.store, s.dispute.dispute_id, s.approval.id, true, s.client, x => lines.push(x), path)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(path)).toEqual(bytes);
    expect(s.store.approvals(s.dispute.dispute_id)).toEqual([s.approval]);
    expect(contentHash(s.approval.content)).toBe(s.approval.contentHash);
    expect(s.client.getDispute).not.toHaveBeenCalled();
    expect(s.client.provideEvidence).not.toHaveBeenCalled();
    expect(s.store.attempts(s.dispute.dispute_id)).toHaveLength(0);
    expect(JSON.stringify(lines)).not.toContain(path);
  } finally { s.store.close(); await rm(dir, { recursive: true, force: true }); }
});
it('sends the frozen approved bytes once, persists safe failure, and refuses uncertain retries', async () => {
  const s = await setup(); const lines: unknown[] = [];
  try {
    s.client.provideEvidence.mockRejectedValue(new PayPalError(503, 'INTERNAL_SERVER_ERROR', 'debug123'));
    await diagnoseSubmit(s.store, s.dispute.dispute_id, s.approval.id, false, s.client, x => lines.push(x));
    const args = s.client.provideEvidence.mock.calls[0]!;
    expect(args[1]).toEqual(s.approval.content.evidence!.input);
    expect(Buffer.from(await args[2].arrayBuffer()).toString('base64')).toBe(s.approval.content.evidence!.pdfBase64);
    expect(JSON.stringify(lines)).toContain('debug123');
    await expect(diagnoseSubmit(s.store, s.dispute.dispute_id, s.approval.id, false, s.client, () => {})).rejects.toThrow('uncertain');
    expect(s.client.provideEvidence).toHaveBeenCalledOnce();
  } finally { s.store.close(); }
});
