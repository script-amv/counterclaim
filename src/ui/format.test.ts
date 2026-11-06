import { expect, it } from 'vitest';
import { paypalOutcome } from './format';
it.each([
  ['RESOLVED_SELLER_FAVOUR', "Resolved in the seller's favour"],
  ['RESOLVED_BUYER_FAVOUR', "Resolved in the buyer's favour"],
  ['RESOLVED_WITH_PAYOUT', 'Resolved with a payout'],
  ['CANCELED_BY_BUYER', 'Cancelled by the buyer'],
  ['ACCEPTED', 'Claim accepted'],
  ['DENIED', 'Claim denied'],
  ['REFUNDED', 'Buyer refunded'],
  ['CANCELED', 'Dispute cancelled'],
  ['CANCELLED', 'Dispute cancelled'],
  ['NONE', 'Resolved'],
  ['NEW_PAYPAL_CODE', 'Resolved (New paypal code)'],
  [undefined, 'Resolved'],
])('labels outcome %s', (code, expected) => expect(paypalOutcome(code)).toBe(expected));
