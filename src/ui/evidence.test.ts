import { expect, it } from 'vitest';
import { claimHighlights, instructionNotice } from './evidence';
import { trustedFacts } from '../agent/facts';
import { recordsForScenario, syntheticDispute } from '../records';

it('highlights only trusted fields bearing on a shipment claim', () => {
  const records = recordsForScenario('strong-delivery');
  const facts = trustedFacts(syntheticDispute('strong-delivery'), records);
  const source = { id: records[1]!.id, data: records[1] };
  expect(claimHighlights('The parcel was delivered, signed for, to the matching address.', source, facts)).toEqual(['status', 'signed', 'address_matches']);
  expect(claimHighlights('The parcel was delivered.', source, facts)).toEqual(['status']);
  expect(claimHighlights('The parcel was delivered.', { ...source, data: { ...records[1], content: { status: 'STALLED' } } }, facts)).toEqual([]);
});
it('maps money claims to amounts, never metadata', () => {
  const records = recordsForScenario('low-value');
  const facts = trustedFacts(syntheticDispute('low-value'), records);
  expect(claimHighlights('Recorded costs are USD 3.00 item and USD 2.00 shipping.', { id: records[5]!.id, data: records[5] }, facts)).toEqual(['item_cost', 'shipping_cost']);
});
it('detects instruction-like customer text by content and reports only verified exclusion', () => {
  const records = recordsForScenario('injection');
  expect(instructionNotice(records, 'fight', true, trustedFacts(syntheticDispute('injection'), records))).toContain('not followed');
  expect(instructionNotice(records.map(r => ({ ...r, id: 'other-id' })), 'fight', true, trustedFacts(syntheticDispute('injection'), records))).toContain('not followed');
  expect(instructionNotice(recordsForScenario('strong-delivery'), 'fight', true, trustedFacts(syntheticDispute('strong-delivery'), recordsForScenario('strong-delivery')))).toBeNull();
  expect(instructionNotice(records, 'refund', false, trustedFacts(syntheticDispute('injection'), records))).not.toContain('not followed');
});
it('highlights the trusted disputed amount and refuses mismatched amounts', () => {
  const facts = trustedFacts(syntheticDispute('low-value'), recordsForScenario('low-value'));
  expect(claimHighlights('USD 12.00 disputed', { id: 'dispute.dispute_amount', data: { currency_code: 'USD', value: '12.00' } }, facts)).toEqual(['value']);
  expect(claimHighlights('USD 12.00 disputed', { id: 'dispute.dispute_amount', data: { currency_code: 'USD', value: '120.00' } }, facts)).toEqual([]);
});
