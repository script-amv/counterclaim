import type { CaseDetailResponse, CaseQueueRow } from '../api/contract';

export function sandboxLabel(replay: boolean | null) {
  return replay === false ? 'Real PayPal sandbox dispute. Demo seller records.'
    : replay === true ? 'Demo seller data. Nothing here is a live customer dispute.'
      : 'PayPal sandbox. Demo seller data.';
}

export function compareQueueDeadlines(a?: CaseQueueRow, b?: CaseQueueRow) {
  return Number(a?.status === 'RESOLVED') - Number(b?.status === 'RESOLVED')
    || (a?.deadline ?? '9999').localeCompare(b?.deadline ?? '9999');
}

export function caseNextStep(data: CaseDetailResponse) {
  const resolved = data.dispute.status === 'RESOLVED';
  if (!resolved && data.case.nextActions.length) return {
    heading: 'Your next step', message: 'Read the proof and the gaps. Then review the exact response.', actionable: true,
  };
  const sent = data.attempts.findLast(a => a.status === 'submitted');
  const uncertain = data.attempts.some(a => ['unknown', 'submitting'].includes(a.status));
  const sentAt = sent && new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'UTC',
  }).format(new Date(sent.endedAt ?? sent.startedAt));
  const description = sent ? `${({ 'provide-evidence': 'Evidence response', 'make-offer': 'Refund offer', 'accept-claim': 'Claim acceptance' })[sent.action]} sent to PayPal on ${sentAt} UTC.`
    : uncertain ? 'A response attempt is recorded without confirmation from PayPal.'
      : 'No response sent through Counterclaim is recorded.';
  return {
    heading: resolved ? 'Case closed' : 'No response due',
    message: `${description} ${resolved ? 'No response is due.' : 'No response is due in the saved PayPal state.'}`,
    actionable: false,
  };
}
