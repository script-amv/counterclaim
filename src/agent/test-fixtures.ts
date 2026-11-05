import type { ModelProvider, ModelReply, Message } from './provider';
import type { CaseFile } from './schema';
import { scenarios, type ScenarioId } from '../records';
export function draft(scenario: ScenarioId): CaseFile {
  const action = scenario === 'weak-delivery' ? 'refund' : scenario === 'low-value' ? 'offer' : 'fight';
  return { summary: 'Sandbox demo case', timeline: [{ date: '2026-11-03T10:00:00Z', event: 'Carrier scan recorded', citations: [`${scenario}-tracking_event-01`] }],
    claims: [{ text: 'The shipment record describes delivery status.', citations: [`${scenario}-shipment-01`] }],
    gaps: action === 'fight' ? [] : [{ missing: 'Confirmed delivery', why_it_matters: 'Receipt cannot be established' }],
    recommendation: { action, reasoning: action === 'refund' ? 'Stalled tracking and a different address advise against fighting.' : action === 'offer' ? 'Small amount and a customer willing to settle.' : 'Signed delivery to the matching address.', confidence: { level: 'medium', reason: 'Synthetic evidence only' }, ...(action === 'offer' ? { offer_amount: { currency_code: 'USD', value: '6.00' } } : {}) },
    evidence_draft: { seller_note: 'Sandbox demo seller note', attach_records: [`${scenario}-shipment-01`] } };
}
export class ScriptedProvider implements ModelProvider {
  model = 'scripted-offline'; messages: Message[][] = [];
  constructor(private replies: ModelReply[]) {}
  async complete(messages: Message[]) { this.messages.push(structuredClone(messages)); const reply = this.replies.shift(); if (!reply) throw new Error('Script exhausted'); return reply; }
}
export function scripted(scenario: ScenarioId, output: unknown = draft(scenario)) {
  return new ScriptedProvider([
    { toolCalls: [{ id: 'd', name: 'get_dispute', arguments: '{}' }, { id: 'l', name: 'list_records', arguments: '{}' }], usage: { total_tokens: 12 } },
    { toolCalls: scenarios[scenario].map((r, i) => ({ id: String(i), name: 'read_record', arguments: JSON.stringify({ id: r.id }) })), usage: { total_tokens: 20 } },
    { content: JSON.stringify(output), usage: { total_tokens: 30, cost: 0.001 } },
  ]);
}
