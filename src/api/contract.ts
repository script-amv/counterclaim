/** Public UI contract. Raw PayPal snapshots, approval payloads and credentials never appear here. */
import { z } from 'zod';
import { caseFileSchema, type CaseFile, type GuardResult, type SubmissionAttempt, type ToolTrace, type ReadSource, type PrivacyFinding } from '../agent/schema';
import type { publicDispute } from './privacy';
export type { CaseFile, GuardResult, SubmissionAction, ReadSource, ToolTrace } from '../agent/schema';
export type PublicDispute = ReturnType<typeof publicDispute>;
export type EvidenceStrength = 'unreviewed' | 'rejected' | 'weak' | 'partial' | 'strong';
export interface CaseQueueRow {
  lastSyncedAt?: string; replay: boolean; title: string; id: string; amount: { currency_code: string; value: string } | null; reason: string | null;
  stage: string; deadline: string | null; whoseTurn: string; nextActions: string[]; evidenceStrength: EvidenceStrength;
}
export interface CasesResponse { cases: CaseQueueRow[] }
export interface CaseFileVersionResponse {
  outboundPacket?: import('../evidence/packet').OutboundPacket;
  id: string; runId: string; createdAt: string; caseFile: CaseFile | null; guard: GuardResult; sources: ReadSource[];
}
export interface RunResponse {
  privacyFindings?: PrivacyFinding[];
  id: string; model: string; status: 'running' | 'completed' | 'rejected' | 'failed';
  startedAt: string; endedAt?: string; toolCalls: ToolTrace[]; tokens: number; tokensEstimated: boolean; cost?: number; failure?: string; provider?: string; turns?: number; failureCode?: import('../agent/provider').FailureCode;
}
export interface ApprovalResponse { stage: string; id: string; versionId: string; contentHash: string; createdAt: string }
export type AttemptResponse = SubmissionAttempt;
export interface CaseEventResponse { id: number; kind: string; observedAt: string; snapshot: PublicDispute }
export interface CaseDetailResponse {
  snapshotFingerprint: string;
  computed: { citationHighlights: Record<string, string[]>[]; instructionNotice: string | null; money: import('../agent/money').MoneyFacts; gaps: CaseFile['gaps'] };
  case: CaseQueueRow; dispute: PublicDispute; caseFileVersions: CaseFileVersionResponse[];
  runs: RunResponse[]; events: CaseEventResponse[]; approvals: ApprovalResponse[]; attempts: AttemptResponse[];
}
export const investigateRequestSchema = z.object({}).strict();
export const editCaseFileRequestSchema = z.object({ caseFile: caseFileSchema, baseVersionId: z.string().uuid() }).strict();
export const approveRequestSchema = z.object({ versionId: z.string().uuid(), snapshotFingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const submitRequestSchema = z.object({ approvalId: z.string().uuid() }).strict();
export type InvestigateRequest = z.infer<typeof investigateRequestSchema>;
export type EditCaseFileRequest = z.infer<typeof editCaseFileRequestSchema>;
export type ApproveRequest = z.infer<typeof approveRequestSchema>;
export type SubmitRequest = z.infer<typeof submitRequestSchema>;
export interface InvestigateResponse { run: RunResponse; version?: CaseFileVersionResponse }
export interface EditCaseFileResponse { version: CaseFileVersionResponse }
export interface ApproveResponse { approval: ApprovalResponse }
export interface SubmitResponse { attempt: AttemptResponse; case: CaseDetailResponse }
export interface ApiErrorResponse { error: string; case?: CaseDetailResponse }
/** PDF preview returns application/pdf after approval, or ApiErrorResponse. */
export type EvidencePdfResponse = Uint8Array;
