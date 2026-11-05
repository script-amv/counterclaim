import { trustedFacts } from '../agent/facts';
import { recordsForScenario } from '../records';
import type { CaseStore } from '../cases/storage';
import { deriveActions, deriveView } from '../cases/derive';
import { evidenceStrength } from '../guard/case-file';
import { containsPrivateText, privateValues, publicDispute } from './privacy';
import type { CaseFileVersion, AgentRun, Approval } from '../agent/schema';
import type { CaseDetailResponse, CaseFileVersionResponse, CaseQueueRow, RunResponse, ApprovalResponse } from './contract';
import { ApiError } from './service';

export function versionView(version: CaseFileVersion, forbidden: string[] = []): CaseFileVersionResponse {
  return { id: version.id, runId: version.runId, createdAt: version.createdAt,
    caseFile: containsPrivateText(version.caseFile, forbidden) ? null : version.caseFile, guard: version.guard,
    sources: version.sources.filter(source => !containsPrivateText(source.data, forbidden)) };
}
export function runView(r: AgentRun): RunResponse {
  return { id: r.id, model: r.model, status: r.status, startedAt: r.startedAt, endedAt: r.endedAt,
    toolCalls: r.toolCalls, tokens: r.tokens, tokensEstimated: r.tokensEstimated, cost: r.cost, failure: r.failure, provider: r.provider, turns: r.turns, failureCode: r.failureCode };
}
export function approvalView(a: Approval): ApprovalResponse { return { id: a.id, versionId: a.versionId, contentHash: a.contentHash, createdAt: a.createdAt }; }
export function queueRow(store: CaseStore, id: string): CaseQueueRow {
  const d = store.get(id); if (!d) throw new ApiError(404, 'Case not found');
  const view = deriveView(d); const v = store.versions(id).at(-1);
  return { id, amount: d.dispute_amount ? { currency_code: d.dispute_amount.currency_code, value: d.dispute_amount.value } : null,
    reason: d.reason ?? null, stage: view.stage, deadline: view.deadline, whoseTurn: view.turn,
    nextActions: deriveActions(d), evidenceStrength: evidenceStrength(v?.guard, trustedFacts(d, recordsForScenario(store.scenario(id)))) };
}
export function detailView(store: CaseStore, id: string): CaseDetailResponse {
  const d = store.get(id); if (!d) throw new ApiError(404, 'Case not found');
  const events = store.history(id); const forbidden = [...privateValues(d), ...events.flatMap(e => privateValues(e.snapshot))];
  return { case: queueRow(store, id), dispute: publicDispute(d),
    caseFileVersions: store.versions(id).map(v => versionView(v, forbidden)), runs: store.runs(id).map(runView),
    events: events.map(e => ({ id: e.id, kind: e.kind, observedAt: e.observedAt, snapshot: publicDispute(e.snapshot) })),
    approvals: store.approvals(id).map(approvalView), attempts: store.attempts(id) };
}
