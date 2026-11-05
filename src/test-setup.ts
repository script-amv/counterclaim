import { vi } from 'vitest';
// No test can accidentally contact PayPal, AI, or any other external service.
vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External network is disabled in tests'); }));
