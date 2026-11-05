import { z } from 'zod';
import { getPayPal, getSync } from '@/cases/runtime';
import { webhookSchema } from '@/paypal/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const knownEvents = new Set(['CUSTOMER.DISPUTE.CREATED', 'CUSTOMER.DISPUTE.UPDATED', 'CUSTOMER.DISPUTE.RESOLVED']);
const resourceSchema = z.object({ dispute_id: z.string().regex(/^[A-Za-z0-9-]{1,255}$/) });
const reply = (body: object, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: Request) {
  let event: unknown;
  let rawEvent: string;
  try { rawEvent = await request.text(); event = JSON.parse(rawEvent); } catch { return reply({ error: 'Invalid webhook JSON' }, 400); }
  const parsed = webhookSchema.safeParse(event);
  if (!parsed.success) return reply({ error: 'Invalid webhook event' }, 400);
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return reply({ error: 'Webhook is not configured' }, 503);
  try {
    // Preserve signed whitespace, escapes and number spellings; parse only for routing.
    if (!await getPayPal().verifyWebhookSignature(request.headers, rawEvent, webhookId)) {
      return reply({ error: 'Invalid webhook signature' }, 400);
    }
    if (!knownEvents.has(parsed.data.event_type)) return reply({ ignored: true });
    const resource = resourceSchema.safeParse(parsed.data.resource);
    if (!resource.success) return reply({ error: 'Missing dispute ID' }, 400);
    await getSync().syncDispute(resource.data.dispute_id);
    return reply({ ok: true });
  } catch {
    // A non-2xx allows PayPal to redeliver after verification/sync outages.
    return reply({ error: 'Webhook processing failed' }, 500);
  }
}
