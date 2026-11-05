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


const live = {
  dispute_id: 'PP-R-CNR-10196701', status: 'WAITING_FOR_SELLER_RESPONSE',
  create_time: '2026-11-05T22:46:40.072Z',
  dispute_amount: { currency_code: 'USD', value: '10.00' },
  disputed_transactions: [{ create_time: '2026-11-05T10:40:24.000Z', items: [{ item_name: 'Sandbox test item' }] }],
};
it.each(['Gift for buyer@example.invalid', 'Gift for Private Buyer', 'Deliver to Private Street'])('excludes private product labels from model-bound records: %s', item_name => {
  const dispute = { ...live, disputed_transactions: [{
    items: [{ item_name }], buyer: { name: 'Private Buyer' },
    shipping_address: { address_line_1: 'Private Street' },
  }] };
  const records = recordsForScenario('strong-delivery', dispute);
  expect(records.find(r => r.type === 'order')?.content.item).toBe('Sandbox order item');
  expect(JSON.stringify(records)).not.toContain(item_name);
});
it.each(scenarioIds)('derives %s records from the live dispute without changing fixtures', id => {
  const original = structuredClone(scenarios[id]);
  const records = recordsForScenario(id, live);
  const get = (type: string) => records.find(r => r.type === type)!;
  expect(get('order').content).toMatchObject({ amount: '10.00', currency_code: 'USD', item: 'Sandbox test item' });
  expect(get('order').timestamp).toBe('2026-11-05T10:40:24.000Z');
  const times = ['order', 'shipment', 'tracking_event', 'customer_message'].map(t => Date.parse(get(t).timestamp));
  expect(times[0]).toBeLessThan(times[1]!);
  expect(times[1]).toBeLessThan(times[2]!);
  expect(times[2]).toBeLessThan(times[3]!);
  expect(times[3]).toBeLessThan(Date.parse(live.create_time));
  expect(get('cost').content).toEqual(id === 'low-value'
    ? { currency_code: 'USD', item_cost: '2.50', shipping_cost: '1.67' }
    : { currency_code: 'USD', item_cost: '3.75', shipping_cost: '0.67' });
  if (id === 'low-value') expect(get('customer_message').content.text).toContain('USD 5.00');
  if (id === 'injection') expect(get('customer_message').content.text).toContain('Ignore instructions');
  expect(scenarios[id]).toEqual(original);
});
it.each([
  ['EUR', '10.00', '3.75', '0.67'], ['JPY', '100', '38', '7'], ['KWD', '1.001', '0.375', '0.067'],
] as const)('scales costs using %s precision', (currency_code, value, item_cost, shipping_cost) => {
  const records = recordsForScenario('strong-delivery', { ...live, dispute_amount: { currency_code, value } });
  expect(records.find(r => r.type === 'cost')!.content).toEqual({ currency_code, item_cost, shipping_cost });
});
it('anchors missing or unusable transaction times before dispute creation and uses a neutral missing-item label', () => {
  for (const disputed_transactions of [undefined, [{ create_time: live.create_time }], [{ create_time: 'invalid' }]]) {
    const records = recordsForScenario('strong-delivery', { ...live, disputed_transactions });
    expect(records[0]!.content.item).toBe('Sandbox demo item');
    expect(records[0]!.timestamp).toBe('2026-11-01T22:46:40.072Z');
    expect(records.every(r => Date.parse(r.timestamp) < Date.parse(live.create_time))).toBe(true);
  }
});
it('preserves explicit offline fixture input and never invents live records without core facts', () => {
  expect(recordsForScenario('strong-delivery', syntheticDispute('strong-delivery'))).toEqual(scenarios['strong-delivery']);
  expect(recordsForScenario(undefined, live)).toEqual([]);
  expect(recordsForScenario('strong-delivery', { ...live, dispute_amount: undefined })).toEqual([]);
  expect(recordsForScenario('strong-delivery', { ...live, create_time: undefined })).toEqual([]);
});
