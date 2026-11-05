import { expect, it, vi } from 'vitest';
import { diagnoseSubmit } from '../../scripts/diagnose-submit';
import { CaseStore } from '../cases/storage';
import { syntheticDispute } from '../records';
import { investigate } from '../agent/loop';
import { scripted } from '../agent/test-fixtures';
import { CaseService, type ActionClient } from '../api/service';
import { PayPalError } from './client';

async function setup() {
  const store = new CaseStore(':memory:'); const dispute = syntheticDispute('strong-delivery');
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
