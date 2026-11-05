// Test server safety boundary. Never load dotenv; never call a remote provider.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS Node preload.
require('./build-env.cjs');
const original = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Offline UI verification: remote fetch blocked');
  return original(input, init);
};
