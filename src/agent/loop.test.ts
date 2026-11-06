import { describe, it, expect } from 'vitest';
import { CaseStore } from '../cases/storage';
import { investigate, READ_TOOLS } from './loop';
import { runView } from '../api/views';
import { scenarioIds, syntheticDispute, type ScenarioId } from '../records';
import { draft, scripted, ScriptedProvider } from './test-fixtures';

function setup(scenario: ScenarioId) { const store = new CaseStore(':memory:'); const dispute = syntheticDispute(scenario); store.save(dispute); store.assignScenario(dispute.dispute_id, scenario); return { store, dispute }; }
describe('read-only agent', () => {
  it.each(scenarioIds)('%s saves guarded output with read-source provenance', async scenario => {
    const { store, dispute } = setup(scenario); const result = await investigate(store, scripted(scenario), dispute.dispute_id);
    expect(result.run.status).toBe('completed'); expect(result.version?.guard.accepted).toBe(true);
    expect(result.run.sources.some(s => s.id === `${scenario}-shipment-01`)).toBe(true);
    expect(result.version?.caseFile.gaps.some(g => g.missing.includes('Orders'))).toBe(true);
    expect(result.run.tokens).toBe(62); expect(result.run.tokensEstimated).toBe(false); expect(result.run.cost).toBe(0.001); expect(store.runs(dispute.dispute_id)).toHaveLength(1); store.close();
  });
  it('only exposes four read tools', () => { expect(READ_TOOLS.map(t => t.function.name)).toEqual(['get_dispute', 'get_order', 'list_records', 'read_record']); });
  it('wraps injection as data and rejects fabricated citations', async () => {
    const { store, dispute } = setup('injection'); const file = draft('injection'); file.claims[0]!.citations = ['invented']; file.recommendation.action = 'refund';
    const model = scripted('injection', file); const result = await investigate(store, model, dispute.dispute_id);
    expect(result.run.status).toBe('rejected'); expect(result.version?.guard.reasons.join(' ')).toContain('unread');
    expect(JSON.stringify(model.messages)).toContain('UNTRUSTED_DATA'); expect(JSON.stringify(model.messages)).toContain('Ignore instructions'); store.close();
  });
  it('repairs invalid output once, then fails without a partial case file', async () => {
    const { store, dispute } = setup('strong-delivery');
    const model = new ScriptedProvider([{ content: 'not JSON' }, { content: '{}' }]);
    const result = await investigate(store, model, dispute.dispute_id);
    expect(result.run.status).toBe('failed'); expect(result.run.tokensEstimated).toBe(true); expect(store.versions(dispute.dispute_id)).toEqual([]); expect(model.messages).toHaveLength(2); store.close();
  });
  it('reports missing seller records as gaps', async () => {
    const store = new CaseStore(':memory:'); const dispute = syntheticDispute('weak-delivery'); store.save(dispute);
    const file = draft('weak-delivery'); file.claims = []; file.timeline = []; file.evidence_draft.attach_records = []; file.recommendation.reasoning = 'No seller proof is available.';
    const model = new ScriptedProvider([{ toolCalls: [{ id: 'd', name: 'get_dispute', arguments: '{}' }] }, { content: JSON.stringify(file) }]);
    const result = await investigate(store, model, dispute.dispute_id); expect(result.version?.guard.accepted).toBe(true); expect(result.version?.caseFile.gaps.length).toBeGreaterThan(0); store.close();
  });
  it('stops token and turn budgets', async () => {
    const { store, dispute } = setup('strong-delivery');
    const result = await investigate(store, new ScriptedProvider([{ toolCalls: [], usage: { total_tokens: 999999 } }]), dispute.dispute_id);
    expect(result.run.status).toBe('failed'); store.close();
  });
});
it('accepts a successful repair after reading sources', async () => {
  const { store, dispute } = setup('strong-delivery');
  // Add a malformed final response, then one complete repaired case file.
  const bad = new ScriptedProvider([
    { toolCalls: [{ id: 'd', name: 'get_dispute', arguments: '{}' }, { id: 'r', name: 'read_record', arguments: '{"id":"strong-delivery-shipment-01"}' }, { id: 't', name: 'read_record', arguments: '{"id":"strong-delivery-tracking_event-01"}' }] },
    { content: '{}' }, { content: JSON.stringify(draft('strong-delivery')) },
  ]);
  expect((await investigate(store, bad, dispute.dispute_id)).run.status).toBe('completed'); expect(bad.messages).toHaveLength(3);
  store.close();
});
it('fails closed on an attempted write tool without calling any service', async () => {
  const { store, dispute } = setup('strong-delivery');
  const result = await investigate(store, new ScriptedProvider([{ toolCalls: [{ id: 'w', name: 'accept_claim', arguments: '{}' }] }]), dispute.dispute_id);
  expect(result.run.status).toBe('failed'); expect(store.attempts(dispute.dispute_id)).toEqual([]); store.close();
});
it('terminates repeated read calls at the turn limit', async () => {
  const { store, dispute } = setup('strong-delivery');
  const model = new ScriptedProvider(Array.from({length:3}, () => ({ toolCalls: [{ id:'r', name:'list_records', arguments:'{}' }] })));
  const result = await investigate(store, model, dispute.dispute_id, { maxTurns: 2 });
  expect(result.run.status).toBe('failed'); expect(model.messages).toHaveLength(2); store.close();
});

