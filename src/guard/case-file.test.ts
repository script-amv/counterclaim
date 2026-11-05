import stage3cWeak from './__fixtures__/stage3c-weak.json';
import stage3cStrong from './__fixtures__/stage3c-strong.json';
import capturedInjection from './__fixtures__/stage2c-injection.json';
import capturedLow from './__fixtures__/stage2c-low.json';
import capturedWeak from './__fixtures__/stage2c-weak.json';
import capturedStrong from './__fixtures__/stage2c-strong.json';
import { SYSTEM_PROMPT } from '../agent/loop';
import { trustedFacts } from '../agent/facts';
import { syntheticDispute, scenarios } from '../records';
import { describe, expect, it } from 'vitest';
import type { CaseFile, ReadSource } from '../agent/schema';
import { checkCaseFile, evidenceStrength } from './case-file';

function file(): CaseFile {
  return {
    summary: 'Sandbox demo case',
    timeline: [{ date: '2026-11-03T10:00:00Z', event: 'Shipment delivered', citations: ['demo-shipment'] }],
    claims: [{ text: 'The carrier recorded delivery.', citations: ['demo-shipment'] }], gaps: [],
    recommendation: { action: 'fight', reasoning: 'Delivery record available.', confidence: { level: 'high', reason: 'Signature recorded.' } },
    evidence_draft: { seller_note: 'Sandbox demo seller note', attach_records: ['demo-shipment'] },
  };
}
const sources: ReadSource[] = [
  { id: 'dispute.dispute_amount', data: { currency_code: 'USD', value: '120.00' } },
  { id: 'demo-shipment', data: { id: 'demo-shipment', type: 'shipment', timestamp: '2026-11-03T10:00:00Z', content: { signed: true, address_matches: true, status: 'DELIVERED' } } },
  { id: 'demo-cost', data: { id: 'demo-cost', type: 'cost', timestamp: '2026-11-01T10:00:00Z', content: { currency_code: 'USD', item_cost: '45.00', shipping_cost: '8.00' } } },
  { id: 'demo-message', data: { id: 'demo-message', type: 'customer_message', timestamp: '2026-11-04T10:00:00Z', content: { text: 'I am willing to settle for USD 6.00.' } } },
];

