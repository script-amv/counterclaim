import { CaseStore } from '../src/cases/storage';
import { scenarioIds, type ScenarioId } from '../src/records';

const [disputeId, scenarioId, ...extra] = process.argv.slice(2);
if (!disputeId || !/^[A-Za-z0-9-]{1,255}$/.test(disputeId)
  || !scenarioIds.includes(scenarioId as ScenarioId) || extra.length) {
  console.error(`Usage: npm run assign-scenario -- <disputeId> <${scenarioIds.join('|')}>`);
  process.exitCode = 1;
} else {
  const store = new CaseStore();
  try {
    store.assignScenario(disputeId, scenarioId as ScenarioId);
    console.info('Sandbox demo scenario assigned.');
  } catch {
    console.error('Scenario assignment failed; ensure the dispute is stored locally.');
    process.exitCode = 1;
  } finally {
    store.close();
  }
}