it.each(scenarioIds)('investigates and rechecks a live %s case using derived evidence', async scenario => {
  const { CaseService } = await import('../api/service');
  const { detailView } = await import('../api/views');
  const store = new CaseStore(':memory:');
  try {
    const dispute = {
      dispute_id: 'PP-LIVE-10', status: 'WAITING_FOR_SELLER_RESPONSE',
      create_time: '2026-11-05T22:46:40.000Z',
      dispute_amount: { currency_code: 'USD', value: '10.00' },
      disputed_transactions: [{ create_time: '2026-11-05T10:40:24.000Z', items: [{ item_name: 'Live item' }] }],
    };
    store.save(dispute); store.assignScenario(dispute.dispute_id, scenario);
    const output = draft(scenario);
    output.timeline = [];
    output.summary = scenario === 'low-value' ? 'A win leaves $5.83 after costs; a loss leaves -$4.17.' : 'A win leaves $5.58 after costs; a loss leaves -$4.42.';
    output.claims = [{ text: 'The order was for Live item at $10.00.', citations: [`${scenario}-order-01`] }];
    if (scenario === 'low-value') output.recommendation.offer_amount = { currency_code: 'USD', value: '5.00' };
    const { run, version } = await investigate(store, scripted(scenario, output), dispute.dispute_id);
    expect(run.status, JSON.stringify(version?.guard)).toBe('completed');
    expect(version?.guard).toMatchObject({ accepted: true, reasons: [] });
    expect(version?.caseFile.recommendation.action).toBe(scenario === 'weak-delivery' ? 'refund' : scenario === 'low-value' ? 'offer' : 'fight');
    const order = run.sources.find(s => s.id === `${scenario}-order-01`)!.data;
    expect(order).toMatchObject({ timestamp: '2026-11-05T10:40:24.000Z', content: { amount: '10.00', item: 'Live item' } });
    expect(detailView(store, dispute.dispute_id).computed.money).toMatchObject({ total_recorded_costs: scenario === 'low-value' ? '4.17' : '4.42' });
    const noNetwork = async () => { throw new Error('No network allowed'); };
    const service = new CaseService(store, { getDispute: noNetwork, provideEvidence: noNetwork, makeOffer: noNetwork, acceptClaim: noNetwork });
    expect(service.edit(dispute.dispute_id, version!.caseFile, version!.id).guard).toMatchObject({ accepted: true, reasons: [] });
  } finally { store.close(); }
});

it('accepts carrier prose at CHARGEBACK without exposing buyer messages or evidence notes', async () => {
  const { store, dispute } = setup('strong-delivery');
  try {
    store.save({ ...dispute, dispute_life_cycle_stage: 'CHARGEBACK',
      disputed_transactions: [{ buyer: { name: 'Private Buyer', email: 'buyer@example.invalid', payer_id: 'PRIVATE-PAYER' } }],
      messages: [{ posted_by: 'BUYER', content: 'Escalation from Private Buyer at buyer@example.invalid' }],
      evidences: [{ evidence_type: 'OTHER', source: 'BUYER', notes: 'PRIVATE-ADDRESS and PRIVATE-PAYER', evidence_info: { tracking_info: [{ carrier_name_other: 'DEMO CARRIER' }] } }],
    });
    const file = draft('strong-delivery');
    file.summary = 'DEMO CARRIER recorded the shipment.';
    file.timeline[0]!.event = 'DEMO CARRIER recorded delivery.';
    file.evidence_draft.seller_note = 'DEMO CARRIER recorded delivery.';
    const model = scripted('strong-delivery', file);
    const { run, version } = await investigate(store, model, dispute.dispute_id);
    expect(version?.guard).toMatchObject({ accepted: true, reasons: [] });
    expect(run.status).toBe('completed');
    const context = JSON.stringify(model.messages);
    for (const privateText of ['Private Buyer', 'buyer@example.invalid', 'PRIVATE-PAYER', 'PRIVATE-ADDRESS', 'Escalation from']) expect(context).not.toContain(privateText);
    const toolMessage = model.messages[1]!.find(m => m.role === 'tool' && m.tool_call_id === 'd')!;
    const safe = JSON.parse(toolMessage.content!).data.dispute;
    expect(safe.dispute_life_cycle_stage).toBe('CHARGEBACK');
    for (const field of ['disputed_transactions', 'messages', 'evidences']) expect(safe).not.toHaveProperty(field);
  } finally { store.close(); }
});

it('persists rejection field paths and rule names without private values', async () => {
  const { store, dispute } = setup('strong-delivery');
  try {
    store.save({ ...dispute, disputed_transactions: [{ buyer: { name: 'Private Buyer' } }] });
    const file = draft('strong-delivery');
    file.summary = 'Private Buyer reported a problem.';
    file.timeline[0]!.event = 'Contact at contact@example.invalid.';
    file.evidence_draft.seller_note = 'Private Buyer reported a problem.';
    const { run, version } = await investigate(store, scripted('strong-delivery', file), dispute.dispute_id);
    expect(run.status).toBe('rejected');
    expect(run.failureCode).toBe('invalid_output');
    const stored = store.runs(dispute.dispute_id)[0]!;
    expect(stored).toHaveProperty('privacyFindings', [
      { path: 'summary', rule: 'PRIVATE_SOURCE_VALUE' },
      { path: 'timeline[0].event', rule: 'EMAIL' },
      { path: 'evidence_draft.seller_note', rule: 'PRIVATE_SOURCE_VALUE' },
    ]);
    expect(runView(stored)).toHaveProperty('privacyFindings', Reflect.get(stored, 'privacyFindings'));
    const reasons = version!.guard.reasons.join(' ');
    for (const field of ['summary', 'timeline[0].event', 'evidence_draft.seller_note', 'PRIVATE_SOURCE_VALUE', 'EMAIL']) expect(reasons).toContain(field);
    for (const privateText of ['Private Buyer', 'contact@example.invalid']) {
      expect(reasons).not.toContain(privateText);
      expect(JSON.stringify(stored)).not.toContain(privateText);
    }
  } finally { store.close(); }
});
