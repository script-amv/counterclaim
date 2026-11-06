import { expect, it } from 'vitest';
import { caseNextStep, compareQueueDeadlines, sandboxLabel } from './case-state';
import type { CaseDetailResponse, CaseQueueRow } from '../api/contract';
const row = (status: string, deadline: string | null): CaseQueueRow => ({
  id: status, status, outcome: null, deadline, whoseTurn: 'paypal', stage: 'CHARGEBACK',
  title: 'Sandbox', amount: null, reason: null, nextActions: [], evidenceStrength: 'strong', replay: false,
});
it('sorts closed cases after open cases including open cases without deadlines', () => {
  const rows = [row('RESOLVED', null), row('OPEN', null), row('WAITING_FOR_SELLER_RESPONSE', '2026-11-08T00:00:00Z'), row('WAITING_FOR_SELLER_RESPONSE', '2026-11-07T00:00:00Z')];
  expect(rows.sort(compareQueueDeadlines).map(r => [r.status, r.deadline])).toEqual([
    ['WAITING_FOR_SELLER_RESPONSE', '2026-11-07T00:00:00Z'], ['WAITING_FOR_SELLER_RESPONSE', '2026-11-08T00:00:00Z'], ['OPEN', null], ['RESOLVED', null],
  ]);
});
const state = (status: string, nextActions: string[] = []): CaseDetailResponse => ({
  dispute: { status }, case: { nextActions }, attempts: [],
} as unknown as CaseDetailResponse);
it('closes the next step for resolved cases even when old links remain', () => {
  expect(caseNextStep(state('RESOLVED', ['provide-evidence']))).toEqual({ heading: 'Case closed', message: 'No response sent through Counterclaim is recorded. No response is due.', actionable: false });
});
it('shows a waiting state without a CTA when PayPal offers no actions', () => {
  expect(caseNextStep(state('UNDER_REVIEW'))).toEqual({ heading: 'No response due', message: 'No response sent through Counterclaim is recorded. No response is due in the saved PayPal state.', actionable: false });
});
it('records what was actually sent and when, ignoring later failed attempts', () => {
  const data = state('RESOLVED');
  data.attempts = [
    { status: 'submitted', action: 'provide-evidence', startedAt: '2026-11-05T01:00:00Z', endedAt: '2026-11-05T01:00:03Z' },
    { status: 'failed', action: 'accept-claim', startedAt: '2026-11-06T00:00:00Z' },
  ] as CaseDetailResponse['attempts'];
  expect(caseNextStep(data).message).toBe('Evidence response sent to PayPal on Nov 5, 2026, 01:00:03 UTC. No response is due.');
});
it('does not claim an uncertain submission was never sent', () => {
  const data = state('RESOLVED');
  data.attempts = [{ status: 'unknown' }] as CaseDetailResponse['attempts'];
  expect(caseNextStep(data).message).toBe('A response attempt is recorded without confirmation from PayPal. No response is due.');
});
it('keeps the review step for an actionable open case', () => {
  expect(caseNextStep(state('WAITING_FOR_SELLER_RESPONSE', ['provide-evidence'])).actionable).toBe(true);
});
it('labels synced disputes separately from replays and loading states', () => {
  expect(sandboxLabel(false)).toBe('Real PayPal sandbox dispute. Demo seller records.');
  expect(sandboxLabel(true)).toBe('Demo seller data. Nothing here is a live customer dispute.');
  expect(sandboxLabel(null)).toBe('PayPal sandbox. Demo seller data.');
});
