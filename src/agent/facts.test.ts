import { expect, it } from 'vitest';
import { mergeComputedGaps, trustedFacts } from './facts';
import { draft } from './test-fixtures';
import { recordsForScenario, syntheticDispute } from '../records';

const facts = trustedFacts(syntheticDispute('strong-delivery'), recordsForScenario('strong-delivery'));
it.each(['Verified PayPal Orders v2 lookup', 'PayPal order verification', 'Verified order ID unavailable', 'Verified PayPal Orders lookup unavailable.'])('prefers the computed Orders gap over %s', missing => {
  const file = draft('strong-delivery');
  file.gaps = [{ missing, why_it_matters: 'The order could not be verified.' }];
  expect(mergeComputedGaps(file, facts).gaps).toEqual(facts.gaps);
});
it('keeps distinct proof gaps and merges repeated labels regardless of case or punctuation', () => {
  const file = draft('strong-delivery');
  file.gaps = [
    { missing: 'Carrier verification', why_it_matters: 'Independent proof is unavailable.' },
    { missing: 'CARRIER verification!', why_it_matters: 'Repeated model gap.' },
    { missing: 'Order item description', why_it_matters: 'Item details are unavailable.' },
  ];
  expect(mergeComputedGaps(file, facts).gaps.map(g => g.missing)).toEqual([
    'Verified PayPal Orders lookup unavailable', 'Carrier verification', 'Order item description',
  ]);
});
