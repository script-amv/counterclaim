import { getCaseService } from '@/api/runtime';
import { handle } from '@/api/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => new Response(new Uint8Array(await getCaseService().preview((await context.params).id)), {
    headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store', 'Content-Disposition': 'inline; filename="counterclaim-demo.pdf"', 'X-Content-Type-Options': 'nosniff' },
  }));
}
