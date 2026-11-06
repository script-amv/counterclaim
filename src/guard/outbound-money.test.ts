import { expect, it } from 'vitest';
import { checkCaseFile, checkOutboundNote } from './case-file';
import { draft } from '../agent/test-fixtures';
import { scenarios, syntheticDispute } from '../records';
import { trustedFacts } from '../agent/facts';

const disputed = { currency_code: 'USD', value: '12.00' };
const offer = { currency_code: 'USD', value: '6.00' };
const settlement = { action: 'make-offer' as const, offer };
const sources = scenarios['low-value'].map(data => ({ id: data.id, data }));

it.each(['$6.00', '6.00 USD', 'USD 6', '$6', '6 dollars', '6.000 USD'])('allows the exact structured offer as %s', amount => {
  expect(checkOutboundNote(`We offer ${amount}.`, sources, disputed, settlement)).toEqual([]);
});
it.each(['$12.00', '12.00 USD', 'USD 12'])('allows the disputed amount as %s', amount => {
  expect(checkOutboundNote(`The disputed amount is ${amount}.`, sources, disputed)).toEqual([]);
});
it('does not scan parts of permitted decimals as internal integers', () => {
  expect(checkOutboundNote('We offer $6.20.', sources, disputed, { ...settlement, offer: { ...offer, value: '6.20' } })).toEqual([]);
});
it.each(['$3.00', '$2.00', '$5.00', '$7.00', '-$5.00', '$99', '6 EUR', '6.001 USD', '99.00'])('blocks every other financial figure: %s', amount => {
  expect(checkOutboundNote(`The amount is ${amount}.`, sources, disputed, settlement).join(' ')).toContain('OUTBOUND_NOTE_MONEY:');
});
it.each(['provide-evidence', 'accept-claim'] as const)('does not authorize an attached offer for %s', action => {
  expect(checkOutboundNote('We offer $6.00.', sources, disputed, { ...settlement, action }).join(' ')).toContain('OUTBOUND_NOTE_MONEY:');
});
it.each(['We offer $7.00.', 'We offer $12.00.', 'We offer USD 7.', 'We offer 7.00.', 'Our $12.00 offer is available.', 'A $7.00 partial refund is available.'])('identifies an offer mismatch: %s', note => {
  expect(checkOutboundNote(note, sources, disputed, settlement).join(' ')).toContain('OUTBOUND_NOTE_OFFER_AMOUNT_MISMATCH:');
});
it('allows both the dispute and the distinct offer in the note', () => {
  expect(checkOutboundNote('The disputed amount is $12.00. We offer $6.00.', sources, disputed, settlement)).toEqual([]);
});
it.each(['REFUND', 'REFUND_WITH_RETURN', 'REFUND_WITH_REPLACEMENT'] as const)('allows a structured refund for %s', offerType => {
  expect(checkOutboundNote('We offer $6.00 with a $2.00 refund.', sources, disputed, { ...settlement, offerType, refund: { ...offer, value: '2.00' } })).toEqual([]);
});
it('does not authorize a refund for replacement without refund', () => {
  expect(checkOutboundNote('A $2.00 refund.', sources, disputed, { ...settlement, offerType: 'REPLACEMENT_WITHOUT_REFUND', refund: { ...offer, value: '2.00' } }).join(' ')).toContain('OUTBOUND_NOTE_MONEY:');
});
it('accepts a low-value case file proposing its structured amount', () => {
  const file = draft('low-value'); file.evidence_draft.seller_note = 'We offer a $6.00 partial refund to resolve this inquiry.';
  const facts = trustedFacts(syntheticDispute('low-value'), scenarios['low-value']);
  expect(checkCaseFile(file, [...sources, { id: 'dispute.dispute_amount', data: disputed }], [], facts)).toMatchObject({ accepted: true, reasons: [] });
});

it('does not backtrack into the integer prefix of an allowed disputed amount', () => {
  expect(checkOutboundNote('The disputed amount is $32.00.', sources, { ...disputed, value: '32.00' })).toEqual([]);
});
it('keeps money span offsets when ignoring dates before an internal integer', () => {
  expect(checkOutboundNote('2026-11-03 $6.00 and 3.', sources, disputed, settlement).join(' ')).toContain('OUTBOUND_NOTE_MONEY:');
});

it.each(['November 2, 2026', 'November 3, 2026'])('ignores the calendar day in %s without hiding later internal figures', date => {
  expect(checkOutboundNote(`Shipped on ${date}. We offer $6.00 USD.`, sources, disputed, settlement)).toEqual([]);
  expect(checkOutboundNote(`Shipped on ${date}. We offer $6.00 USD. Internal figure: 3.`, sources, disputed, settlement).join(' ')).toContain('OUTBOUND_NOTE_MONEY:');
  expect(checkOutboundNote(`Shipped on ${date}. We offer $6.00 USD. Another amount: $3.00.`, sources, disputed, settlement).join(' ')).toContain('OUTBOUND_NOTE_MONEY:');
});
