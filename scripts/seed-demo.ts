/** Offline only. Uses sanitized recorded model fixtures and the real guard. */
import { CaseStore } from '../src/cases/storage';
import { seedDemo } from '../src/cases/demo';
const store = new CaseStore();
try { seedDemo(store); } finally { store.close(); }
console.log('Offline demo ready: four Recorded model runs and one recorded sandbox timeline. No test states or network calls.');
