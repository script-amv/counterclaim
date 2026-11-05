import { getCaseService } from '@/api/runtime';
import { getStore } from '@/cases/runtime';
import { handle, json, body, requireOperator } from '@/api/http';
import { detailView, approvalView } from '@/api/views';
import { approveRequestSchema, type ApproveResponse } from '@/api/contract';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let id: string;
  return handle(async () => {
    requireOperator(request); const input = await body(request, approveRequestSchema); id = (await context.params).id;
    return json({ approval: approvalView(await getCaseService().approve(id, input.versionId, input.snapshotFingerprint)) } satisfies ApproveResponse);
  }, () => detailView(getStore(), id));
}
