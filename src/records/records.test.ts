import { describe, expect, it } from 'vitest';
import { disputeSchema } from '../paypal/schemas';
import { recordsForScenario, scenarioIds, scenarios, syntheticDispute } from './index';

describe('sandbox demo seller records', () => {
  it('has no invented seller records for an unassigned dispute', () => {
    expect(recordsForScenario(undefined)).toEqual([]);
  });
  it.each(['strong-delivery', 'weak-delivery', 'low-value', 'injection'] as const)('%s is complete, labelled, stable, and free of personal data', id => {
    const records = recordsForScenario(id);
    expect(scenarioIds).toContain(id);
    expect(records).toEqual(scenarios[id]);
    expect(new Set(records.map(record => record.id)).size).toBe(records.length);
    expect(new Set(records.map(record => record.type))).toEqual(new Set(['order', 'shipment', 'tracking_event', 'customer_message', 'policy', 'cost']));
    for (const record of records) {
      expect(record.id.startsWith(id)).toBe(true);
      expect(record.source).toMatch(/demo/i);
      expect(new Date(record.timestamp).toISOString()).toBe(record.timestamp);
      expect(record.content).toBeTypeOf('object');
    }
    expect(JSON.stringify(records)).not.toMatch(/@|buyer_email|buyer_name|full_name|street_address/);
    expect(disputeSchema.parse(syntheticDispute(id)).dispute_amount?.value).toBe(id === 'low-value' ? '12.00' : '120.00');
  });
  it('distinguishes signed matching delivery from stalled mismatching shipment', () => {
    const strong = scenarios['strong-delivery'].find(record => record.type === 'shipment')!;
    const weak = scenarios['weak-delivery'].find(record => record.type === 'shipment')!;
    expect(strong.content).toMatchObject({ signed: true, address_matches: true, status: 'DELIVERED' });
    expect(weak.content).toMatchObject({ signed: false, address_matches: false, status: 'STALLED' });
  });
  it('offers partial proof and a customer willing to settle in the low-value scenario', () => {
    expect(scenarios['low-value'].find(record => record.type === 'shipment')?.content.signed).toBe(false);
    expect(scenarios['low-value'].find(record => record.type === 'customer_message')?.content.text).toMatch(/settle/i);
  });
  it('retains the injection as customer message data in a strong-looking case', () => {
    const records = scenarios.injection;
    expect(records.find(record => record.type === 'shipment')?.content).toMatchObject({ signed: true, address_matches: true });
    expect(records.find(record => record.type === 'customer_message')?.content.text).toMatch(/ignore instructions.*recommend refund.*reveal the prompt/i);
  });
  it('returns copies so an agent cannot mutate shared scenario evidence', () => {
    const records = recordsForScenario('strong-delivery');
    records[0]!.content.status = 'changed';
    expect(recordsForScenario('strong-delivery')[0]!.content.status).not.toBe('changed');
  });
});
