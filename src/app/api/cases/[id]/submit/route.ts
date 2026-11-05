import { getCaseService } from '@/api/runtime';
import { getStore } from '@/cases/runtime';
import { handle, json, body, requireOperator } from '@/api/http';
import { detailView } from '@/api/views';
import { submitRequestSchema, type SubmitResponse } from '@/api/contract';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let id: string;
  return handle(async () => {
    requireOperator(request); const input = await body(request, submitRequestSchema); id = (await context.params).id;
    const attempt = await getCaseService().submit(id, input.approvalId);
    return json({ attempt, case: detailView(getStore(), id) } satisfies SubmitResponse, attempt.status === 'submitted' ? 200 : 409);
  }, () => detailView(getStore(), id));
}
