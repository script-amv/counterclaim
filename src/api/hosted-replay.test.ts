import { afterEach, expect, it, vi } from 'vitest';
import { GET as queue } from '../app/api/cases/route';
import { GET as detail } from '../app/api/cases/[id]/route';
import { POST as investigate } from '../app/api/cases/[id]/investigate/route';
import { GET as sync } from '../app/api/cron/sync/route';
import { POST as webhook } from '../app/api/webhooks/paypal/route';

afterEach(() => vi.unstubAllEnvs());

it('serves only seeded replays on Vercel and refuses writes even when configured', async () => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('DATABASE_PATH', '/dev/null/must-not-open.db');
  vi.stubEnv('OPERATOR_CODE', 'test-operator');
  vi.stubEnv('CRON_SECRET', 'test-cron');
  vi.stubEnv('PAYPAL_WEBHOOK_ID', 'test-webhook');
  const request = new Request('http://localhost');
  const context = { params: Promise.resolve({ id: 'REPLAY-strong-delivery' }) };
  const cases = await (await queue()).json();
  expect(cases.cases.map((row: { id: string }) => row.id).sort()).toEqual([
    'PP-R-ZAT-10196609',
    'REPLAY-injection',
    'REPLAY-low-value',
    'REPLAY-strong-delivery',
    'REPLAY-weak-delivery',
  ]);
  expect((await detail(request, context)).status).toBe(200);
  expect((await investigate(new Request('http://localhost', {
    method: 'POST',
    headers: { authorization: 'Bearer test-operator' },
  }), context)).status).toBe(403);
  expect((await sync(new Request('http://localhost', {
    headers: { authorization: 'Bearer test-cron' },
  }))).status).toBe(403);
  expect((await webhook(request)).status).toBe(403);
});
