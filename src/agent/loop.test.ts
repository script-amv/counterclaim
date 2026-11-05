import { describe, it, expect } from 'vitest';
import { CaseStore } from '../cases/storage';
import { investigate, READ_TOOLS } from './loop';
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
