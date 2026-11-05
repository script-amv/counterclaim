import { claimHighlights, instructionNotice } from '../ui/evidence';
import { trustedFacts } from '../agent/facts';
import { recordsForScenario } from '../records';
import type { CaseStore } from '../cases/storage';
import { deriveActions, deriveView } from '../cases/derive';
import { evidenceStrength } from '../guard/case-file';
import { casePrivateValues, containsPrivateText, privateValues, publicDispute } from './privacy';
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
export function approvalView(a: Approval): ApprovalResponse { return { stage: a.content.stage, id: a.id, versionId: a.versionId, contentHash: a.contentHash, createdAt: a.createdAt }; }
export function queueRow(store: CaseStore, id: string): CaseQueueRow {
  const d = store.get(id); if (!d) throw new ApiError(404, 'Case not found');
  const view = deriveView(d); const v = store.versions(id).at(-1);
  const order = recordsForScenario(store.scenario(id), d).find(r => r.type === 'order');
  const reference = order?.content.order_id;
  const label = order?.content.item;
  const item = typeof label === 'string' && containsPrivateText(label, casePrivateValues(store, id)) ? 'Sandbox order item' : label;
  const title = typeof item === 'string'
    ? `${item} · Order ${typeof reference === 'string' ? reference.replace('DEMO-ORDER-', '').split('-').map(part => part.slice(0, 3).toUpperCase()).join('-') : 'reference unavailable'}`
    : 'Recorded sandbox case';
  return { title, lastSyncedAt: store.lastSyncedAt(id), replay: store.isReplay(id), id, amount: d.dispute_amount ? { currency_code: d.dispute_amount.currency_code, value: d.dispute_amount.value } : null,
    reason: d.reason ?? null, stage: view.stage, deadline: view.deadline, whoseTurn: view.turn,
    nextActions: deriveActions(d), evidenceStrength: evidenceStrength(v?.guard, trustedFacts(d, recordsForScenario(store.scenario(id), d))) };
}
export function detailView(store: CaseStore, id: string): CaseDetailResponse {
  const d = store.get(id); if (!d) throw new ApiError(404, 'Case not found');
  const events = store.history(id); const forbidden = [...privateValues(d), ...events.flatMap(e => privateValues(e.snapshot))];
  const facts = trustedFacts(d, recordsForScenario(store.scenario(id), d));
  const latest = store.versions(id).at(-1);
  const citationHighlights = latest?.caseFile.claims.map(claim => Object.fromEntries(claim.citations.map(id => {
    const source = latest.sources.find(s => s.id === id);
    return [id, source ? claimHighlights(claim.text, source, facts) : []];
  }))) ?? [];
  return { snapshotFingerprint: store.snapshotFingerprint(id), computed: { citationHighlights, instructionNotice: instructionNotice(recordsForScenario(store.scenario(id), d), latest?.caseFile.recommendation.action, latest?.guard.accepted ?? false, facts), money: facts.money, gaps: facts.gaps }, case: queueRow(store, id), dispute: publicDispute(d),
    caseFileVersions: store.versions(id).map(v => versionView(v, forbidden)), runs: store.runs(id).map(runView),
    events: events.map(e => ({ id: e.id, kind: e.kind, observedAt: e.observedAt, snapshot: publicDispute(e.snapshot) })),
    approvals: store.approvals(id).map(approvalView), attempts: store.attempts(id) };
}
