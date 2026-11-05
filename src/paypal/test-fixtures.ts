import { readFileSync, readdirSync } from 'node:fs';
const directory = new URL('./__fixtures__/trace/', import.meta.url);
export const trace: unknown[] = readdirSync(directory).filter(n => n.endsWith('.json')).sort()
  .map(n => JSON.parse(readFileSync(new URL(n, directory), 'utf8')));
