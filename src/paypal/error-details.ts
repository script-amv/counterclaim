/** Error bodies are untrusted: allow known diagnostic prose, never arbitrary echoed text. */
export interface SafePayPalError {
  status: number; name: string; message?: string; debug_id?: string;
  details: Array<{ issue?: string; field?: string; description?: string }>;
}
const diagnosticText = new Set([
  'The requested action could not be performed.',
  'The requested action could not be performed, semantically incorrect, or failed business validation.',
  'Request is not well-formed, syntactically incorrect, or violates schema.',
  'The request was not well-formed, syntactically incorrect, or violated schema.',
  'The tracking number and carrier name are missing.',
  'The evidence information is missing.', 'The evidence type is missing.',
  'The evidence file is not valid.', 'This evidence type is not valid for this dispute reason and status.',
  'The value of a field does not conform to the expected format.',
  'The value of a field is either too short or too long.',
  'The value of a field is invalid.', 'A required field / parameter is missing.',
  'The requested action is not allowed in the current dispute state.',
  'You do not have permission to access or perform operations on this resource.',
  'You do not have the correct permission for the requested operation.',
  'Authentication failed due to invalid authentication credentials or a missing Authorization header.',
  'An internal server error has occurred.', 'Resource not found.',
]);
const code = (v: unknown) => typeof v === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(v) ? v : undefined;
const prose = (v: unknown, forbidden: string[]) => typeof v === 'string'
  ? diagnosticText.has(v) && !forbidden.some(s => s && v.toLowerCase().includes(s.toLowerCase())) ? v : '[redacted]'
  : undefined;
const fieldKeys = new Set(['input', 'evidences', 'evidence_type', 'evidence_info', 'tracking_info', 'carrier_name', 'carrier_name_other', 'tracking_number', 'documents', 'name', 'notes', 'note', 'refund_ids', 'item_id', 'offer_type', 'offer_amount', 'currency_code', 'value']);
export function sanitizePayPalError(status: number, raw: unknown, debugId?: string, forbidden: string[] = []): SafePayPalError {
  const data = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const debug = debugId ?? data.debug_id;
  return { status, name: code(data.name) ?? 'PAYPAL_ERROR', message: prose(data.message, forbidden),
    debug_id: typeof debug === 'string' && /^[a-zA-Z0-9-]{1,128}$/.test(debug) && !forbidden.includes(debug) ? debug : undefined,
    details: (Array.isArray(data.details) ? data.details : []).slice(0, 100).map(d => {
      const detail = d && typeof d === 'object' ? d as Record<string, unknown> : {};
      const field = typeof detail.field === 'string' && detail.field.length <= 512
        && detail.field.replace(/^\//, '').split('/').every(k => fieldKeys.has(k) || /^\d{1,3}$/.test(k)) ? detail.field : undefined;
      return { issue: code(detail.issue), field, description: prose(detail.description, forbidden) };
    }),
  };
}
export function submissionFailureReason(error?: SafePayPalError): string {
  const codes = [error?.name, ...(error?.details.map(d => d.issue) ?? [])].join(' ');
  if (/MISSING_TRACKING|MISSING_EVIDENCE_INFO/.test(codes)) return 'Add the carrier name and tracking number, then review and approve the evidence again.';
  if (/ACTION_NOT_ALLOWED/.test(codes)) return 'PayPal no longer allows this action. Refresh the case and review its available actions.';
  if (/EVIDENCE_TYPE/.test(codes)) return 'Review the evidence type PayPal requested for this case, then approve a corrected packet.';
  if (/INVALID_EVIDENCE_FILE/.test(codes)) return 'Check that the attachment is a supported file smaller than 10 MB.';
  if (/PERMISSION|AUTHENTICATION/.test(codes) || error?.status === 401 || error?.status === 403) return 'Check the seller account credentials and dispute permissions.';
  if (error?.details.some(d => d.field?.endsWith('/notes'))) return 'Check the seller note: PayPal allows 1 to 2,000 characters.';
  return error ? `PayPal returned HTTP ${error.status}. Review the error code and requested evidence before retrying.` : 'No safe PayPal error details were received. Check the case in PayPal before retrying.';
}