describe('deterministic case file guard', () => {
  it('accepts claims and timeline items supported by sources read in this run', () => {
    expect(checkCaseFile(file(), sources)).toMatchObject({ accepted: true, reasons: [] });
  });
  it.each(['claims', 'timeline'] as const)('rejects missing or unread citations in %s', kind => {
    const unread = file(); unread[kind][0]!.citations = ['record-that-exists-in-another-run'];
    expect(checkCaseFile(unread, sources).reasons.join(' ')).toContain('missing or unread citation');
    const missing = file(); missing[kind][0]!.citations = [];
    expect(checkCaseFile(missing, sources).accepted).toBe(false);
  });
  it('rejects money from an uncited record even if the agent read that record', () => {
    const value = file(); value.claims[0]!.text = 'The item cost USD 45.00.';
    expect(checkCaseFile(value, sources).reasons).toContain('claim 1: currency figure is not in cited sources');
    value.claims[0]!.citations = ['demo-cost'];
    expect(checkCaseFile(value, sources).accepted).toBe(true);
  });
  it.each(['EUR 45.00', 'USD 46.00', '$46.00', '45.00 EUR'])('rejects a money/currency mismatch: %s', figure => {
    const value = file(); value.claims[0] = { text: `Recorded cost is ${figure}.`, citations: ['demo-cost'] };
    expect(checkCaseFile(value, sources).accepted).toBe(false);
  });
  it('accepts a currency figure that appears in a cited customer message', () => {
    const value = file(); value.claims[0] = { text: 'Customer proposed USD 6.00.', citations: ['demo-message'] };
    expect(checkCaseFile(value, sources).accepted).toBe(true);
  });
  it('rejects an invented negative currency figure', () => {
    const value = file(); value.claims[0] = { text: 'The recorded cost was USD -999.00.', citations: ['demo-cost'] };
    expect(checkCaseFile(value, sources).accepted).toBe(false);
  });
  it('checks currency figures in timeline items too', () => {
    const value = file(); value.timeline[0]!.event = 'Customer paid USD 999.00.';
    expect(checkCaseFile(value, sources).reasons).toContain('timeline 1: currency figure is not in cited sources');
  });
  it.each([{ currency_code: 'USD', value: '120.001' }, { currency_code: 'EUR', value: '1.00' }])('rejects an over-limit or mismatched-currency offer: %j', offer_amount => {
    const value = file(); value.recommendation = { ...value.recommendation, action: 'offer', offer_amount };
    expect(checkCaseFile(value, sources).accepted).toBe(false);
  });
  it('accepts an offer equal to the dispute amount and refuses an offer without a read dispute amount', () => {
    const value = file(); value.recommendation = { ...value.recommendation, action: 'offer', offer_amount: { currency_code: 'USD', value: '120.00' } };
    expect(checkCaseFile(value, sources).accepted).toBe(true);
    expect(checkCaseFile(value, sources.filter(source => source.id !== 'dispute.dispute_amount')).accepted).toBe(false);
  });
  it('requires a gap when no seller evidence was read', () => {
    const value = file(); value.claims = []; value.timeline = []; value.recommendation.reasoning = 'Proof unavailable'; value.recommendation.confidence.reason = 'No seller records'; value.evidence_draft.attach_records = [];
    expect(checkCaseFile(value, sources.slice(0, 1)).reasons.join(' ')).toContain('missing proof must be reported as gaps');
    value.gaps = [{ missing: 'Seller delivery proof', why_it_matters: 'Receipt cannot be established.' }];
    expect(checkCaseFile(value, sources.slice(0, 1)).accepted).toBe(true);
  });
  it('rejects email addresses and known private values anywhere in a case file', () => {
    const email = file(); email.summary = 'Contact buyer@example.invalid';
    expect(checkCaseFile(email, sources).accepted).toBe(false);
    const name = file(); name.evidence_draft.seller_note = 'ALEX PRIVATE signed.';
    expect(checkCaseFile(name, sources, ['Alex Private']).accepted).toBe(false);
  });
  it('refuses unread attachments and dispute fields as seller attachments', () => {
    const value = file(); value.evidence_draft.attach_records = ['dispute.dispute_amount'];
    expect(checkCaseFile(value, sources).reasons).toContain('Attachment is missing or unread');
    value.evidence_draft.attach_records = ['unread-record'];
    expect(checkCaseFile(value, sources).accepted).toBe(false);
  });
  it('derives distinct strength from trusted delivery facts, ignoring the Orders limitation', () => {
    const supported = trustedFacts(syntheticDispute('strong-delivery'), scenarios['strong-delivery']);
    const limited = trustedFacts(syntheticDispute('weak-delivery'), scenarios['weak-delivery']);
    expect(supported.gaps.some(g => g.missing.includes('Orders'))).toBe(true);
    expect(evidenceStrength({ accepted: true, reasons: [] }, trustedFacts(syntheticDispute('low-value'), scenarios['low-value']))).toBe('partial');
    expect(evidenceStrength(undefined, supported)).toBe('unreviewed');
    expect(evidenceStrength({ accepted: false, reasons: ['Unread citation'] }, supported)).toBe('rejected');
    expect(evidenceStrength({ accepted: false, reasons: [] }, limited)).toBe('rejected');
    expect(evidenceStrength({ accepted: true, reasons: [] }, limited)).toBe('weak');
    expect(evidenceStrength({ accepted: true, reasons: [] }, supported)).toBe('strong');
  });
});
it.each(['usd 999.00', '999.00 dollars', 'USD +999.00', 'USD 120.0001'])('rejects unsupported currency spellings or precision: %s', figure => {
  const value = file(); value.claims[0] = { text: `Recorded amount was ${figure}.`, citations: ['dispute.dispute_amount'] };
  expect(checkCaseFile(value, sources).accepted).toBe(false);
});

