import { PayPalClient } from '../paypal';
import { CaseStore } from './storage';
import { CaseSync } from './sync';

// Lazy initialization keeps builds, health, and unauthorized requests credential-free.
const runtime = globalThis as typeof globalThis & {
  counterclaimStore?: CaseStore;
  counterclaimPayPal?: PayPalClient;
  counterclaimSync?: CaseSync;
};
export function getStore() { return runtime.counterclaimStore ??= new CaseStore(); }
export function getPayPal() {
  return runtime.counterclaimPayPal ??= new PayPalClient({
    clientId: process.env.PAYPAL_CLIENT_ID ?? '', clientSecret: process.env.PAYPAL_CLIENT_SECRET ?? '',
  });
}
export function getSync() { return runtime.counterclaimSync ??= new CaseSync(getStore(), getPayPal()); }
