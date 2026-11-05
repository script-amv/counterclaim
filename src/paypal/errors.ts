import { PayPalError } from './client';
import { sanitizePayPalError } from './error-details';
export { submissionFailureReason } from './error-details';
export function safePayPalError(error: unknown, forbidden: string[] = []) {
  return error instanceof PayPalError ? sanitizePayPalError(error.status, error.safeDetails, error.debug_id, forbidden) : undefined;
}
