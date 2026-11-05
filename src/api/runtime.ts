import { getStore, getPayPal } from '../cases/runtime';
import { CaseService } from './service';
import { OpenRouterProvider } from '../agent/provider';
export function getCaseService() {
  return new CaseService(getStore(), {
    getDispute: id => getPayPal().getDispute(id),
    provideEvidence: (id, input, file) => getPayPal().provideEvidence(id, input, file),
    makeOffer: (id, input) => getPayPal().makeOffer(id, input),
    acceptClaim: (id, input) => getPayPal().acceptClaim(id, input),
  });
}
export function getModel() { return new OpenRouterProvider({ apiKey: process.env.OPENROUTER_API_KEY ?? '' }); }
