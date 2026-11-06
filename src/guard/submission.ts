import { createHash } from 'node:crypto';
import type { Approval, CaseFileVersion, SubmissionAttempt, SubmissionContent } from '../agent/schema';
import type { Dispute } from '../paypal/schemas';
import { deriveActions } from '../cases/derive';
import { checkOutboundNote } from './case-file';
import { units } from '../agent/money';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k, canonical(v)]));
  return value;
}
export const contentHash = (content: SubmissionContent) => createHash('sha256').update(JSON.stringify(canonical(content))).digest('hex');
export function checkSubmission(input: { approval: Approval | undefined; version: CaseFileVersion; content: SubmissionContent; fresh: Dispute; attempts: SubmissionAttempt[] }) {
  const { approval, version, content, fresh, attempts } = input;
  const reasons = checkOutboundNote(content.note, version.sources, fresh.dispute_amount, content);
  if (content.note !== version.caseFile.evidence_draft.seller_note || content.evidence?.input.evidences.some(e => e.notes !== content.note)) reasons.push('OUTBOUND_NOTE_MISMATCH: Outbound note differs from the reviewed seller note. Save a new version and approve again.');
  for (const evidence of content.evidence?.input.evidences ?? []) reasons.push(...checkOutboundNote(typeof evidence.notes === 'string' ? evidence.notes : '', version.sources, fresh.dispute_amount, content));
  if (!version.guard.accepted) reasons.push('Case file was rejected');
  if (!approval || approval.disputeId !== fresh.dispute_id || approval.versionId !== version.id || content.versionId !== version.id || approval.contentHash !== contentHash(content)) reasons.push('Missing or stale approval');
  if (content.stage !== (fresh.dispute_life_cycle_stage ?? 'UNKNOWN')) reasons.push('Dispute stage changed');
  if (!deriveActions(fresh).includes(content.action)) reasons.push('Action is no longer available');
  if (attempts.some(a => a.stage === content.stage && ['submitting', 'submitted', 'unknown'].includes(a.status))) reasons.push('Submission already recorded or outcome is uncertain for this stage');
  if (content.offer && (!fresh.dispute_amount || fresh.dispute_amount.currency_code !== content.offer.currency_code || units(content.offer.value) > units(fresh.dispute_amount.value))) reasons.push('Offer no longer fits disputed amount');
  if (content.refund && (!fresh.dispute_amount || fresh.dispute_amount.currency_code !== content.refund.currency_code || units(content.refund.value) > units(fresh.dispute_amount.value))) reasons.push('Refund no longer fits disputed amount');
  return { accepted: reasons.length === 0, reasons };
}
