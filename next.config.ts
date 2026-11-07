import type { NextConfig } from 'next';

const config: NextConfig = {
  outputFileTracingIncludes: {
    '/api/**': [
      './src/records/recorded-runs/*.json',
      './src/paypal/__fixtures__/trace/*.json',
    ],
  },
};

export default config;
