import { z } from 'zod';

// Validate the fields used by the foundation while retaining PayPal's evolving payload.
export const linkSchema = z.object({
  rel: z.string().min(1), href: z.string().min(1), method: z.string().optional(),
}).passthrough();
const moneySchema = z.object({ currency_code: z.string(), value: z.string() }).passthrough();
const timestamp = z.iso.datetime({ offset: true });
export const disputeSummarySchema = z.object({
  dispute_id: z.string().regex(/^[A-Za-z0-9-]+$/),
  status: z.string().min(1),
  dispute_state: z.string().optional(),
  dispute_life_cycle_stage: z.string().optional(),
  reason: z.string().optional(),
  create_time: timestamp.optional(), update_time: timestamp.optional(),
  seller_response_due_date: timestamp.optional(), buyer_response_due_date: timestamp.optional(),
  dispute_amount: moneySchema.optional(),
  links: z.array(linkSchema).optional(),
}).passthrough();
export const disputeSchema = disputeSummarySchema.extend({
  dispute_outcome: z.object({ outcome_code: z.string().optional() }).passthrough().optional(),
  evidences: z.array(z.object({
    evidence_type: z.string(), source: z.string().optional(),
    documents: z.array(z.object({ name: z.string().optional() }).passthrough()).optional(),
  }).passthrough()).optional(),
});
export const disputeListSchema = z.object({
  items: z.array(disputeSummarySchema).optional().default([]),
  links: z.array(linkSchema).optional(),
}).passthrough();
export const orderSchema = z.object({
  id: z.string().min(1), status: z.string().min(1),
  purchase_units: z.array(z.object({}).passthrough()).optional(),
  links: z.array(linkSchema).optional(),
}).passthrough();
export const actionResponseSchema = z.object({ links: z.array(linkSchema).optional() }).passthrough();
export const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().positive() }).passthrough();
export const verificationSchema = z.object({ verification_status: z.enum(['SUCCESS', 'FAILURE']) }).passthrough();
export const webhookSchema = z.object({
  id: z.string().optional(), event_type: z.string().min(1),
  resource: z.unknown().optional(),
}).passthrough();
export type Dispute = z.infer<typeof disputeSchema>;
export type DisputeSummary = z.infer<typeof disputeSummarySchema>;
