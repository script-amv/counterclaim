#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock-paypal.mjs';
import { validateBase } from './dispute-spike.mjs';
const root = fileURLToPath(new URL('.', import.meta.url));
await mkdir(new URL('output/', import.meta.url), { recursive: true });
// Small, valid one-page PDF fixture with computed cross-reference offsets.
let pdf = '%PDF-1.4\n'; const offsets = [0];
const stream = 'BT /F1 12 Tf 50 750 Td (MOCK ONLY - proof of delivery fixture) Tj ET';
for (const [i, obj] of [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
].entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`; }
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
await writeFile(new URL('output/delivery.pdf', import.meta.url), pdf);
const { server, base, state } = await startMock(0);
const transcript = [];
const env = { ...process.env, BASE: base, TRACKING_NUMBER: 'MOCK-TRACK-123', CARRIER_NAME: 'FEDEX', TRACKING_CARRIER: 'FEDEX', PAYPAL_CLIENT_ID: 'canary-client-secret', PAYPAL_CLIENT_SECRET: 'canary-password-secret' };
async function cli(args, expected = 0, overrides = {}) {
  const result = await new Promise(resolve => {
    const p = spawn(process.execPath, ['dispute-spike.mjs', ...args], { cwd: root, env: { ...env, ...overrides } });
    let out = ''; p.stdout.on('data', c => out += c); p.stderr.on('data', c => out += c); p.on('close', code => resolve({ code, out }));
  });
  assert.equal(result.code, expected, result.out);
  for (const secret of ['canary-client-secret', 'canary-password-secret', 'mock-token-never-print', 'bW9jay1jbGllbnQ6bW9jay1zZWNyZXQ=']) assert.ok(!result.out.includes(secret));
  transcript.push(`$ node dispute-spike.mjs ${args.join(' ')}\n${result.out}`);
  return result.out;
}
async function browser(action) {
  const r = await fetch(base + '/__mock/' + action, { method: 'POST' }); assert.ok(r.ok);
  transcript.push(`MOCK BROWSER: ${action}: HTTP ${r.status}`);
}
try {
  for (const bad of ['https://api-m.paypal.com', 'https://evil.example', 'http://localhost.evil.example', 'http://127.0.0.1@evil.example', 'http://127.0.0.1/path', 'https://api-m.sandbox.paypal.com.evil.example']) assert.throws(() => validateBase(bad));
  await cli(['token']); await cli(['create-order']);
  await cli(['capture', 'ORDER-MOCK-1'], 1); // Must approve first.
  await browser('approve'); await cli(['capture', 'ORDER-MOCK-1']);
  await cli(['track', 'CAPTURE-MOCK-1']); await cli(['list']);
  await browser('create-dispute'); await cli(['show', 'PP-MOCK-1']);
  await cli(['require-evidence', 'PP-MOCK-1', 'SELLER_EVIDENCE'], 1);
  await browser('escalate');
  state.omitLinks = true;
  await cli(['require-evidence', 'PP-MOCK-1', 'SELLER_EVIDENCE'], 1);
  state.omitLinks = false;
  await cli(['require-evidence', 'PP-MOCK-1', 'SELLER_EVIDENCE']);
  await cli(['adjudicate', 'PP-MOCK-1', 'SELLER_FAVOR'], 1);
  await cli(['evidence', 'PP-MOCK-1', 'output/delivery.pdf']);
  await cli(['show', 'PP-MOCK-1']);
  await cli(['adjudicate', 'PP-MOCK-1', 'SELLER_FAVOR']);
  const final = await cli(['show', 'PP-MOCK-1']);
  assert.match(final, /RESOLVED_SELLER_FAVOUR/);
  assert.ok(state.tracked && state.evidence?.[0].documents.length === 1);
  assert.equal(state.dispute.status, 'RESOLVED');
  await cli(['evidence', 'PP-MOCK-1', 'output/delivery.pdf'], 1);
  await cli(['token'], 1, { BASE: 'https://api-m.paypal.com' });
  transcript.push('PASS: all subcommands, browser stand-ins, multipart proof + tracking, seller win, state guards, host guards, secret-output checks. Local mock only; no PayPal API calls.');
  await writeFile(new URL('output/mock-run.txt', import.meta.url), transcript.join('\n\n') + '\n');
  console.log(transcript.join('\n\n'));
} finally { await new Promise(resolve => server.close(resolve)); }
