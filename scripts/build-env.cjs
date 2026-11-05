// Builds use process environment only. In particular, never read the local
// sandbox secret files merely to compile the offline foundation.
const envPath = require.resolve('@next/env');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Node loads this preload as CommonJS.
const nextEnv = require(envPath);
require.cache[envPath].exports = {
  ...nextEnv,
  loadEnvConfig: () => ({ combinedEnv: process.env, parsedEnv: {}, loadedEnvFiles: [] }),
};