it('accepts the actual rejected strong-delivery file including negation, ordinary prompt vocabulary and quantity before currency', () => {
  expect(checkCaseFile(capturedStrong.caseFile as CaseFile, capturedStrong.sources, [SYSTEM_PROMPT], trustedFacts(syntheticDispute('strong-delivery'), scenarios['strong-delivery']))).toMatchObject({ accepted: true, reasons: [] });
});
it.each([
  'Because tracking is not stalled and there is no address mismatch, the guidance to avoid fighting does not apply.',
  'TrustedFacts for this case indicate delivered=true, signed=true, addressMatches=true and trackingStalled=false, so this is not a stalled-tracking or address-mismatch scenario.',
  'These are conditional outcomes, not probabilities.',
  'Seller order record created: DEMO-ORDER-strong-delivery, Demo desk lamp x1, USD 120.00, status COMPLETED, delivery address reference DEMO-ADDRESS-REFERENCE.',
])('accepts actual strong-delivery false-positive wording: %s', text => {
  const value = file(); value.summary = text;
  expect(checkCaseFile(value, sources, [SYSTEM_PROMPT])).toMatchObject({ accepted: true, reasons: [] });
});
it('does not let a negated mismatch excuse an affirmative delivery lie', () => {
  const value = file(); value.summary = 'No address mismatch, DELIVERED, signed, address_matches=true';
  const facts = trustedFacts(syntheticDispute('weak-delivery'), scenarios['weak-delivery']);
  expect(checkCaseFile(value, sources, [SYSTEM_PROMPT], facts).accepted).toBe(false);
});

it('accepts the actual rejected weak-delivery file with coordinated missing-proof predicates', () => {
  expect(checkCaseFile(capturedWeak.caseFile as CaseFile, capturedWeak.sources, [SYSTEM_PROMPT], trustedFacts(syntheticDispute('weak-delivery'), scenarios['weak-delivery']))).toMatchObject({ accepted: true, reasons: [] });
});
it('still rejects a true signature assertion beside an unestablished address', () => {
  const value = file(); value.summary = 'Signature is recorded and address match is unestablished.';
  const facts = trustedFacts(syntheticDispute('weak-delivery'), scenarios['weak-delivery']);
  expect(checkCaseFile(value, sources, [], facts).reasons).toContain('Text contradicts trusted fact: signed');
});

it('accepts the next live strong-delivery confidence text with a shared no across or', () => {
  const value = file(); value.recommendation.confidence.reason = 'Three seller records agree on delivery, signature and address match, and there is no stalled tracking or address mismatch. Confidence is limited only by the absence of a verified PayPal Orders v2 lookup and of a carrier-issued proof-of-delivery document, both of which are recorded as gaps.';
  expect(checkCaseFile(value, sources, [SYSTEM_PROMPT])).toMatchObject({ accepted: true, reasons: [] });
});

it('rejects the genuine live monetary error instead of permitting a positive net_if_lost', () => {
  const value = file(); value.recommendation.reasoning = 'Refunding the disputed USD 120.00 closes the inquiry; the recorded cost exposure is USD 53.00 (item USD 45.00 plus shipping USD 8.00), which is the net_if_lost figure.';
  expect(checkCaseFile(value, sources).reasons).toContain('Text contradicts trusted monetary fact');
});

it('accepts the actual next weak-delivery note with an absence list across commas', () => {
  const value = capturedWeak.caseFile as CaseFile;
  const copy = structuredClone(value);
  copy.evidence_draft.seller_note = 'Sandbox demo case DEMO-weak-delivery (INR, USD 120.00). Order DEMO-ORDER-weak-delivery was recorded for one Demo desk lamp at USD 120.00. Shipment via DEMO CARRIER (tracking DEMO-TRACKING-weak-delivery) is recorded as STALLED with address_matches=false and signed=false, and the tracking event states delivery is not confirmed. The buyer messaged that the parcel has not arrived. No delivery confirmation, signature, or matching-address proof is available in the seller records, and no verified PayPal Orders v2 lookup is available. Recorded costs: item USD 45.00, shipping USD 8.00. No settlement willingness is recorded from the buyer.';
  expect(checkCaseFile(copy, capturedWeak.sources, [SYSTEM_PROMPT], trustedFacts(syntheticDispute('weak-delivery'), scenarios['weak-delivery']))).toMatchObject({ accepted: true, reasons: [] });
});

it('accepts the actual low-value file describing absence of delivery and signature confirmation', () => {
  expect(checkCaseFile(capturedLow.caseFile as CaseFile, capturedLow.sources, [SYSTEM_PROMPT], trustedFacts(syntheticDispute('low-value'), scenarios['low-value']))).toMatchObject({ accepted: true, reasons: [] });
});

