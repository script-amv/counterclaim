import type { Dispute } from '../paypal/schemas';

/** Links are the authority. Status is deliberately irrelevant to permissions. */
export function deriveActions(dispute: Dispute): string[] {
  return [...new Set((dispute.links ?? []).map(l => l.rel.replaceAll('_', '-')))]
    .filter(rel => rel !== 'self');
}

export function deriveView(dispute: Dispute) {
  const turn = dispute.status === 'RESOLVED' ? 'none'
    : dispute.status === 'WAITING_FOR_SELLER_RESPONSE' ? 'seller'
    : dispute.status === 'WAITING_FOR_BUYER_RESPONSE' ? 'buyer'
    : ['UNDER_REVIEW', 'OPEN'].includes(dispute.status) ? 'paypal' : 'unknown';
  return {
    stage: dispute.dispute_life_cycle_stage ?? 'UNKNOWN', turn,
    deadline: turn === 'seller' ? dispute.seller_response_due_date ?? null
      : turn === 'buyer' ? dispute.buyer_response_due_date ?? null : null,
    outcome: dispute.status === 'RESOLVED' ? dispute.dispute_outcome?.outcome_code ?? null : null,
  };
}
