import { expect, it } from 'vitest';
import { PayPalClient, PayPalError } from './client';
import { safePayPalError, submissionFailureReason } from './errors';

it('keeps only safe PayPal error fields and suppresses echoed private values', async () => {
  const responses = [new Response(JSON.stringify({ access_token: 'secret-token', expires_in: 100 })),
    new Response(JSON.stringify({ name: 'UNPROCESSABLE_ENTITY', message: 'The requested action could not be performed.', debug_id: 'debug123',
      details: [{ issue: 'MISSING_TRACKING_INFO', field: '/evidences/0/evidence_info/tracking_info', description: 'The tracking number and carrier name are missing.', value: 'buyer@example.com' }], request: { token: 'secret-token' } }), { status: 422 })];
  const client = new PayPalClient({ clientId: 'test', clientSecret: 'secret', fetch: async () => responses.shift()! });
  const error = await client.acceptClaim('FAKE', {}).catch(e => e);
  expect(safePayPalError(error)).toEqual({ status: 422, name: 'UNPROCESSABLE_ENTITY', message: 'The requested action could not be performed.', debug_id: 'debug123', details: [{ issue: 'MISSING_TRACKING_INFO', field: '/evidences/0/evidence_info/tracking_info', description: 'The tracking number and carrier name are missing.' }] });
  expect(submissionFailureReason(safePayPalError(error))).toContain('carrier');
});
it('redacts untrusted prose, tokens, personal data and non-schema field paths', () => {
  const e = new PayPalError(400, 'BAD_REQUEST', 'debug123', false, { message: 'Jane Doe lives at 12 Main Street; bearer secret-token', details: [{ issue: 'INVALID_PARAMETER', field: '/buyer/Jane Doe', description: 'buyer@example.com: Jane Doe' }] });
  const safe = safePayPalError(e, ['Jane Doe', '12 Main Street']);
  expect(JSON.stringify(safe)).not.toMatch(/Jane|Main Street|secret-token|buyer@example/);
  expect(safe?.details[0]?.field).toBeUndefined();
  expect(safePayPalError(new Error('secret-token'))).toBeUndefined();
});
it.each([new Response('not json'), new Response(JSON.stringify({ links: 'invalid' }))])('keeps the HTTP status when a successful write response is unreadable or violates the contract', async response => {
  const responses = [new Response(JSON.stringify({ access_token: 'secret-token', expires_in: 100 })), response];
  const client = new PayPalClient({ clientId: 'test', clientSecret: 'secret', fetch: async () => responses.shift()! });
  const error = await client.acceptClaim('FAKE', {}).catch(e => e);
  expect(safePayPalError(error)).toMatchObject({ status: 200, name: 'INVALID_RESPONSE' });
});
