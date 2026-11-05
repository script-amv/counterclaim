import type { Dispute } from '../paypal/schemas';
import type { SellerRecord } from '../records';
export interface MoneyFacts {
  currency_code: string | null; disputed_amount: string | null; item_cost: string | null; shipping_cost: string | null;
  total_recorded_costs: string | null; net_if_won: string | null; net_if_lost: string | null; gaps: string[];
}
export function units(value: string, scale = 3): bigint {
  if (!/^\d+(?:\.\d{1,3})?$/.test(value)) throw new Error('Invalid monetary amount');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > scale) throw new Error('Invalid monetary precision');
  return BigInt(whole!) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0') || '0');
}
function display(n: bigint, scale: number) {
  const negative = n < 0n; const digits = (negative ? -n : n).toString().padStart(scale + 1, '0');
  return `${negative ? '-' : ''}${scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits}`;
}
export function moneyFacts(dispute: Dispute, records: SellerRecord[]): MoneyFacts {
  const a = dispute.dispute_amount;
  const costs = records.filter(r => r.type === 'cost');
  const result: MoneyFacts = { currency_code: a?.currency_code ?? null, disputed_amount: a?.value ?? null,
    item_cost: null, shipping_cost: null, total_recorded_costs: null, net_if_won: null, net_if_lost: null, gaps: [] };
  // Ambiguous/mixed costs are gaps, never silently guessed or converted.
  const cost = costs.length === 1 ? costs[0]!.content : undefined;
  if (cost?.currency_code === a?.currency_code && typeof cost?.item_cost === 'string' && typeof cost?.shipping_cost === 'string') {
    result.item_cost = cost.item_cost; result.shipping_cost = cost.shipping_cost;
    try {
      const values = [a!.value, cost.item_cost, cost.shipping_cost];
      const scale = Math.max(...values.map(v => v.split('.')[1]?.length ?? 0));
      const spent = units(cost.item_cost, scale) + units(cost.shipping_cost, scale);
      result.total_recorded_costs = display(spent, scale);
      result.net_if_won = display(units(a!.value, scale) - spent, scale);
      result.net_if_lost = display(-spent, scale);
    } catch { result.gaps.push('Amounts have unsupported precision or invalid format'); }
  } else result.gaps.push('Item/shipping costs are missing, ambiguous, or use a different currency');
  if (!a) result.gaps.push('Disputed amount is missing');
  return result;
}
