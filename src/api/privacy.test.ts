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
