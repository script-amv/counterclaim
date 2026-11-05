import { randomUUID } from 'node:crypto';
import { trustedFacts, mergeComputedGaps } from '../agent/facts';
import { recordsForScenario } from '../records';
import type { CaseStore } from '../cases/storage';
import { PayPalError, type EvidenceInput, type MakeOfferInput } from '../paypal/client';
import type { Dispute } from '../paypal/schemas';
import { caseFileSchema, type Approval, type CaseFileVersion, type SubmissionAttempt, type SubmissionContent } from '../agent/schema';
import { checkCaseFile } from '../guard/case-file';
import { checkSubmission, contentHash } from '../guard/submission';
import { evidenceInput, generatePacket, validateEvidenceFile, packetContainsPrivateText } from '../evidence';
import { containsPrivateText, casePrivateValues } from './privacy';
import { SYSTEM_PROMPT } from '../agent/loop';

export class ApiError extends Error { constructor(readonly status: number, message: string) { super(message); } }
export interface ActionClient {
  getDispute(id: string): Promise<Dispute>;
  provideEvidence(id: string, input: EvidenceInput, file: File): Promise<unknown>;
  makeOffer(id: string, input: MakeOfferInput): Promise<unknown>;
  acceptClaim(id: string, input: { note?: string }): Promise<unknown>;
}
export class CaseService {
  constructor(readonly store: CaseStore, private paypal: ActionClient) {}
  latest(id: string): CaseFileVersion { const v = this.store.versions(id).at(-1); if (!v) throw new ApiError(409, 'Investigate or create a case file first'); return v; }
  private facts(id: string) { return trustedFacts(this.store.get(id)!, recordsForScenario(this.store.scenario(id))); }
  edit(id: string, input: unknown, baseVersionId: string) {
    return this.store.transaction(() => {
      this.store.assertMutable(id);
      const original = this.latest(id);
      if (original.id !== baseVersionId) throw new ApiError(409, 'Another edit came first. Your draft has been kept. Review the latest version before saving again.');
      const facts = this.facts(id); const caseFile = mergeComputedGaps(caseFileSchema.parse(input), facts);
      const guard = checkCaseFile(caseFile, original.sources, [...casePrivateValues(this.store, id), SYSTEM_PROMPT], this.facts(id));
      const version: CaseFileVersion = { ...original, id: randomUUID(), createdAt: new Date().toISOString(), caseFile, guard };
      this.store.addVersion(version); return version;
    });
  }
  async approve(id: string, versionId: string, snapshotFingerprint: string): Promise<Approval> {
    this.store.assertNotReplay(id);
    const v = this.latest(id); const dispute = this.store.get(id);
    if (!dispute || v.id !== versionId) throw new ApiError(409, 'Case file version changed');
    if (this.store.snapshotFingerprint(id) !== snapshotFingerprint) throw new ApiError(409, 'Case state changed. Review the updated state and approve again.');
    const guard = checkCaseFile(v.caseFile, v.sources, [...casePrivateValues(this.store, id), SYSTEM_PROMPT], this.facts(id));
    if (packetContainsPrivateText(v.caseFile, v.sources, casePrivateValues(this.store, id)) || !v.guard.accepted || !guard.accepted) throw new ApiError(409, 'Case file was rejected');
    const r = v.caseFile.recommendation;
    const content: SubmissionContent = { versionId, stage: dispute.dispute_life_cycle_stage ?? 'UNKNOWN', action: r.action === 'fight' ? 'provide-evidence' : r.action === 'offer' ? 'make-offer' : 'accept-claim', note: v.caseFile.evidence_draft.seller_note };
    if (r.action === 'offer') content.offer = r.offer_amount!;
    if (r.action === 'fight') {
      const pdf = await generatePacket(v.caseFile, v.sources); const filename = 'counterclaim-demo.pdf';
      const file = new File([new Uint8Array(pdf)], filename, { type: 'application/pdf' }); validateEvidenceFile(file);
      content.evidence = { filename, pdfBase64: Buffer.from(pdf).toString('base64'), input: evidenceInput(dispute.reason, v.caseFile, v.sources, filename) };
    }
    // Recheck under the write lock after asynchronous packet generation.
    return this.store.transaction(() => {
      this.store.assertNotReplay(id);
      if (this.store.snapshotFingerprint(id) !== snapshotFingerprint) throw new ApiError(409, 'Case state changed. Review the updated state and approve again.');
      if (this.latest(id).id !== versionId) throw new ApiError(409, 'Case file version changed');
      if (packetContainsPrivateText(v.caseFile, v.sources, casePrivateValues(this.store, id))) throw new ApiError(409, 'Packet requires privacy review');
      const approval = { id: randomUUID(), disputeId: id, versionId, contentHash: contentHash(content), createdAt: new Date().toISOString(), content };
      this.store.addApproval(approval); return approval;
    });
  }
  async submit(id: string, approvalId: string): Promise<SubmissionAttempt> {
    this.store.assertNotReplay(id);
    const approval = this.store.approvals(id).find(a => a.id === approvalId);
    if (!approval) throw new ApiError(409, 'Approval is required');
    const fresh = await this.paypal.getDispute(id);
    if (fresh.dispute_id !== id) throw new ApiError(502, 'Dispute identity mismatch');
    this.store.save(fresh);
    const v = this.latest(id);
    const content = approval.content;
    const guard = checkSubmission({ approval, version: v, content, fresh, attempts: this.store.attempts(id) });
    if (!guard.accepted) throw new ApiError(409, guard.reasons.join('; '));
    if (packetContainsPrivateText(v.caseFile, v.sources, casePrivateValues(this.store, id)) || !checkCaseFile(v.caseFile, v.sources, [...casePrivateValues(this.store, id), SYSTEM_PROMPT], this.facts(id)).accepted || containsPrivateText(v.caseFile, casePrivateValues(this.store, id))) throw new ApiError(409, 'Case file requires privacy review');
    let evidenceFile: File | undefined;
    if (content.action === 'provide-evidence') {
      if (!content.evidence) throw new ApiError(409, 'Approved packet is missing');
      evidenceFile = new File([Buffer.from(content.evidence.pdfBase64, 'base64')], content.evidence.filename, { type: 'application/pdf' }); validateEvidenceFile(evidenceFile);
    }
    const attempt: SubmissionAttempt = { id: randomUUID(), disputeId: id, versionId: v.id, approvalId, stage: content.stage, action: content.action, contentHash: approval.contentHash, status: 'submitting', startedAt: new Date().toISOString() };
    // Partial UNIQUE index is the durable concurrency gate, including after process restarts.
    try { this.store.reserveSubmission(attempt); } catch { throw new ApiError(409, 'Submission already recorded for this stage'); }
    try {
      if (content.action === 'provide-evidence') await this.paypal.provideEvidence(id, content.evidence!.input, evidenceFile!);
      else if (content.action === 'make-offer') await this.paypal.makeOffer(id, { note: content.note, offer_type: 'REFUND', offer_amount: content.offer });
      else await this.paypal.acceptClaim(id, { note: content.note });
      attempt.status = 'submitted';
    } catch (error) {
      // A timeout, body interruption or 5xx cannot establish whether the write was applied.
      attempt.status = error instanceof PayPalError && error.status >= 400 && error.status < 500 && error.status !== 408 ? 'failed' : 'unknown';
    }
    attempt.endedAt = new Date().toISOString(); this.store.saveAttempt(attempt);
    // Always reconcile; a reconciliation failure must never turn an uncertain write into a retry.
    try { const current = await this.paypal.getDispute(id); if (current.dispute_id === id) this.store.save(current); } catch { /* Keep last known snapshot and durable attempt. */ }
    return attempt;
  }
  preview(id: string): Uint8Array {
    const v = this.latest(id); const a = this.store.approvals(id).findLast(a => a.versionId === v.id);
    if (!a?.content.evidence || a.contentHash !== contentHash(a.content)) throw new ApiError(409, 'Approve this version to preview its packet');
    const forbidden = casePrivateValues(this.store, id);
    if (packetContainsPrivateText(v.caseFile, v.sources, forbidden) || containsPrivateText(a.content.evidence.input, forbidden) || !checkCaseFile(v.caseFile, v.sources, [...forbidden, SYSTEM_PROMPT], this.facts(id)).accepted) throw new ApiError(409, 'Packet requires privacy or evidence review');
    return Buffer.from(a.content.evidence.pdfBase64, 'base64');
  }
}
