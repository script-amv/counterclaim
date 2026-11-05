import { getStore } from '@/cases/runtime';
import { handle, json } from '@/api/http';
import { detailView } from '@/api/views';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => json(detailView(getStore(), (await context.params).id)));
}
