import { getCaseService } from '@/api/runtime';
import { getStore } from '@/cases/runtime';
import { handle, json, body, requireOperator } from '@/api/http';
import { detailView, versionView } from '@/api/views';
import { editCaseFileRequestSchema, type EditCaseFileResponse } from '@/api/contract';
import { casePrivateValues } from '@/api/privacy';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  let id: string;
  return handle(async () => {
    requireOperator(request); const input = await body(request, editCaseFileRequestSchema); id = (await context.params).id;
    return json({ version: versionView(getCaseService().edit(id, input.caseFile), casePrivateValues(getStore(), id)) } satisfies EditCaseFileResponse);
  }, () => detailView(getStore(), id));
}
