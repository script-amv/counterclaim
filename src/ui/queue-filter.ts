import type { CaseQueueRow } from '../api/contract';
import { reason, words } from './format';

/** Include source values and the words a seller sees, independently of cell renderers. */
export function queueFilterText(row: CaseQueueRow | undefined): string {
  if (!row) return '';
  return [row.title, row.id, row.reason, reason(row.reason), row.stage, words(row.stage),
    row.evidenceStrength, words(row.evidenceStrength)].filter(Boolean).join(' ');
}
