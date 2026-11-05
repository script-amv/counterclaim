import { it, expect, vi } from 'vitest';
import { CaseStore } from '../cases/storage';
import { syntheticDispute } from '../records';
import { investigate } from '../agent/loop';
import { scripted, draft } from '../agent/test-fixtures';
import { CaseService } from '../api/service';
import { PayPalError } from '../paypal/client';

async function setup() {
  const store = new CaseStore(':memory:'); const dispute = syntheticDispute('strong-delivery'); store.save(dispute); store.assignScenario(dispute.dispute_id, 'strong-delivery');
  const { version } = await investigate(store, scripted('strong-delivery'), dispute.dispute_id);
  const paypal = { getDispute: vi.fn(async () => dispute), provideEvidence: vi.fn(async () => ({})), makeOffer: vi.fn(async () => ({})), acceptClaim: vi.fn(async () => ({})) };
  const service = new CaseService(store, paypal);
  return { store, dispute, version: version!, paypal, service };
}
it('edits create a version and invalidate approval', async () => {
  const s = await setup(); const a = await s.service.approve(s.dispute.dispute_id, s.version.id, s.store.snapshotFingerprint(s.dispute.dispute_id));
  const edit = draft('strong-delivery'); edit.summary = 'Edited summary'; s.service.edit(s.dispute.dispute_id, edit, s.version.id);
  await expect(s.service.submit(s.dispute.dispute_id, a.id)).rejects.toThrow(); expect(s.paypal.provideEvidence).not.toHaveBeenCalled(); expect(s.store.versions(s.dispute.dispute_id)).toHaveLength(2); s.store.close();
});
it('requires fresh action and returns resynced refusal without write', async () => {
  const s = await setup(); const a = await s.service.approve(s.dispute.dispute_id, s.version.id, s.store.snapshotFingerprint(s.dispute.dispute_id));
  s.paypal.getDispute.mockResolvedValue({ ...s.dispute, links: [] });
  await expect(s.service.submit(s.dispute.dispute_id, a.id)).rejects.toThrow(); expect(s.paypal.provideEvidence).not.toHaveBeenCalled(); expect(s.store.get(s.dispute.dispute_id)?.links).toEqual([]); s.store.close();
});
it('stale hash is refused before write', async () => {
  const s = await setup(); const a = await s.service.approve(s.dispute.dispute_id, s.version.id, s.store.snapshotFingerprint(s.dispute.dispute_id));
  a.contentHash = 'stale'; s.store.addApproval({ ...a, id: 'tampered' });
  await expect(s.service.submit(s.dispute.dispute_id, 'tampered')).rejects.toThrow(); expect(s.paypal.provideEvidence).not.toHaveBeenCalled(); s.store.close();
});
it('timeout is unknown, refreshes case, and never resends', async () => {
  const s = await setup(); const a = await s.service.approve(s.dispute.dispute_id, s.version.id, s.store.snapshotFingerprint(s.dispute.dispute_id));
  s.paypal.provideEvidence.mockRejectedValue(new DOMException('Timeout', 'TimeoutError'));
  expect((await s.service.submit(s.dispute.dispute_id, a.id)).status).toBe('unknown');
  await expect(s.service.submit(s.dispute.dispute_id, a.id)).rejects.toThrow(); expect(s.paypal.provideEvidence).toHaveBeenCalledOnce(); expect(s.paypal.getDispute.mock.calls.length).toBeGreaterThanOrEqual(2); s.store.close();
});
it('does not double submit, including simultaneous requests', async () => {
  const s = await setup(); const a = await s.service.approve(s.dispute.dispute_id, s.version.id, s.store.snapshotFingerprint(s.dispute.dispute_id));
  const outcomes = await Promise.allSettled([s.service.submit(s.dispute.dispute_id, a.id), s.service.submit(s.dispute.dispute_id, a.id)]);
  expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1); expect(s.paypal.provideEvidence).toHaveBeenCalledOnce();
  await expect(s.service.submit(s.dispute.dispute_id, a.id)).rejects.toThrow(); s.store.close();
});
it('records a refused write as failed and resyncs', async () => {
  const s = await setup(); const a = await s.service.approve(s.dispute.dispute_id, s.version.id, s.store.snapshotFingerprint(s.dispute.dispute_id));
  s.paypal.provideEvidence.mockRejectedValue(new PayPalError(422, 'UNPROCESSABLE_ENTITY', undefined, true));
  expect((await s.service.submit(s.dispute.dispute_id, a.id)).status).toBe('failed'); expect(s.paypal.getDispute).toHaveBeenCalledTimes(2); s.store.close();
});
it('treats HTTP request-timeout as unknown and blocks another write', async () => {
  const s = await setup(); const a = await s.service.approve(s.dispute.dispute_id, s.version.id, s.store.snapshotFingerprint(s.dispute.dispute_id));
  s.paypal.provideEvidence.mockRejectedValue(new PayPalError(408, 'REQUEST_TIMEOUT'));
  expect((await s.service.submit(s.dispute.dispute_id, a.id)).status).toBe('unknown');
  await expect(s.service.submit(s.dispute.dispute_id, a.id)).rejects.toThrow(); expect(s.paypal.provideEvidence).toHaveBeenCalledOnce(); s.store.close();
});
it.each(['weak-delivery', 'low-value'] as const)('guards and sends the approved %s action', async scenario => {
  const store = new CaseStore(':memory:'); const dispute = syntheticDispute(scenario); store.save(dispute); store.assignScenario(dispute.dispute_id, scenario);
  const { version } = await investigate(store, scripted(scenario), dispute.dispute_id);
  const paypal = { getDispute: vi.fn(async () => dispute), provideEvidence: vi.fn(), makeOffer: vi.fn(async () => ({})), acceptClaim: vi.fn(async () => ({})) };
  const service = new CaseService(store, paypal); const a = await service.approve(dispute.dispute_id, version!.id, store.snapshotFingerprint(dispute.dispute_id));
  expect((await service.submit(dispute.dispute_id, a.id)).status).toBe('submitted');
  if (scenario === 'low-value') expect(paypal.makeOffer).toHaveBeenCalledWith(dispute.dispute_id, { note: draft(scenario).evidence_draft.seller_note, offer_type: 'REFUND', offer_amount: { currency_code: 'USD', value: '6.00' } });
  else expect(paypal.acceptClaim).toHaveBeenCalledWith(dispute.dispute_id, { note: draft(scenario).evidence_draft.seller_note });
  expect(paypal.provideEvidence).not.toHaveBeenCalled(); store.close();
});
it('refuses an approved offer when the fresh dispute amount shrinks', async () => {
  const store = new CaseStore(':memory:'); const dispute = syntheticDispute('low-value'); store.save(dispute); store.assignScenario(dispute.dispute_id, 'low-value');
  const { version } = await investigate(store, scripted('low-value'), dispute.dispute_id);
  const paypal = { getDispute: vi.fn(async () => ({ ...dispute, dispute_amount: { currency_code: 'USD', value: '1.00' } })), provideEvidence: vi.fn(), makeOffer: vi.fn(), acceptClaim: vi.fn() };
  const service = new CaseService(store, paypal); const a = await service.approve(dispute.dispute_id, version!.id, store.snapshotFingerprint(dispute.dispute_id));
  await expect(service.submit(dispute.dispute_id, a.id)).rejects.toThrow('Offer no longer'); expect(paypal.makeOffer).not.toHaveBeenCalled(); store.close();
});
it('reserves the current version while the adapter awaits dispatch and blocks edits and investigations', async () => {
  const s = await setup();
  try {
    const a = await s.service.approve(s.dispute.dispute_id, s.version.id, s.store.snapshotFingerprint(s.dispute.dispute_id));
    let release!: () => void;
    let entered!: () => void;
    const inside = new Promise<void>(resolve => { entered = resolve; });
    s.paypal.provideEvidence.mockImplementation(async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); return {}; });
    const pending = s.service.submit(s.dispute.dispute_id, a.id); await inside;
    expect(() => s.service.edit(s.dispute.dispute_id, draft('strong-delivery'), s.version.id)).toThrow('pending');
    const model = scripted('strong-delivery');
    await expect(investigate(s.store, model, s.dispute.dispute_id)).rejects.toThrow('pending');
    expect(model.messages).toHaveLength(0);
    expect(s.store.versions(s.dispute.dispute_id)).toHaveLength(1);
    release(); expect((await pending).status).toBe('submitted');
  } finally { s.store.close(); }
});
it('rejects a reservation for a version replaced by an edit', async () => {
  const s = await setup();
  try {
    const a = await s.service.approve(s.dispute.dispute_id, s.version.id, s.store.snapshotFingerprint(s.dispute.dispute_id));
    s.service.edit(s.dispute.dispute_id, draft('strong-delivery'), s.version.id);
    expect(() => s.store.reserveSubmission({ id: 'stale', disputeId: s.dispute.dispute_id, versionId: s.version.id, approvalId: a.id, stage: a.content.stage, action: a.content.action, contentHash: a.contentHash, status: 'submitting', startedAt: new Date().toISOString() })).toThrow('version changed');
    expect(s.store.attempts(s.dispute.dispute_id)).toHaveLength(0);
  } finally { s.store.close(); }
});
it('blocks version creation by an investigation already running when submission was reserved', async () => {
  const s = await setup();
  try {
    const a = await s.service.approve(s.dispute.dispute_id, s.version.id, s.store.snapshotFingerprint(s.dispute.dispute_id));
    const model = scripted('strong-delivery');
    let finishModel!: () => void; let modelEntered!: () => void;
    const started = new Promise<void>(resolve => { modelEntered = resolve; });
    const slow = { model: model.model, async complete(...args: Parameters<typeof model.complete>) { const reply = await model.complete(...args); if (reply.content) { modelEntered(); await new Promise<void>(resolve => { finishModel = resolve; }); } return reply; } };
    const investigating = investigate(s.store, slow, s.dispute.dispute_id); await started;
    let finishWrite!: () => void; let writeEntered!: () => void;
    const dispatching = new Promise<void>(resolve => { writeEntered = resolve; });
    s.paypal.provideEvidence.mockImplementation(async () => { writeEntered(); await new Promise<void>(resolve => { finishWrite = resolve; }); return {}; });
    const submission = s.service.submit(s.dispute.dispute_id, a.id); await dispatching;
    finishModel(); const result = await investigating;
    expect(result.version).toBeUndefined(); expect(result.run.status).toBe('failed');
    expect(s.store.versions(s.dispute.dispute_id)).toHaveLength(1);
    finishWrite(); await submission;
  } finally { s.store.close(); }
});

