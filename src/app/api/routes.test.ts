import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ verify: vi.fn(), syncDispute: vi.fn(), syncAll: vi.fn(), health: vi.fn() }));
vi.mock('@/cases/runtime', () => ({
  getPayPal: () => ({ verifyWebhookSignature: mocks.verify }),
  getSync: () => ({ syncDispute: mocks.syncDispute, syncAll: mocks.syncAll }),
  getStore: () => ({ checkHealth: mocks.health }),
}));
import { POST as webhook } from './webhooks/paypal/route';
import { GET as cron } from './cron/sync/route';
import { GET as health } from './health/route';
const event = { id: 'FAKE-EVENT', event_type: 'CUSTOMER.DISPUTE.UPDATED', resource: { dispute_id: 'FAKE-DISPUTE', buyer: { email: 'fake@example.invalid' } } };
function request(payload: unknown = event) {
  return new Request('http://localhost/api/webhooks/paypal', { method: 'POST', headers: { 'Content-Type': 'application/json', 'paypal-transmission-id': 'fake-transmission' }, body: JSON.stringify(payload) });
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('PAYPAL_WEBHOOK_ID', 'fake-webhook'); vi.stubEnv('CRON_SECRET', 'fake-cron-secret');
  mocks.verify.mockResolvedValue(true); mocks.syncDispute.mockResolvedValue({ changed: true });
  mocks.syncAll.mockResolvedValue({ synced: 2, changed: 1 });
  mocks.health.mockReturnValue(undefined);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('PayPal webhook route', () => {
  it.each(['CUSTOMER.DISPUTE.CREATED', 'CUSTOMER.DISPUTE.UPDATED', 'CUSTOMER.DISPUTE.RESOLVED'])('verifies %s before fetching authoritative state', async event_type => {
    const payload = { ...event, event_type };
    const response = await webhook(request(payload));
    expect(response.status).toBe(200);
    expect(mocks.verify).toHaveBeenCalledWith(expect.any(Headers), JSON.stringify(payload), 'fake-webhook');
    expect(mocks.syncDispute).toHaveBeenCalledWith('FAKE-DISPUTE');
    expect(mocks.verify.mock.invocationCallOrder[0]).toBeLessThan(mocks.syncDispute.mock.invocationCallOrder[0]!);
    expect(await response.text()).not.toContain('fake@example.invalid');
  });
  it('passes the exact raw JSON text to verification while parsing separately for routing', async () => {
    const raw = String.raw` { "event_type" : "CUSTOMER.DISPUTE.UPDATED", "resource": {"dispute_id":"FAKE-DISPUTE", "escape":"\u0061\/b", "amount":1.2300e+02, "zero":-0} } `;
    const response = await webhook(new Request('http://localhost', { method: 'POST', body: raw }));
    expect(response.status).toBe(200);
    expect(mocks.verify).toHaveBeenCalledWith(expect.any(Headers), raw, 'fake-webhook');
    expect(mocks.syncDispute).toHaveBeenCalledWith('FAKE-DISPUTE');
  });
  it('rejects a bad signature without syncing', async () => {
    mocks.verify.mockResolvedValue(false);
    expect((await webhook(request())).status).toBe(400);
    expect(mocks.syncDispute).not.toHaveBeenCalled();
  });
  it('acknowledges a verified unknown event without syncing', async () => {
    expect((await webhook(request({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'NOT-A-DISPUTE' } }))).status).toBe(200);
    expect(mocks.verify).toHaveBeenCalledOnce();
    expect(mocks.syncDispute).not.toHaveBeenCalled();
  });
  it('still rejects bad signatures on unknown events', async () => {
    mocks.verify.mockResolvedValue(false);
    expect((await webhook(request({ event_type: 'UNKNOWN' }))).status).toBe(400);
  });
  it('rejects malformed events and missing dispute IDs', async () => {
    expect((await webhook(new Request('http://localhost', { method: 'POST', body: '{' }))).status).toBe(400);
    expect((await webhook(request({ event_type: 12 }))).status).toBe(400);
    expect((await webhook(request({ event_type: event.event_type, resource: { id: 'NOT-DISPUTE-ID' } }))).status).toBe(400);
    expect(mocks.syncDispute).not.toHaveBeenCalled();
  });
  it('fails closed on missing configuration and allows delivery retry on provider/storage failure', async () => {
    vi.stubEnv('PAYPAL_WEBHOOK_ID', '');
    expect((await webhook(request())).status).toBe(503);
    expect(mocks.verify).not.toHaveBeenCalled();
    vi.stubEnv('PAYPAL_WEBHOOK_ID', 'fake-webhook');
    mocks.syncDispute.mockRejectedValue(new Error('private buyer name'));
    const response = await webhook(request());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('private buyer name');
  });
});

describe('cron and health routes', () => {
  it('requires a configured exact bearer token before any sync', async () => {
    for (const authorization of ['', 'Bearer wrong', 'bearer fake-cron-secret']) {
      expect((await cron(new Request('http://localhost', { headers: { authorization } }))).status).toBe(401);
    }
    expect(mocks.syncAll).not.toHaveBeenCalled();
    expect((await cron(new Request('http://localhost', { headers: { authorization: 'Bearer fake-cron-secret' } }))).status).toBe(200);
    expect(mocks.syncAll).toHaveBeenCalledOnce();
    vi.stubEnv('CRON_SECRET', '');
    expect((await cron(new Request('http://localhost', { headers: { authorization: 'Bearer undefined' } }))).status).toBe(503);
  });
  it('returns safe failures and checks storage health without PayPal', async () => {
    expect((await health()).status).toBe(200);
    expect(mocks.health).toHaveBeenCalledOnce();
    expect(mocks.verify).not.toHaveBeenCalled();
    mocks.health.mockImplementation(() => { throw new Error('private path'); });
    expect((await health()).status).toBe(503);
    mocks.syncAll.mockRejectedValue(new Error('private provider text'));
    const response = await cron(new Request('http://localhost', { headers: { authorization: 'Bearer fake-cron-secret' } }));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('private');
  });
});
