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
  if (typeof value === 'string') return /email|name|address|secret|token|password|prompt/i.test(key) && value.trim().length > 0 ? [value] : [];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => privateValues(v, k));
}
export function containsPrivateText(value: unknown, forbidden: string[] = []): boolean {
  const text = JSON.stringify(value);
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)
    || forbidden.some(s => {
      if (!s.trim()) return false;
      if (s.length >= 3 || /[^a-z]/i.test(s)) return text.toLowerCase().includes(s.toLowerCase());
      // Short Latin names need token boundaries, otherwise 'Li' matches 'delivery'.
      const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(text);
    });
}

export function casePrivateValues(store: import('../cases/storage').CaseStore, id: string): string[] {
  return [...privateValues(store.get(id)), ...store.history(id).flatMap(e => privateValues(e.snapshot))];
}
