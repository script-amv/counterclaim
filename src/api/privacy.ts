import type { PrivacyFinding } from '../agent/schema';
import type { Dispute } from '../paypal/schemas';

/** Only these PayPal fields enter public responses, model context, or source citations. */
export function publicDispute(d: Dispute) {
  return {
    dispute_id: d.dispute_id, status: d.status, reason: d.reason,
    dispute_life_cycle_stage: d.dispute_life_cycle_stage,
    create_time: d.create_time, update_time: d.update_time,
    seller_response_due_date: d.seller_response_due_date, buyer_response_due_date: d.buyer_response_due_date,
    dispute_amount: d.dispute_amount ? { currency_code: d.dispute_amount.currency_code, value: d.dispute_amount.value } : undefined,
    links: (d.links ?? []).map(l => ({ rel: l.rel, href: 'sandbox-action', method: l.method })),
    dispute_outcome: d.dispute_outcome ? { outcome_code: d.dispute_outcome.outcome_code } : undefined,
  };
}

// Text fields are untrusted. Reject recognizable private source values rather than echo them.
export function privateValues(value: unknown, key = ''): string[] {
  // Carrier labels are public shipping metadata, not personal names. Keep identity fields protected.
  if (typeof value === 'string') return !['item_name', 'carrier_name', 'carrier_name_other'].includes(key) && /email|name|address|secret|token|password|prompt/i.test(key) && value.trim().length > 0 ? [value] : [];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => privateValues(v, k));
}
function privateTextRules(text: string, forbidden: string[]): PrivacyFinding['rule'][] {
  const rules: PrivacyFinding['rule'][] = [];
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) rules.push('EMAIL');
  if (forbidden.some(s => {
    if (!s.trim()) return false;
    if (s.length >= 3 || /[^a-z]/i.test(s)) return text.toLowerCase().includes(s.toLowerCase());
    // Short Latin names need token boundaries, otherwise 'Li' matches 'delivery'.
    const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(text);
  })) rules.push('PRIVATE_SOURCE_VALUE');
  return rules;
}
export function containsPrivateText(value: unknown, forbidden: string[] = []): boolean {
  return privateTextRules(JSON.stringify(value), forbidden).length > 0;
}

/** Field paths and code-owned rule names only; never include matched source values. */
export function privateTextFindings(value: unknown, forbidden: string[] = [], path = ''): PrivacyFinding[] {
  if (typeof value === 'string') return privateTextRules(value, forbidden).map(rule => ({ path, rule }));
  if (Array.isArray(value)) return value.flatMap((item, i) => privateTextFindings(item, forbidden, `${path}[${i}]`));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, item]) => privateTextFindings(item, forbidden, path ? `${path}.${key}` : key));
}

export function casePrivateValues(store: import('../cases/storage').CaseStore, id: string): string[] {
  return [...privateValues(store.get(id)), ...store.history(id).flatMap(e => privateValues(e.snapshot))];
}
