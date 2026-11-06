import { z } from 'zod';

const text = z.string().min(1).max(12000);
const citations = z.array(z.string().min(1).max(255)).min(1).max(100);
export const amountSchema = z.object({ currency_code: z.string().regex(/^[A-Z]{3}$/), value: z.string().regex(/^\d+(?:\.\d{1,3})?$/) }).strict();
export const caseFileSchema = z.object({
  summary: text,
  timeline: z.array(z.object({ date: z.iso.datetime({ offset: true }), event: text, citations }).strict()).max(100),
  claims: z.array(z.object({ text, citations }).strict()).max(100),
  gaps: z.array(z.object({ missing: text, why_it_matters: text }).strict()).max(100),
  recommendation: z.object({
    action: z.enum(['fight', 'offer', 'refund']), reasoning: text,
    confidence: z.object({ level: z.enum(['low', 'medium', 'high']), reason: text }).strict(),
    offer_amount: amountSchema.optional(),
  }).strict(),
  evidence_draft: z.object({ seller_note: z.string().min(1).max(2000).describe('Exact public message sent to PayPal and visible to the buyer. Address the recipient directly, politely and factually. Describe only supported carrier, delivery, signature, address-match and date evidence or the structured settlement offer. Never include internal costs, economics, win/loss analysis, reasoning, recommendations, confidence or internal record IDs.'), attach_records: z.array(z.string().min(1).max(255)).max(100) }).strict(),
}).strict().superRefine((file, ctx) => {
  if ((file.recommendation.action === 'offer') !== !!file.recommendation.offer_amount) {
    ctx.addIssue({ code: 'custom', message: 'An offer requires an amount; other actions must omit it' });
  }
});
export type CaseFile = z.infer<typeof caseFileSchema>;
export interface PrivacyFinding { path: string; rule: 'EMAIL' | 'PRIVATE_SOURCE_VALUE' }
export interface GuardResult { privacyFindings?: PrivacyFinding[]; accepted: boolean; reasons: string[]; warnings?: string[] }
export interface ReadSource { id: string; data: unknown }
export interface ToolTrace { tool: string; arguments: Record<string, string>; result: string }
export interface AgentRun {
  id: string; disputeId: string; model: string; status: 'running' | 'completed' | 'rejected' | 'failed';
  startedAt: string; endedAt?: string; toolCalls: ToolTrace[]; sources: ReadSource[];
  privacyFindings?: PrivacyFinding[];
  tokens: number; tokensEstimated: boolean; cost?: number; failure?: string;
  httpStatus?: number; refusalKind?: 'rate_limit' | 'allowance' | 'other'; provider?: string; providers?: string[]; turns?: number; failureCode?: import('./provider').FailureCode;
}
export interface CaseFileVersion {
  id: string; disputeId: string; runId: string; createdAt: string; caseFile: CaseFile; guard: GuardResult;
  sources: ReadSource[];
}
export type SubmissionAction = 'provide-evidence' | 'make-offer' | 'accept-claim';
export interface Approval {
  id: string; disputeId: string; versionId: string; contentHash: string; createdAt: string;
  content: SubmissionContent;
}
export interface SubmissionAttempt {
  id: string; disputeId: string; versionId: string; approvalId: string; stage: string;
  action: SubmissionAction; contentHash: string; status: 'submitting' | 'submitted' | 'failed' | 'unknown';
  startedAt: string; endedAt?: string;
  paypalError?: import('../paypal/error-details').SafePayPalError;
}

export interface SubmissionContent {
  versionId: string; stage: string; action: SubmissionAction; note: string;
  offer?: { currency_code: string; value: string };
  evidence?: { filename: string; pdfBase64: string; input: import('../paypal/client').EvidenceInput };
}
