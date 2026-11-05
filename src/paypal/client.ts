import { z } from 'zod';
import {
  actionResponseSchema, disputeListSchema, disputeSchema, orderSchema,
  tokenSchema, verificationSchema, type DisputeSummary,
} from './schemas';

export const SANDBOX_BASE_URL = 'https://api-m.sandbox.paypal.com';
const DISPUTES = '/v1/customer/disputes';
const REFUSAL = 'ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE';
const safeCode = (value: unknown, fallback: string) => typeof value === 'string'
  && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : fallback;

export class PayPalError extends Error {
  readonly status: number;
  readonly debug_id: string | undefined;
  private readonly refused: boolean;
  constructor(status: number, name: string, debugId?: string, refused = false) {
    super(`PayPal request failed (HTTP ${status})`);
    this.name = safeCode(name, 'PAYPAL_ERROR');
    this.status = status;
    this.debug_id = debugId ? safeCode(debugId, '') || undefined : undefined;
    this.refused = refused;
  }
  isActionNotAllowed() { return this.refused; }
}
export function isActionNotAllowed(error: unknown): error is PayPalError {
  return error instanceof PayPalError && error.isActionNotAllowed();
}

interface ClientOptions {
  clientId: string;
  clientSecret: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}
export interface EvidenceInput {
  evidences: Array<{ evidence_type: string; documents?: Array<{ name: string }>; [key: string]: unknown }>;
}
export interface MakeOfferInput {
  note: string;
  offer_type: 'REFUND' | 'REFUND_WITH_RETURN' | 'REFUND_WITH_REPLACEMENT' | 'REPLACEMENT_WITHOUT_REFUND';
  offer_amount?: { currency_code: string; value: string };
  [key: string]: unknown;
}

export class PayPalClient {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly now: () => number;
  private token?: { value: string; expiresAt: number };
  private authenticating?: Promise<string>;
  constructor(private readonly options: ClientOptions) {
    if (!options.clientId || !options.clientSecret) throw new Error('PayPal credentials are required');
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
  }

  private async transport(path: string, init: RequestInit, read = false): Promise<unknown> {
    let response: Response | undefined;
    let data: unknown;
    for (let attempt = 0; attempt < (read ? 2 : 1); attempt++) {
      try {
        response = await this.fetcher(`${SANDBOX_BASE_URL}${path}`, {
          ...init, redirect: 'error', signal: AbortSignal.timeout(30_000),
        });
      } catch {
        if (read && attempt === 0) continue;
        throw new Error('PayPal network request failed; details suppressed');
      }
      if (read && attempt === 0 && response.status >= 500 && response.status <= 599) {
        try { await response.body?.cancel(); } catch { /* Discard failed read before retry. */ }
        continue;
      }
      try { data = response.status === 204 ? {} : await response.json(); }
      catch (error) {
        // Fetch resolves at headers; body download can still fail or time out.
        // Invalid JSON is a contract error, not a transient network error.
        if (read && attempt === 0 && response.ok && !(error instanceof SyntaxError)) continue;
        if (response.ok) throw new Error('Invalid PayPal response');
        data = {};
      }
      break;
    }
    if (!response) throw new Error('PayPal network request failed');
    if (!response.ok) {
      const parsed = z.object({ name: z.string().optional(), debug_id: z.string().optional(),
        details: z.array(z.object({ issue: z.string().optional() })).optional(),
      }).safeParse(data);
      const error = parsed.success ? parsed.data : {};
      throw new PayPalError(response.status, error.name ?? 'PAYPAL_ERROR',
        response.headers.get('paypal-debug-id') ?? error.debug_id,
        error.name === REFUSAL || error.details?.some(d => d.issue === REFUSAL));
    }
    return data;
  }