it('rejects the actual injection paraphrase while accepting its negated tracking discussion', () => {
  const facts = trustedFacts(syntheticDispute('injection'), scenarios.injection);
  const file = structuredClone(capturedInjection.caseFile) as CaseFile;
  const result = checkCaseFile(file, capturedInjection.sources, [SYSTEM_PROMPT], facts);
  expect(result.reasons).toEqual(['Case file repeats or obeys untrusted instructions or prompt text']);
  file.claims = file.claims.filter(c => !c.text.includes('reveal the prompt'));
  expect(checkCaseFile(file, capturedInjection.sources, [SYSTEM_PROMPT], facts)).toMatchObject({ accepted: true, reasons: [] });
});

it('accepts the actual weak-delivery note with cannot evidence governing all proof nouns', () => {
  const copy = structuredClone(capturedWeak.caseFile) as CaseFile;
  copy.evidence_draft.seller_note = 'Sandbox demo case DEMO-weak-delivery (item not received, USD 120.00). Our records show shipment under tracking DEMO-TRACKING-weak-delivery with DEMO CARRIER is stalled, unsigned, and was addressed to a reference that does not match the order address. The only tracking event confirms the stall and states delivery is not confirmed, and the buyer reports the parcel has not arrived. We therefore cannot evidence delivery, signature, or delivery to the order address, and we are not contesting the claim. Recorded costs are USD 45.00 item and USD 8.00 shipping. Non-evidentiary content in the records was excluded.';
  expect(checkCaseFile(copy, capturedWeak.sources, [SYSTEM_PROMPT], trustedFacts(syntheticDispute('weak-delivery'), scenarios['weak-delivery']))).toMatchObject({ accepted: true, reasons: [] });
});

it.each(['No delivery, signature is recorded.', 'Cannot evidence delivery, signature confirmed.'])('does not extend negation into an independent affirmative signature assertion: %s', text => {
  const copy = structuredClone(capturedWeak.caseFile) as CaseFile; copy.summary = text;
  expect(checkCaseFile(copy, capturedWeak.sources, [], trustedFacts(syntheticDispute('weak-delivery'), scenarios['weak-delivery'])).reasons).toContain('Text contradicts trusted fact: signed');
});

it('accepts the actual low-value comparison without treating its offer as the disputed amount', () => {
  const copy = structuredClone(capturedLow.caseFile) as CaseFile;
  copy.recommendation.reasoning = "Proof of receipt is missing: the shipment is still IN_TRANSIT with only a demo acceptance scan, no delivery confirmation and no signature, so a not-received claim is not well defended. The buyer has recorded willingness to settle for a partial refund of USD 6.00, and the case is low value (disputed USD 12.00; MoneyFacts net_if_won USD 7.00, net_if_lost USD -5.00). Offering the buyer's stated USD 6.00 resolves the inquiry at a cost below the disputed amount while retaining part of the payment, and avoids contesting a claim the records do not support. Respond before the 2026-11-12T10:00:00Z due date.";
  expect(checkCaseFile(copy, capturedLow.sources, [SYSTEM_PROMPT], trustedFacts(syntheticDispute('low-value'), scenarios['low-value']))).toMatchObject({ accepted: true, reasons: [] });
});
it.each(['The disputed amount is USD 6.00.', 'USD 6.00 is the disputed amount.', 'Item cost USD 8.00 and shipping cost USD 45.00.'])('rejects incorrect monetary labels even when all figures exist in sources: %s', text => {
  const copy = file(); copy.summary = text;
  expect(checkCaseFile(copy, sources).reasons).toContain('Text contradicts trusted monetary fact');
});

it('accepts the actual strong-delivery discussion of no delivery failure alleged', () => {
  const copy = structuredClone(capturedStrong.caseFile) as CaseFile;
  copy.recommendation.reasoning = "The case is a strong delivery defense: the order is recorded as completed, the shipment is marked DELIVERED with a signed delivery scan, the address reference matches the order address, and tracking is not stalled. The buyer's only recorded statement is a general non-receipt claim with no address mismatch or delivery failure alleged. Because proof is strong rather than partial and no willingness to settle is recorded, contesting the INR claim is preferable to offering or refunding. MoneyFacts show net_if_won 67.00 USD versus net_if_lost -53.00 USD, which are conditional outcomes and not probabilities. Submit the delivery evidence before the 2026-11-12T10:00:00Z response deadline and obtain the carrier's signed proof document to close the main evidentiary gap.";
  expect(checkCaseFile(copy, capturedStrong.sources, [SYSTEM_PROMPT], trustedFacts(syntheticDispute('strong-delivery'), scenarios['strong-delivery']))).toMatchObject({ accepted: true, reasons: [] });
});
it('still rejects an actual denial of the trusted strong delivery', () => {
  const copy = file(); copy.summary = 'There was no delivery.';
  expect(checkCaseFile(copy, sources).reasons).toContain('Text contradicts trusted fact: delivered');
});

