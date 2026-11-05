import { describe, expect, it } from 'vitest';
import { moneyFacts, units } from './money';
import { syntheticDispute, type SellerRecord } from '../records';

const dispute = syntheticDispute('strong-delivery');
const cost = (content: Record<string, unknown> = { currency_code: 'USD', item_cost: '45.00', shipping_cost: '8.00' }): SellerRecord => ({
  id: 'demo-cost', type: 'cost', timestamp: '2026-11-01T00:00:00.000Z', source: 'Sandbox demo cost', content,
});
describe('record-only money facts', () => {
  it('computes conditional net outcomes without probabilities or assumed fees', () => {
    expect(moneyFacts(dispute, [cost()])).toEqual({ currency_code: 'USD', disputed_amount: '120.00', item_cost: '45.00', shipping_cost: '8.00', total_recorded_costs: '53.00', net_if_won: '67.00', net_if_lost: '-53.00', gaps: [] });
  });
  it('reports missing costs without inventing a net outcome', () => {
    expect(moneyFacts(dispute, [])).toMatchObject({ item_cost: null, shipping_cost: null, net_if_won: null, net_if_lost: null });
    expect(moneyFacts(dispute, []).gaps.join(' ')).toContain('missing');
  });
  it.each([
    [cost(), cost()],
    [cost({ currency_code: 'EUR', item_cost: '45.00', shipping_cost: '8.00' })],
    [cost({ currency_code: 'USD', item_cost: '45.00' })],
  ])('refuses ambiguous, mixed-currency, and incomplete cost records', (...records) => {
    const result = moneyFacts(dispute, records);
    expect(result.net_if_won).toBeNull(); expect(result.net_if_lost).toBeNull(); expect(result.gaps).not.toEqual([]);
  });
  it('reports a missing disputed amount', () => {
    const without = { ...dispute }; delete without.dispute_amount;
    expect(moneyFacts(without, [cost()])).toMatchObject({ disputed_amount: null, net_if_won: null, net_if_lost: null });
    expect(moneyFacts(without, [cost()]).gaps).toContain('Disputed amount is missing');
  });
  it('uses exact arithmetic for very large values and mill precision', () => {
    const amount = { ...dispute, dispute_amount: { currency_code: 'USD', value: '9007199254740993.001' } };
    expect(moneyFacts(amount, [cost({ currency_code: 'USD', item_cost: '0.001', shipping_cost: '0.002' })])).toMatchObject({ net_if_won: '9007199254740992.998', net_if_lost: '-0.003', gaps: [] });
  });
  it('can report a negative net if recorded costs exceed disputed proceeds', () => {
    const amount = { ...dispute, dispute_amount: { currency_code: 'USD', value: '1.00' } };
    expect(moneyFacts(amount, [cost()])).toMatchObject({ net_if_won: '-52.00', net_if_lost: '-53.00' });
  });
  it.each(['1.0001', '-1.00', 'NaN', '1e2'])('does not compute from unsupported amount %s', value => {
    const result = moneyFacts({ ...dispute, dispute_amount: { currency_code: 'USD', value } }, [cost()]);
    expect(result.net_if_won).toBeNull(); expect(result.net_if_lost).toBeNull(); expect(result.gaps).toContain('Amounts have unsupported precision or invalid format');
  });
  it('supports integer currencies without a rounding assumption', () => {
    expect(moneyFacts({ ...dispute, dispute_amount: { currency_code: 'JPY', value: '1200' } }, [cost({ currency_code: 'JPY', item_cost: '450', shipping_cost: '80' })])).toMatchObject({ net_if_won: '670', net_if_lost: '-530', gaps: [] });
  });
  it('converts amounts to fixed units without floating-point rounding', () => {
    expect(units('0.1')).toBe(100n); expect(units('0.001')).toBe(1n); expect(units('1', 0)).toBe(1n);
    expect(() => units('1.01', 0)).toThrow('precision');
  });
});

it('exposes the positive recorded cost total separately from signed net loss', () => {
  expect(moneyFacts(dispute, [cost()])).toMatchObject({ total_recorded_costs: '53.00', net_if_lost: '-53.00' });
});
