import type { Dispute } from '../paypal/schemas';
import type { SellerRecord } from '../records';
import type { CaseFile } from './schema';
import { moneyFacts } from './money';

export interface TrustedFacts {
  delivered: boolean | null; signed: boolean | null; addressMatches: boolean | null;
  trackingStalled: boolean | null; customerWillingToSettle: boolean;
  money: ReturnType<typeof moneyFacts>; dates: string[];
  gaps: CaseFile['gaps'];
}
export function trustedFacts(dispute: Dispute, records: SellerRecord[], ordersAvailable = false): TrustedFacts {
  const shipments = records.filter(r => r.type === 'shipment');
  const shipment = shipments.length === 1 ? shipments[0]!.content : undefined;
  const money = moneyFacts(dispute, records);
  const facts: TrustedFacts = {
    delivered: typeof shipment?.status === 'string' ? shipment.status === 'DELIVERED' : null,
    signed: typeof shipment?.signed === 'boolean' ? shipment.signed : null,
    addressMatches: typeof shipment?.address_matches === 'boolean' ? shipment.address_matches : null,
    trackingStalled: typeof shipment?.status === 'string' ? shipment.status === 'STALLED' : null,
    customerWillingToSettle: records.some(r => r.type === 'customer_message' && typeof r.content.text === 'string' && !/\b(?:ignore|reveal|disregard|system instructions|override)\b/i.test(r.content.text) && /\bI (?:am willing to settle|agree to (?:a )?(?:partial refund|settlement))\b/i.test(r.content.text)),
    money, dates: [...new Set([...records.map(r => r.timestamp.slice(0, 10)), ...Object.values(dispute).filter((v): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v)).map(v => v.slice(0, 10))])], gaps: [],
  };
  const gap = (missing: string, why_it_matters: string) => facts.gaps.push({ missing, why_it_matters });
  if (!records.length) gap('Seller records unavailable', 'No seller proof can be established.');
  if (facts.delivered !== true) gap('Confirmed delivery', 'Receipt has not been established.');
  if (facts.signed !== true) gap('Signature confirmation', 'Signed receipt has not been established.');
  if (facts.addressMatches !== true) gap('Matching shipment address', 'Delivery to the order address has not been established.');
  if (facts.trackingStalled) gap('Tracking stalled', 'Carrier tracking has not progressed.');
  for (const missing of money.gaps) gap(missing, 'Reliable money reasoning requires verified amounts.');
  if (!ordersAvailable) gap('Verified PayPal Orders lookup unavailable', 'No verified Orders v2 ID is available; seller records are demo evidence only.');
  return facts;
}
export function mergeComputedGaps(file: CaseFile, facts: TrustedFacts): CaseFile {
  return { ...file, gaps: [...facts.gaps, ...file.gaps.filter(g => !facts.gaps.some(f => f.missing === g.missing))] };
}