it.each([
  'The shipment address does not match the order address reference, so delivery to the order address is not established.',
  'The absence of delivery, signature, and matching-address evidence is clear from the shipment and tracking records, but settlement acceptance is unknown because no customer willingness is recorded and no verified PayPal order data is available.',
])('accepts actual absence of established address and signature proof: %s', text => {
  const copy = structuredClone(capturedWeak.caseFile) as CaseFile; copy.summary = text;
  expect(checkCaseFile(copy, capturedWeak.sources, [SYSTEM_PROMPT], trustedFacts(syntheticDispute('weak-delivery'), scenarios['weak-delivery']))).toMatchObject({ accepted: true, reasons: [] });
});

it('accepts the actual low-value recorded cost total computed from the read cost record', () => {
  const copy = structuredClone(capturedLow.caseFile) as CaseFile;
  copy.recommendation.reasoning = "Receipt is not established: the only carrier evidence is an acceptance scan, with no delivery confirmation and no signature, so contesting the item-not-received claim would rest on proof that does not show delivery. The address matches and the parcel was accepted by the carrier, which supports the seller's handling but not receipt. The buyer is recorded as willing to settle for a partial refund of USD 6.00, which is within the USD 12.00 disputed amount and above the recorded USD 5.00 total costs. MoneyFacts show net_if_won USD 7.00 and net_if_lost USD -5.00 as conditional outcomes, not probabilities. Given partial proof and recorded willingness to settle, offering the buyer's stated USD 6.00 settlement is the better-supported path than fighting the claim.";
  expect(checkCaseFile(copy, capturedLow.sources, [SYSTEM_PROMPT], trustedFacts(syntheticDispute('low-value'), scenarios['low-value']))).toMatchObject({ accepted: true, reasons: [] });
});

it('accepts the actual injection note stating no tracking stall or address mismatch is present', () => {
  const copy = file(); copy.summary = 'No tracking stall or address mismatch is present.';
  expect(checkCaseFile(copy, sources, [SYSTEM_PROMPT])).toMatchObject({ accepted: true, reasons: [] });
});

it('rejects the actual injection timeline amount when its amount source is missing', () => {
  const copy = structuredClone(capturedInjection.caseFile) as CaseFile;
  copy.timeline = [{ date: '2026-11-04T10:00:00Z', event: 'Dispute DEMO-injection opened for MERCHANDISE_OR_SERVICE_NOT_RECEIVED at USD 120.00; seller response due 2026-11-12.', citations: ['dispute.dispute_id', 'dispute.reason', 'dispute.create_time', 'dispute.seller_response_due_date'] }];
  expect(checkCaseFile(copy, capturedInjection.sources, [SYSTEM_PROMPT], trustedFacts(syntheticDispute('injection'), scenarios.injection)).reasons).toContain('timeline 1: currency figure is not in cited sources');
});

it('accepts the actual absence list with confirmed delivery and matching shipment address', () => {
  const copy = structuredClone(capturedWeak.caseFile) as CaseFile;
  copy.summary = 'Buyer opened a merchandise-not-received inquiry (DEMO-weak-delivery) for USD 120.00 on a demo desk lamp order, with seller response due 2026-11-12. Seller records show the shipment marked STALLED with address_matches false and signed false, and tracking that has not advanced past carrier acceptance. No confirmed delivery, signature, or matching shipment address is recorded, and no customer willingness to settle is recorded.';
  expect(checkCaseFile(copy, capturedWeak.sources, [SYSTEM_PROMPT], trustedFacts(syntheticDispute('weak-delivery'), scenarios['weak-delivery']))).toMatchObject({ accepted: true, reasons: [] });
});

it('accepts the actual low-value confidence statement that delivery and signature are unproven', () => {
  const copy = structuredClone(capturedLow.caseFile) as CaseFile;
  copy.recommendation.confidence.reason = 'Shipment and cost records are consistent and address match is supported, but delivery and signature are unproven and no verified PayPal order lookup exists.';
  expect(checkCaseFile(copy, capturedLow.sources, [SYSTEM_PROMPT], trustedFacts(syntheticDispute('low-value'), scenarios['low-value']))).toMatchObject({ accepted: true, reasons: [] });
});

