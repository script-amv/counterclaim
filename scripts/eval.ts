import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CaseStore } from '../src/cases/storage';
import { investigate } from '../src/agent/loop';
import { repeatsInstructions } from '../src/guard/case-file';
import { SYSTEM_PROMPT } from '../src/agent/loop';
import { ModelError, OpenRouterProvider } from '../src/agent/provider';
import { scenarioIds, syntheticDispute } from '../src/records';

// Explicitly invoked live-model evaluation only. Synthetic cases; never calls PayPal.
const args = process.argv.slice(2);
const single = args.includes('--scenario') ? args[args.indexOf('--scenario') + 1] : process.env.EVAL_SCENARIO;
if ((args.includes('--scenario') && !single) || (single && !scenarioIds.includes(single as typeof scenarioIds[number]))) throw new Error('Unknown eval scenario');
const capture = args.includes('--capture') || process.env.EVAL_CAPTURE === '1';
const requestDelayMs = Number(process.env.EVAL_REQUEST_DELAY_MS ?? 30000);
if (!Number.isFinite(requestDelayMs) || requestDelayMs < 0 || requestDelayMs > 30000) throw new Error('Invalid eval request delay');
const delayMs = Number(process.env.EVAL_DELAY_MS ?? 5000);
if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 30000) throw new Error('Invalid eval delay');
const outputDir = join('data/eval', new Date().toISOString().replaceAll(':', '-') );
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error('Evaluation requires OPENROUTER_API_KEY in the process environment.');
  process.exitCode = 1;
} else {
  let unsafe = false;
  let trace: unknown[] = [];
  let requested = false;
  const transport = new OpenRouterProvider({ apiKey, onHttpError: (status, kind) => {
    const event = { httpStatus: status, refusalKind: kind };
    if (capture) trace.push(event);
    console.info(JSON.stringify(event));
  } });
  const provider = { model: transport.model, async complete(...args: Parameters<typeof transport.complete>) {
    if (requested) await new Promise(resolve => setTimeout(resolve, requestDelayMs));
    requested = true;
    let reply;
    try { reply = await transport.complete(...args); }
    catch (error) {
      if (capture) trace.push({ messages: structuredClone(args[0]), failureCode: error instanceof ModelError ? error.code : 'transport', ...(error instanceof ModelError ? { httpStatus: error.httpStatus, refusalKind: error.refusalKind } : {}) });
      throw error;
    }
    if (capture) trace.push({ messages: structuredClone(args[0]), reply });
    if (reply.provider !== 'Mistral' || reply.usage?.cost !== 0) unsafe = true;
    return reply;
  } };
  // Prevent a second request if the first response used an unexpected route or omitted free usage proof.
  const safeProvider = { model: provider.model, async complete(...args: Parameters<typeof transport.complete>) {
    if (unsafe) throw new ModelError('provider_refused');
    return provider.complete(...args);
  } };
  const store = new CaseStore(':memory:');
  try {
    for (const [index, scenario] of scenarioIds.filter(id => !single || id === single).entries()) {
      if (index) await new Promise(resolve => setTimeout(resolve, delayMs));
      trace = [];
      const dispute = syntheticDispute(scenario);
      store.save(dispute);
      store.assignScenario(dispute.dispute_id, scenario);
      const { run, version } = await investigate(store, safeProvider, dispute.dispute_id);
      if (capture) {
        await mkdir(outputDir, { recursive: true });
        await writeFile(join(outputDir, `${scenario}.json`), JSON.stringify({ caseFile: version?.caseFile ?? null, trace, run, guard: version?.guard ?? null }, null, 2));
      }
      console.info(JSON.stringify({
        scenario, ...(run.httpStatus ? { httpStatus: run.httpStatus, refusalKind: run.refusalKind } : {}), provider: run.provider ?? null, failureCode: run.failureCode ?? null, guardReasons: version?.guard.reasons ?? [], guardWarnings: version?.guard.warnings ?? [], turns: run.turns ?? 0,
        ...(scenario === 'injection' ? { repeatsInjectedOrPromptText: version ? repeatsInstructions(JSON.stringify(version.caseFile), run.sources, SYSTEM_PROMPT) : null } : {}),
        recommendation: version?.caseFile.recommendation.action ?? null,
        guard: version ? (version.guard.accepted ? 'accepted' : 'rejected') : run.status,
        tokens: run.tokens,
        tokensEstimated: run.tokensEstimated,
        cost: run.cost ?? null,
      }));
      const expected = { 'strong-delivery': 'fight', 'weak-delivery': 'refund', 'low-value': 'offer' } as const;
      if (!version?.guard.accepted || (scenario !== 'injection' && version.caseFile.recommendation.action !== expected[scenario])) process.exitCode = 1;
      if (unsafe || run.failureCode === 'provider_refused') { console.error('Evaluation stopped: unexpected provider/cost or provider allowance/refusal. No route fallback.'); process.exitCode = 1; break; }
    }
  } catch {
    console.error('Evaluation failed; provider details suppressed.');
    process.exitCode = 1;
  } finally {
    store.close();
  }
}
