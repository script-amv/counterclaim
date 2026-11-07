import { timingSafeEqual } from 'node:crypto';
import { getSync } from '@/cases/runtime';

import { isReplayOnly } from '@/cases/replay-only';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const reply = (body: object, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  if (isReplayOnly()) return reply({ error: 'Hosted replays are read-only' }, 403);
  if (!secret) return reply({ error: 'Cron is not configured' }, 503);
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(request.headers.get('authorization') ?? '');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return reply({ error: 'Unauthorized' }, 401);
  try { return reply(await getSync().syncAll()); }
  catch { return reply({ error: 'Sync failed' }, 500); }
}
