import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { PayPalClient, PayPalError, SANDBOX_BASE_URL } from './client';
import { trace } from './test-fixtures';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const token = () => json({ access_token: 'fake-access-token', expires_in: 100 });
function setup(responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    const response = responses.shift();
    if (response instanceof Error) throw response;
    if (!response) throw new Error('Fake response queue exhausted');
    return response;
  });
  let time = 0;
  const client = new PayPalClient({ clientId: 'fake-client', clientSecret: 'fake-secret', fetch: fetcher, now: () => time });
  return { client, calls, setTime: (t: number) => { time = t; } };
}

describe('sandbox PayPal client', () => {
  it('defines the production host start command and persistent database configuration', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(pkg.scripts.start).toBe('next start');
    const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
    expect(readme).toContain('npm start -- --hostname 0.0.0.0 --port "$PORT"');
    expect(readme).toContain('DATABASE_PATH=/var/data/counterclaim.db');
  });
  it('caches OAuth tokens, shares concurrent authentication, then refreshes before expiry', async () => {
    const { client, calls, setTime } = setup([token(), json(trace[0]), json(trace[0]), token(), json(trace[0])]);
    await Promise.all([client.getDispute('FAKE'), client.getDispute('FAKE')]);
    expect(calls.filter(c => c.url.endsWith('/token'))).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${SANDBOX_BASE_URL}/v1/oauth2/token`);
    expect(calls[0]!.init.method).toBe('POST');
    expect(Object.fromEntries(new Headers(calls[0]!.init.headers))).toEqual({
      accept: 'application/json',
      authorization: `Basic ${Buffer.from('fake-client:fake-secret').toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    });
    expect(String(calls[0]!.init.body)).toBe('grant_type=client_credentials');
    expect(new Headers(calls[1]!.init.headers).get('authorization')).toBe('Bearer fake-access-token');
    setTime(100_000);
    await client.getDispute('FAKE');
    expect(calls.filter(c => c.url.endsWith('/token'))).toHaveLength(2);
    expect(calls.every(c => c.url.startsWith(SANDBOX_BASE_URL))).toBe(true);
    expect(calls.every(c => c.init.redirect === 'error')).toBe(true);
  });
  it('sends JSON input and evidence-file with matching document names', async () => {
    const { client, calls } = setup([token(), json({ links: [] })]);
    await client.provideEvidence('FAKE', { evidences: [{ evidence_type: 'OTHER', documents: [{ name: 'fake.pdf' }] }] }, new File(['fake-pdf'], 'fake.pdf', { type: 'application/pdf' }));
    const request = calls[1]!.init;
    expect(calls[1]!.url).toBe(`${SANDBOX_BASE_URL}/v1/customer/disputes/FAKE/provide-evidence`);
    expect(request.method).toBe('POST');
    expect(Object.fromEntries(new Headers(request.headers))).toEqual({ accept: 'application/json', authorization: 'Bearer fake-access-token' });
    expect(request.redirect).toBe('error');
    const form = request.body as FormData;
    expect([...form.keys()]).toEqual(['input', 'evidence-file']);
    expect((form.get('input') as File).type).toBe('application/json');
    expect((form.get('input') as File).name).toBe('input.json');
    expect(JSON.parse(await (form.get('input') as File).text())).toEqual({ evidences: [{ evidence_type: 'OTHER', documents: [{ name: 'fake.pdf' }] }] });
    expect((form.get('evidence-file') as File).type).toBe('application/pdf');
    expect((form.get('evidence-file') as File).name).toBe('fake.pdf');
    expect(await (form.get('evidence-file') as File).text()).toBe('fake-pdf');
  });
  it('returns typed refusal metadata without arbitrary server text', async () => {
    const { client, calls } = setup([token(), json({ name: 'UNPROCESSABLE_ENTITY', debug_id: 'fake-debug', message: 'buyer@example.invalid fake-secret', details: [{ issue: 'ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE' }] }, 422)]);
    const error = await client.escalate('FAKE', { note: 'Please review' }).catch(e => e);
    expect(error).toBeInstanceOf(PayPalError);
    expect(error).toMatchObject({ status: 422, name: 'UNPROCESSABLE_ENTITY', debug_id: 'fake-debug' });
    expect(error.isActionNotAllowed()).toBe(true);
    expect(String(error)).not.toContain('buyer@');
    expect(String(error)).not.toContain('fake-secret');
    expect(calls).toHaveLength(2);
  });
  it.each([new Error('secret transport detail'), json({}, 503)])('never retries a write failure (%s)', async failure => {
    const { client, calls } = setup([token(), failure]);
    await expect(client.sendMessage('FAKE', { message: 'Hello' })).rejects.toThrow();
    expect(calls).toHaveLength(2);
  });
  it.each([new Error('network failure'), json({}, 503)])('retries a failed read once (%s)', async failure => {
    const { client, calls } = setup([token(), failure, json(trace[0])]);
    expect((await client.getDispute('FAKE')).dispute_id).toBe('PP-R-ZAT-10196609');
    expect(calls).toHaveLength(3);
  });
  it('retries a network interruption during a successful read body, but never a write body', async () => {
    const interrupted = () => new Response(new ReadableStream({
      start(controller) { controller.error(new TypeError('fake connection interrupted')); },
    }), { status: 200 });
    const read = setup([token(), interrupted(), json(trace[0])]);
    expect((await read.client.getDispute('FAKE')).dispute_id).toBe('PP-R-ZAT-10196609');
    expect(read.calls).toHaveLength(3);
    const write = setup([token(), interrupted()]);
    await expect(write.client.escalate('FAKE', {})).rejects.toThrow();
    expect(write.calls).toHaveLength(2);
    const malformed = setup([token(), new Response('{', { status: 200 })]);
    await expect(malformed.client.getDispute('FAKE')).rejects.toThrow('Invalid PayPal response');
    expect(malformed.calls).toHaveLength(2);
  });
  it('stops after one read retry and does not retry 4xx', async () => {
    const first = setup([token(), json({}, 503), json({}, 503)]);
    await expect(first.client.getDispute('FAKE')).rejects.toMatchObject({ status: 503 });
    expect(first.calls).toHaveLength(3);
    const second = setup([token(), json({}, 404)]);
    await expect(second.client.getDispute('FAKE')).rejects.toMatchObject({ status: 404 });
    expect(second.calls).toHaveLength(2);
  });
  it('implements every action on fixed paths and handles empty success bodies', async () => {
    const { client, calls } = setup([token(), ...Array.from({ length: 6 }, () => new Response(null, { status: 204 }))]);
    await client.escalate('FAKE', { note: 'review' });
    await client.acceptClaim('FAKE', { note: 'refund' });
    await client.makeOffer('FAKE', { note: 'offer', offer_type: 'REFUND', offer_amount: { currency_code: 'USD', value: '1.00' } });
    await client.sendMessage('FAKE', { message: 'hello' });
    await client.adjudicate('FAKE', 'SELLER_FAVOR');
    await client.requireEvidence('FAKE', 'SELLER_EVIDENCE');
    const expected = [
      ['escalate', { note: 'review' }],
      ['accept-claim', { note: 'refund' }],
      ['make-offer', { note: 'offer', offer_type: 'REFUND', offer_amount: { currency_code: 'USD', value: '1.00' } }],
      ['send-message', { message: 'hello' }],
      ['adjudicate', { adjudication_outcome: 'SELLER_FAVOR' }],
      ['require-evidence', { action: 'SELLER_EVIDENCE' }],
    ];
    expect(calls).toHaveLength(7);
    for (const [index, [action, body]] of expected.entries()) {
      const call = calls[index + 1]!;
      expect(call.url).toBe(`${SANDBOX_BASE_URL}/v1/customer/disputes/FAKE/${action}`);
      expect(call.init.method).toBe('POST');
      expect(Object.fromEntries(new Headers(call.init.headers))).toEqual({
        accept: 'application/json', authorization: 'Bearer fake-access-token', 'content-type': 'application/json',
      });
      expect(call.init.body).toBe(JSON.stringify(body));
      expect(call.init.redirect).toBe('error');
    }
  });
  it('reads orders and all dispute pages, rebuilding sandbox alias URLs on the fixed origin', async () => {
    const { client, calls } = setup([token(), json({ id: 'FAKE', status: 'COMPLETED' }), json({ items: [trace[0]], links: [{ rel: 'next', href: 'https://api.sandbox.paypal.com/v1/customer/disputes?next_page_token=FAKE', method: 'GET' }] }), json({ items: [] })]);
    expect((await client.getOrder('FAKE')).id).toBe('FAKE');
    expect(await client.listDisputes()).toHaveLength(1);
    expect(calls.at(-1)!.url).toBe(`${SANDBOX_BASE_URL}/v1/customer/disputes?next_page_token=FAKE`);
  });
  it('rejects foreign pagination URLs and malformed responses safely', async () => {
    const { client } = setup([token(), json({ links: [{ rel: 'next', href: 'https://evil.invalid/v1/customer/disputes' }] })]);
    await expect(client.listDisputes()).rejects.toThrow('Invalid PayPal pagination link');
    const malformed = setup([token(), json({ buyer_email: 'private@example.invalid' })]);
    await expect(malformed.client.getDispute('FAKE')).rejects.toThrow('Invalid PayPal response');
  });
  it('rejects malformed raw event JSON before authentication', async () => {
    const { client, calls } = setup([]);
    for (const raw of ['{', 'null', '[]', '"text"']) {
      expect(await client.verifyWebhookSignature(new Headers(), raw, 'fake-webhook')).toBe(false);
    }
    expect(calls).toHaveLength(0);
  });
  it('verifies the original webhook event using PayPal header mappings', async () => {
    const { client, calls } = setup([token(), json({ verification_status: 'SUCCESS' }), json({ verification_status: 'FAILURE' })]);
    const headers = new Headers({ 'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://example.invalid/cert', 'paypal-transmission-id': 'fake-id', 'paypal-transmission-sig': 'fake-sig', 'paypal-transmission-time': '2026-11-05T00:00:00Z' });
    const event = String.raw` { "event_type" : "CUSTOMER.DISPUTE.UPDATED",
      "resource": {"dispute_id":"FAKE", "escaped":"a\u0062\/c\n", "number":1.2300e+02, "zero":-0 } } `;
    expect(await client.verifyWebhookSignature(headers, event, 'fake-webhook')).toBe(true);
    const verification = calls[1]!;
    expect(verification.url).toBe(`${SANDBOX_BASE_URL}/v1/notifications/verify-webhook-signature`);
    expect(verification.init.method).toBe('POST');
    expect(Object.fromEntries(new Headers(verification.init.headers))).toEqual({
      accept: 'application/json', authorization: 'Bearer fake-access-token', 'content-type': 'application/json',
    });
    const fields = { auth_algo: 'SHA256withRSA', cert_url: 'https://example.invalid/cert', transmission_id: 'fake-id', transmission_sig: 'fake-sig', transmission_time: '2026-11-05T00:00:00Z', webhook_id: 'fake-webhook' };
    expect(verification.init.body).toBe(`${JSON.stringify(fields).slice(0, -1)},"webhook_event":${event}}`);
    expect(JSON.parse(String(verification.init.body))).toEqual({ ...fields, webhook_event: JSON.parse(event) });
    expect(await client.verifyWebhookSignature(headers, event, 'fake-webhook')).toBe(false);
    expect(await client.verifyWebhookSignature(new Headers(), event, 'fake-webhook')).toBe(false);
    expect(calls).toHaveLength(3);
  });
});
