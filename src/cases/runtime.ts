import { PayPalClient } from '../paypal';
import { CaseStore } from './storage';
import { CaseSync } from './sync';
import { seedDemo } from './demo';
import { isReplayOnly } from './replay-only';

// Lazy initialization keeps builds, health, and unauthorized requests credential-free.
const runtime = globalThis as typeof globalThis & {
  counterclaimStore?: CaseStore;
  counterclaimPayPal?: PayPalClient;
  counterclaimSync?: CaseSync;
};
function createStore() {
  if (!isReplayOnly()) return new CaseStore();

  const store = new CaseStore(':memory:');
  try {
    seedDemo(store);
    return store;
  } catch (error) {
    store.close();
    throw error;
  }
}

export function getStore() { return runtime.counterclaimStore ??= createStore(); }
export function getPayPal() {
  return runtime.counterclaimPayPal ??= new PayPalClient({
    clientId: process.env.PAYPAL_CLIENT_ID ?? '', clientSecret: process.env.PAYPAL_CLIENT_SECRET ?? '',
  });
}
export function getSync() { return runtime.counterclaimSync ??= new CaseSync(getStore(), getPayPal()); }
