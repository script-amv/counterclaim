import { getStore } from '@/cases/runtime';
import { handle, json } from '@/api/http';
import { queueRow } from '@/api/views';
import type { CasesResponse } from '@/api/contract';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() { return handle(() => { const store = getStore(); return json({ cases: store.ids().filter(id => !id.startsWith('TEST-') || process.env.DATABASE_PATH?.endsWith('/e2e.db')).map(id => queueRow(store, id)) } satisfies CasesResponse); }); }