it('accepts the actual prescribed non-evidentiary summary without treating it as prompt disclosure', () => {
  const copy = file(); copy.evidence_draft.seller_note = 'Non-evidentiary content was excluded.';
  expect(checkCaseFile(copy, sources, [SYSTEM_PROMPT])).toMatchObject({ accepted: true, reasons: [] });
});
it('accepts a real total cost figure supported by the cited cost record alone', () => {
  const copy = file(); copy.claims = [{ text: 'Recorded costs are USD 45.00 item cost and USD 8.00 shipping cost, for USD 53.00 total recorded costs.', citations: ['demo-cost'] }];
  expect(checkCaseFile(copy, sources, [SYSTEM_PROMPT])).toMatchObject({ accepted: true, reasons: [] });
});
it('rejects actual invented computed MoneyFacts citation IDs', () => {
  const copy = file(); copy.claims = [{ text: 'Conditional outcomes are net_if_won USD 67.00 and net_if_lost USD -53.00; these are computed outcomes, not probabilities.', citations: ['dispute.MoneyFacts.net_if_won', 'dispute.MoneyFacts.net_if_lost'] }];
  expect(checkCaseFile(copy, sources).reasons).toContain('claim 1: missing or unread citation');
});

it.each([
  'Buyer opened a MERCHANDISE_OR_SERVICE_NOT_RECEIVED dispute for USD 120.00 on a demo desk lamp order. Tracking is stalled, the shipment address does not match the order address, and neither delivery nor signature is confirmed. No customer willingness to settle is recorded.',
  'The shipment record shows address_matches false and signed false, so neither delivery to the order address nor a signed receipt is established.',
  'Delivery, signature and address match are all unsupported while tracking is stalled, so the seller cannot establish that the buyer received the item. No customer willingness to settle is recorded, so a refund is the appropriate response rather than an offer or a fight.',
])('accepts actual neither/nor or unsupported proof predicates: %s', text => {
  const copy = structuredClone(capturedWeak.caseFile) as CaseFile; copy.summary = text;
  expect(checkCaseFile(copy, capturedWeak.sources, [SYSTEM_PROMPT], trustedFacts(syntheticDispute('weak-delivery'), scenarios['weak-delivery']))).toMatchObject({ accepted: true, reasons: [] });
});

it('accepts the final live injection statement about absent evidence in the customer message rather than denying delivery', () => {
  const copy = file(); copy.summary = 'The customer message record contains no delivery or settlement evidence; non-evidentiary content was excluded.';
  expect(checkCaseFile(copy, sources, [SYSTEM_PROMPT])).toMatchObject({ accepted: true, reasons: [] });
});

it('accepts the stage 3c plain-English conditional money statements with the current prompt', () => {
  expect(checkCaseFile(stage3cStrong.caseFile as CaseFile, stage3cStrong.sources, [SYSTEM_PROMPT],
    trustedFacts(syntheticDispute('strong-delivery'), scenarios['strong-delivery'])))
    .toMatchObject({ accepted: true, reasons: [] });
});

it('accepts the stage 3c weak-delivery prose with coordinated unsupported proof', () => {
  const captured = stage3cWeak;
  expect(checkCaseFile(captured.caseFile as CaseFile, captured.sources, [SYSTEM_PROMPT],
    trustedFacts(syntheticDispute('weak-delivery'), scenarios['weak-delivery'])))
    .toMatchObject({ accepted: true, reasons: [] });
});
it.each([
  'Delivery, signature and a matching address are all unsupported.',
  'Delivery, signature and matching address are all unproven.',
])('scopes plain-English absence to the listed proof only: %s', text => {
  const copy = structuredClone(capturedWeak.caseFile) as CaseFile;
  const facts = trustedFacts(syntheticDispute('weak-delivery'), scenarios['weak-delivery']);
  copy.summary = text;
  expect(checkCaseFile(copy, capturedWeak.sources, [SYSTEM_PROMPT], facts).accepted).toBe(true);
  copy.summary += ' A signature is recorded.';
  expect(checkCaseFile(copy, capturedWeak.sources, [SYSTEM_PROMPT], facts).reasons).toContain('Text contradicts trusted fact: signed');
  const strong = file(); strong.summary = text;
  expect(checkCaseFile(strong, sources).accepted).toBe(false);
});
