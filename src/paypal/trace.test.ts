import { describe, expect, it } from 'vitest';
import { disputeSchema, disputeListSchema, orderSchema } from './schemas';
import { deriveActions, deriveView } from '../cases/derive';
import { trace } from './test-fixtures';

// Expectations independently transcribed from the recorded log and requested terminal state.
const expectations = [
  ['INQUIRY', 'paypal', []],
  ['INQUIRY', 'paypal', []],
  ['INQUIRY', 'seller', ['accept-claim', 'make-offer', 'escalate', 'send-message', 'provide-evidence']],
  ['INQUIRY', 'paypal', []],
  ['INQUIRY', 'buyer', ['accept-claim', 'send-message', 'escalate']],
  ['INQUIRY', 'paypal', []],
  ['INQUIRY', 'paypal', []],
  ['CHARGEBACK', 'seller', ['accept-claim', 'provide-evidence']],
  ['CHARGEBACK', 'paypal', ['provide-supporting-info']],
  ['CHARGEBACK', 'paypal', ['accept-claim', 'require-evidence', 'provide-supporting-info', 'adjudicate']],
  ['CHARGEBACK', 'none', []],
] as const;

describe('recorded sandbox contracts', () => {
  it.each(trace.map((d, i) => [i, d] as const))('parses and derives trace state %i', (i, raw) => {
    const d = disputeSchema.parse(raw);
    const [stage, turn, actions] = expectations[i]!;
    expect(deriveActions(d)).toEqual(actions);
    expect(deriveView(d)).toEqual({ stage, turn, deadline: null,
      outcome: i === 10 ? 'RESOLVED_SELLER_FAVOUR' : null });
    expect(disputeListSchema.parse({ items: [d] }).items[0]?.dispute_id).toBe(d.dispute_id);
  });
  it('normalizes links without inventing actions from status', () => {
    const d = disputeSchema.parse(trace[2]);
    expect(deriveActions({ ...d, links: [] })).toEqual([]);
    expect(deriveActions({ ...d, links: [{ rel: 'provide-evidence', href: 'https://example.invalid', method: 'POST' }] })).toEqual(['provide-evidence']);
  });
  it('uses only the active party deadline and keeps unknown states honest', () => {
    const d = disputeSchema.parse(trace[2]);
    const dates = { seller_response_due_date: '2026-11-10T00:00:00Z', buyer_response_due_date: '2026-11-11T00:00:00Z' };
    expect(deriveView({ ...d, ...dates }).deadline).toBe(dates.seller_response_due_date);
    expect(deriveView({ ...d, ...dates, status: 'WAITING_FOR_BUYER_RESPONSE' }).deadline).toBe(dates.buyer_response_due_date);
    expect(deriveView({ ...d, status: 'NEW_UNKNOWN_STATUS' }).turn).toBe('unknown');
  });
  it('preserves unknown fields but rejects invalid known fields', () => {
    const d = disputeSchema.parse({ ...disputeSchema.parse(trace[0]), future: { enabled: true } });
    expect(d.future).toEqual({ enabled: true });
    expect(disputeSchema.safeParse({ ...d, links: 'bad' }).success).toBe(false);
    expect(disputeSchema.safeParse({ ...d, seller_response_due_date: 123 }).success).toBe(false);
    expect(orderSchema.parse({ id: 'ORDER-FAKE', status: 'COMPLETED', future: true }).future).toBe(true);
    expect(orderSchema.safeParse({ status: 'COMPLETED' }).success).toBe(false);
  });
});
