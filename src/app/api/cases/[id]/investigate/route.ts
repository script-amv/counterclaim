import { getStore } from '@/cases/runtime';
import { getModel } from '@/api/runtime';
import { ApiError } from '@/api/service';
import { handle, json, body, requireOperator, ipHash } from '@/api/http';
import { investigate } from '@/agent/loop';
import { runView, versionView } from '@/api/views';
import { investigateRequestSchema, type InvestigateResponse } from '@/api/contract';
import { casePrivateValues } from '@/api/privacy';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    requireOperator(request); await body(request, investigateRequestSchema);
    const { id } = await context.params; const store = getStore();
    const dispute = store.get(id); if (!dispute) throw new ApiError(404, 'Case not found');
    store.assertMutable(id);
    if (!store.takeInvestigationSlot(ipHash(request))) throw new ApiError(429, 'Investigation rate limit reached');
    const result = await investigate(store, getModel(), id);
    return json({ run: runView(result.run), version: result.version ? versionView(result.version, casePrivateValues(store, id)) : undefined } satisfies InvestigateResponse);
  });
}