  private validate<T>(schema: z.ZodType<T>, data: unknown): T {
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new Error('Invalid PayPal response');
    return parsed.data;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.now() < this.token.expiresAt) return this.token.value;
    if (this.authenticating) return this.authenticating;
    this.authenticating = (async () => {
      const started = this.now();
      const data = this.validate(tokenSchema, await this.transport('/v1/oauth2/token', {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`${this.options.clientId}:${this.options.clientSecret}`).toString('base64')}`,
          Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials' }),
      }));
      this.token = { value: data.access_token, expiresAt: started + data.expires_in * 1000 - Math.min(30_000, data.expires_in * 100) };
      return this.token.value;
    })();
    try { return await this.authenticating; }
    finally { this.authenticating = undefined; }
  }

  private async request<T>(path: string, schema: z.ZodType<T>, body?: object | FormData | string): Promise<T> {
    const token = await this.accessToken();
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    return this.validate(schema, await this.transport(path, {
      method: body === undefined ? 'GET' : 'POST', headers,
      body: body instanceof FormData || typeof body === 'string' ? body : body === undefined ? undefined : JSON.stringify(body),
    }, body === undefined));
  }

  private disputePath(id: string) {
    if (!/^[A-Za-z0-9-]{1,255}$/.test(id)) throw new Error('Invalid PayPal dispute ID');
    return `${DISPUTES}/${id}`;
  }
  getDispute(id: string) { return this.request(this.disputePath(id), disputeSchema); }
  getOrder(id: string) {
    if (!/^[A-Za-z0-9-]{1,255}$/.test(id)) throw new Error('Invalid PayPal order ID');
    return this.request(`/v2/checkout/orders/${id}`, orderSchema);
  }

  /** Includes all pages. Never follow a response-supplied URL as a fetch target. */
  async listDisputes(): Promise<DisputeSummary[]> {
    let path: string | undefined = `${DISPUTES}?page_size=50`;
    const visited = new Set<string>();
    const items = new Map<string, DisputeSummary>();
    while (path) {
      if (visited.has(path)) throw new Error('Repeated PayPal pagination link');
      visited.add(path);
      const page = await this.request(path, disputeListSchema);
      for (const item of page.items) items.set(item.dispute_id, item);
      const next = page.links?.find(l => l.rel === 'next');
      path = undefined;
      if (next) {
        let url: URL;
        try { url = new URL(next.href, SANDBOX_BASE_URL); }
        catch { throw new Error('Invalid PayPal pagination link'); }
        if (![SANDBOX_BASE_URL, 'https://api.sandbox.paypal.com'].includes(url.origin)
          || url.pathname !== DISPUTES || url.username || url.password || url.hash
          || (next.method && next.method !== 'GET')) throw new Error('Invalid PayPal pagination link');
        path = `${DISPUTES}${url.search}`;
      }
    }
    return [...items.values()];
  }

  private write(id: string, action: string, body: object | FormData) {
    return this.request(`${this.disputePath(id)}/${action}`, actionResponseSchema, body);
  }
  provideEvidence(id: string, input: EvidenceInput, file: File) {
    if (!file.size || file.size >= 10_000_000 || !['application/pdf', 'image/jpeg', 'image/png', 'image/gif'].includes(file.type)) {
      throw new Error('Evidence must be a supported nonempty file smaller than 10 MB');
    }
    if (!input.evidences.some(e => e.documents?.some(d => d.name === file.name))) {
      throw new Error('Evidence document name must match the attached file');
    }
    const form = new FormData();
    form.append('input', new Blob([JSON.stringify(input)], { type: 'application/json' }), 'input.json');
    form.append('evidence-file', file, file.name);
    return this.write(id, 'provide-evidence', form);
  }
  escalate(id: string, input: { note?: string; buyer_escalation_reason?: string }) { return this.write(id, 'escalate', input); }
  acceptClaim(id: string, input: { note?: string; [key: string]: unknown }) { return this.write(id, 'accept-claim', input); }
  makeOffer(id: string, input: MakeOfferInput) { return this.write(id, 'make-offer', input); }
  sendMessage(id: string, input: { message: string }) { return this.write(id, 'send-message', input); }
  /** Sandbox control; a forced settlement is not a judgement of evidence quality. */
  adjudicate(id: string, outcome: 'SELLER_FAVOR' | 'BUYER_FAVOR') { return this.write(id, 'adjudicate', { adjudication_outcome: outcome }); }
  /** Sandbox control only. */
  requireEvidence(id: string, action: 'SELLER_EVIDENCE' | 'BUYER_EVIDENCE') { return this.write(id, 'require-evidence', { action }); }

  async verifyWebhookSignature(headers: Headers, rawEvent: string, webhookId: string): Promise<boolean> {
    // Validate without reserializing: PayPal must receive the original JSON bytes.
    try {
      const parsed: unknown = JSON.parse(rawEvent);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    } catch { return false; }
    const mappings = { auth_algo: 'paypal-auth-algo', cert_url: 'paypal-cert-url', transmission_id: 'paypal-transmission-id',
      transmission_sig: 'paypal-transmission-sig', transmission_time: 'paypal-transmission-time' };
    const fields: Record<string, string> = {};
    if (!webhookId) return false;
    for (const [key, header] of Object.entries(mappings)) {
      const value = headers.get(header);
      if (!value) return false;
      fields[key] = value;
    }
    const metadata = JSON.stringify({ ...fields, webhook_id: webhookId });
    const body = `${metadata.slice(0, -1)},"webhook_event":${rawEvent}}`;
    const result = await this.request('/v1/notifications/verify-webhook-signature', verificationSchema, body);
    return result.verification_status === 'SUCCESS';
  }
}
