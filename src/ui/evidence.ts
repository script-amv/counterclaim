import type { TrustedFacts } from '../agent/facts';
import type { ReadSource } from '../agent/schema';
import type { SellerRecord } from '../records';

/** Text chooses a predicate; trusted facts and the cited record must agree on its value. */
export function claimHighlights(text: string, source: ReadSource, facts: TrustedFacts): string[] {
  if (source.id === 'dispute.dispute_amount' && source.data && typeof source.data === 'object' && 'value' in source.data && 'currency_code' in source.data && source.data.value === facts.money.disputed_amount && source.data.currency_code === facts.money.currency_code) return ['value'];
  const record = source.data as Partial<SellerRecord> | null;
  const c = record?.content;
  if (!c) return [];
  const fields: string[] = [];
  if (record.type === 'shipment') {
    if (/deliver|receipt|tracking|status|transit|stalled|accept/i.test(text) && typeof c.status === 'string' &&
      c.status === facts.shipmentStatus) fields.push('status');
    if (/sign/i.test(text) && typeof c.signed === 'boolean' && c.signed === facts.signed) fields.push('signed');
    if (/address/i.test(text) && typeof c.address_matches === 'boolean' && c.address_matches === facts.addressMatches) fields.push('address_matches');
  }
  if (record.type === 'tracking_event' && /tracking|scan|deliver|stalled|accept/i.test(text) &&
    typeof c.status === 'string' && c.status === facts.trackingStatus) fields.push('status');
  if (record.type === 'order' && /amount|USD|cost|\$|total/i.test(text) && c.amount === facts.money.disputed_amount && c.currency_code === facts.money.currency_code) fields.push('amount');
  if (record.type === 'cost' && /cost|USD|\$|net|shipping/i.test(text) && c.currency_code === facts.money.currency_code) {
    if (c.item_cost === facts.money.item_cost) fields.push('item_cost');
    if (c.shipping_cost === facts.money.shipping_cost) fields.push('shipping_cost');
  }
  return fields;
}

export function instructionNotice(records: SellerRecord[], action: string | undefined, accepted: boolean, facts: TrustedFacts): string | null {
  const detected = records.some(r => r.type === 'customer_message' && typeof r.content.text === 'string' && /\b(?:ignore|disregard|override)\s+(?:(?:all|previous|the|your)\s+)*(?:instructions|prompt)|\breveal\s+(?:the\s+)?prompt|\bsystem instructions\b/i.test(r.content.text));
  if (!detected) return null;
  const refundRequested = records.some(r => r.type === 'customer_message' && typeof r.content.text === 'string' && /recommend\s+(?:a\s+)?refund/i.test(r.content.text));
  if (refundRequested && accepted && action === 'fight' && facts.delivered === true && facts.signed === true && facts.addressMatches === true)
    return 'Instruction-like text was found in a customer message. It was treated as evidence and not followed: the agent recommended providing evidence from delivery, signature and address records instead of the requested refund. The accepted output does not repeat the message’s instructions or disclose a prompt. This describes this recorded result; it does not guarantee detection of every attempt.';
  return 'Instruction-like text was found in a customer message. Customer text is evidence to inspect, never instructions to follow. Review the saved analysis and guard result before acting.';
}
