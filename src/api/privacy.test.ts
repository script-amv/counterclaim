import { expect, it } from 'vitest';
import { privateValues, containsPrivateText } from './privacy';

it('permits product labels while still protecting buyer and seller identities', () => {
  const forbidden = privateValues({ disputed_transactions: [{
    items: [{ item_name: 'Sandbox test item' }],
    buyer: { name: 'Private Buyer', email: 'buyer@example.invalid' },
    seller: { name: 'Private Seller' },
    shipping_address: { full_name: 'Private Recipient', address_line_1: 'Private Street' },
  }] });
  expect(containsPrivateText('Order for Sandbox test item', forbidden)).toBe(false);
  for (const text of ['Private Buyer', 'Private Seller', 'Private Recipient', 'Private Street', 'buyer@example.invalid']) {
    expect(containsPrivateText(text, forbidden)).toBe(true);
  }
});

it('does not treat carrier names as identities, while retaining actual name protection', () => {
  const forbidden = privateValues({ evidences: [{ evidence_info: { tracking_info: [{
    carrier_name: 'DEMO CARRIER', carrier_name_other: 'Alternate Parcel Service',
    recipient_name: 'Private Recipient',
  }] } }], buyer: { name: 'Private Buyer' }, seller: { name: 'Private Seller' } });
  expect(containsPrivateText('DEMO CARRIER and Alternate Parcel Service', forbidden)).toBe(false);
  for (const identity of ['Private Recipient', 'Private Buyer', 'Private Seller']) {
    expect(containsPrivateText(identity, forbidden)).toBe(true);
  }
  // Carrier metadata must not exempt the same value supplied as an actual identity.
  expect(containsPrivateText('DEMO CARRIER', privateValues({ carrier_name: 'DEMO CARRIER', buyer: { name: 'DEMO CARRIER' } }))).toBe(true);
  expect(containsPrivateText('contact@example.invalid', forbidden)).toBe(true);
});