it.each([422, 408, 503])('persists safe PayPal diagnostics for HTTP %s and returns them through the case API', async status => {
  const { detailView } = await import('../api/views');
  const s = await setup();
  try {
    const a = await s.service.approve(s.dispute.dispute_id, s.version.id, s.store.snapshotFingerprint(s.dispute.dispute_id));
    s.paypal.provideEvidence.mockRejectedValue(new PayPalError(status, 'UNPROCESSABLE_ENTITY', 'debug123', false, {
      message: 'The requested action could not be performed.', details: [{ issue: 'MISSING_TRACKING_INFO', field: '/evidences/0/evidence_info/tracking_info', description: 'The tracking number and carrier name are missing.' }],
    }));
    const result = await s.service.submit(s.dispute.dispute_id, a.id);
    expect(result.status).toBe(status === 422 ? 'failed' : 'unknown');
    expect(result.paypalError).toMatchObject({ status, debug_id: 'debug123', details: [{ issue: 'MISSING_TRACKING_INFO' }] });
    expect(s.store.attempts(s.dispute.dispute_id)[0]?.paypalError).toEqual(result.paypalError);
    expect(detailView(s.store, s.dispute.dispute_id).attempts[0]?.paypalError).toEqual(result.paypalError);
  } finally { s.store.close(); }
});
