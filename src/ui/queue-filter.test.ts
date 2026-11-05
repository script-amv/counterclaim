import { expect, it } from 'vitest';
import { queueFilterText } from './queue-filter';
import type { CaseQueueRow } from '../api/contract';

const row: CaseQueueRow = {
  title: 'Demo desk lamp · Order 2', id: 'REPLAY-weak-delivery',
  reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', stage: 'UNDER_REVIEW',
  evidenceStrength: 'partial', amount: null, deadline: null, whoseTurn: 'seller',
  nextActions: [], replay: true,
};
it.each(['demo desk lamp', 'weak-delivery', 'item not received', 'merchandise_or_service_not_received', 'under review', 'under_review', 'partial'])('indexes %s even with a human title', query => {
  expect(queueFilterText(row).toLowerCase()).toContain(query);
});
it('handles an absent grid row', () => expect(queueFilterText(undefined)).toBe(''));
