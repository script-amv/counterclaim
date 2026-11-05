#!/usr/bin/env node
// Throwaway feasibility spike. No external dependencies. No token persistence.
import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SANDBOX = 'https://api-m.sandbox.paypal.com';
const SELLER_SCOPE = 'https://uri.paypal.com/services/disputes/update-seller';
const envFile = new URL('.env', import.meta.url);
try {
  for (const line of (await readFile(envFile, 'utf8')).split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
} catch (e) { if (e.code !== 'ENOENT') throw new Error('Cannot read spike/.env'); }

export function validateBase(raw = SANDBOX) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('Invalid BASE'); }
  if (u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new Error('BASE must be an origin');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.origin !== SANDBOX && !(local && u.protocol === 'http:')) throw new Error('Only PayPal sandbox or HTTP localhost BASE allowed');
  return { base: u.origin, local };
}

export async function main(args = process.argv.slice(2)) {
  const { base, local } = validateBase(process.env.BASE);
  const [cmd, id, arg, ...extra] = args;
  const arity = { token: 0, 'create-order': 0, capture: 1, track: 1, list: 0, show: 1, 'require-evidence': 2, evidence: 2, adjudicate: 2 };
  if (!(cmd in arity) || args.length !== arity[cmd] + 1 || extra.length) throw new Error('Usage: token | create-order | capture <orderId> | track <txn> | list | show <id> | require-evidence <id> SELLER_EVIDENCE | evidence <id> <file> | adjudicate <id> SELLER_FAVOR');
  if (id && cmd !== 'token' && !/^[A-Za-z0-9-]+$/.test(id)) throw new Error('Invalid ID');
  if (cmd === 'require-evidence' && arg !== 'SELLER_EVIDENCE') throw new Error('Expected SELLER_EVIDENCE');
  if (cmd === 'adjudicate' && arg !== 'SELLER_FAVOR') throw new Error('Expected SELLER_FAVOR');
  const client = local ? 'mock-client' : process.env.PAYPAL_CLIENT_ID;
  const secret = local ? 'mock-secret' : process.env.PAYPAL_CLIENT_SECRET;
  if (!client || !secret) throw new Error('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in spike/.env');
  let token;
  const redact = s => {
    let out = String(s);
    for (const value of [process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET, client, secret, token, Buffer.from(`${client}:${secret}`).toString('base64')]) {
      if (value) out = out.split(value).join('[REDACTED]');
    }
    return out.slice(0, 500);
  };
  const summarize = d => {
    if (!d || typeof d !== 'object') return {};
    const out = {};
    for (const k of ['id', 'dispute_id', 'status', 'dispute_state', 'dispute_life_cycle_stage', 'reason', 'name']) {
      if (typeof d[k] === 'string') out[k] = redact(d[k]);
    }
    if (d.dispute_outcome) out.dispute_outcome = { outcome_code: redact(d.dispute_outcome.outcome_code ?? '') };
    out.links = (d.links ?? []).slice(0, 30).map(l => redact(l.rel));
    if (d.details) out.issues = d.details.slice(0, 10).map(x => redact(x.issue ?? ''));
    if (d.tracker_identifiers) out.tracker_identifiers = d.tracker_identifiers.map(t => ({ transaction_id: redact(t.transaction_id ?? ''), links: (t.links ?? []).map(l => redact(l.rel)) }));
    if (d.errors) out.errors = d.errors.slice(0, 10).map(summarize);
    if (d.items) out.items = d.items.slice(0, 50).map(summarize);
    if (d.purchase_units) out.captures = d.purchase_units.flatMap(u => u.payments?.captures ?? []).map(summarize);
    if (d.evidences) out.evidences = d.evidences.slice(0, 20).map(e => ({ evidence_type: redact(e.evidence_type ?? ''), source: redact(e.source ?? ''), documents: (e.documents ?? []).length }));
    return out;
  };
  async function request(path, { method = 'GET', body, oauth = false } = {}) {
    const url = new URL(path, base);
    if (url.origin !== base) throw new Error('Refusing cross-origin request');
    const headers = { Accept: 'application/json', Prefer: 'return=representation' };
    if (oauth) headers.Authorization = `Basic ${Buffer.from(`${client}:${secret}`).toString('base64')}`;
    else headers.Authorization = `Bearer ${token}`;
    if (body && !(body instanceof FormData) && !(body instanceof URLSearchParams)) {
      headers['Content-Type'] = 'application/json'; body = JSON.stringify(body);
    }
    let res;
    try { res = await fetch(url, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(30000) }); }
    catch { throw new Error('Network request failed (details suppressed)'); }
    let data = {};
    try { data = await res.json(); } catch { /* Never emit raw bodies. */ }
    if (oauth && typeof data.access_token === 'string') token = data.access_token;
    const report = { http_status: res.status, debug_id: redact(res.headers.get('paypal-debug-id') ?? data.debug_id ?? '') || null, ...summarize(data) };
    if (oauth) report.scopes = String(data.scope ?? '').split(/\s+/).filter(Boolean).map(redact);
    console.log(JSON.stringify(report));
    if (data.errors?.length) throw new Error(`HTTP ${res.status}; tracking response contains errors`);
    if (!res.ok) throw new Error(`HTTP ${res.status}; see trimmed diagnostic above`);
    return data;
  }
  const auth = await request('/v1/oauth2/token', { method: 'POST', oauth: true, body: new URLSearchParams({ grant_type: 'client_credentials' }) });
  if (!token) throw new Error('OAuth response missing access token');
  if (cmd === 'token') return;
  if (['require-evidence', 'evidence', 'adjudicate'].includes(cmd) && !String(auth.scope ?? '').split(/\s+/).includes(SELLER_SCOPE)) throw new Error('OAuth token lacks disputes/update-seller scope');
  const disputePath = `/v1/customer/disputes/${id}`;
  async function allowed(action, status) {
    const d = await request(disputePath);
    const link = (d.links ?? []).find(l => l.rel?.replaceAll('_', '-') === action && l.method === 'POST');
    if (d.status !== status || !link) throw new Error(`Action ${action} requires ${status} and current POST HATEOAS link`);
    // PayPal sometimes advertises api.sandbox.paypal.com. Do not follow it: use
    // the documented path on the fixed api-m sandbox origin after checking rel.
    let u;
    try { u = new URL(link.href, base); } catch { throw new Error('Invalid action link'); }
    if (u.pathname !== `${disputePath}/${action}` || u.search || u.hash || u.username || u.password ||
        !(u.origin === base || (!local && u.origin === 'https://api.sandbox.paypal.com'))) throw new Error('Unexpected action link');
    return d;
  }
  const tracking = () => {
    const tracking_number = process.env.TRACKING_NUMBER;
    const carrier_name = process.env.CARRIER_NAME;
    if (!tracking_number || !carrier_name) throw new Error('Set TRACKING_NUMBER and CARRIER_NAME; see RUNBOOK (tracking API and dispute enums differ)');
    return { tracking_number, carrier_name };
  };
  switch (cmd) {
    case 'create-order': {
      const d = await request('/v2/checkout/orders', { method: 'POST', body: { intent: 'CAPTURE', purchase_units: [{ amount: { currency_code: 'USD', value: '10.00' }, description: 'Sandbox dispute feasibility spike' }] } });
      const link = d.links?.find(l => l.rel === 'approve');
      if (!link) throw new Error('No approve link');
      const u = new URL(link.href);
      if ((!local && (u.origin !== 'https://www.sandbox.paypal.com' && u.origin !== 'https://sandbox.paypal.com')) || (local && u.origin !== base) || u.username || u.password) throw new Error('Unexpected approval URL');
      console.log(JSON.stringify({ approve: redact(u.href) })); break;
    }
    case 'capture': await request(`/v2/checkout/orders/${id}/capture`, { method: 'POST', body: {} }); break;
    case 'track': {
      const t = tracking();
      await request('/v1/shipping/trackers', { method: 'POST', body: { trackers: [{ transaction_id: id, tracking_number: t.tracking_number, carrier: process.env.TRACKING_CARRIER ?? t.carrier_name, status: 'SHIPPED' }] } }); break;
    }
    case 'list': {
      const start = process.env.START_TIME ?? new Date(Date.now() - 7 * 86400000).toISOString();
      await request(`/v1/customer/disputes?start_time=${encodeURIComponent(start)}&page_size=50`); break;
    }
    case 'show': await request(disputePath); break;
    case 'require-evidence':
      await allowed('require-evidence', 'UNDER_REVIEW');
      await request(`${disputePath}/require-evidence`, { method: 'POST', body: { action: arg } }); break;
    case 'adjudicate':
      await allowed('adjudicate', 'UNDER_REVIEW');
      await request(`${disputePath}/adjudicate`, { method: 'POST', body: { adjudication_outcome: arg } }); break;
    case 'evidence': {
      const types = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif' };
      const type = types[extname(arg).toLowerCase()];
      const info = await stat(arg);
      if (!type || !info.isFile() || info.size === 0 || info.size >= 10_000_000) throw new Error('Evidence must be JPG/JPEG/GIF/PNG/PDF, nonempty and less than 10 MB');
      const name = basename(arg);
      if (!/^[A-Za-z0-9-_,\s]+\.[A-Za-z]+$/.test(name)) throw new Error('Use a simple evidence filename');
      const t = tracking();
      const d = await allowed('provide-evidence', 'WAITING_FOR_SELLER_RESPONSE');
      if (!['MERCHANDISE_OR_SERVICE_NOT_RECEIVED', 'UNAUTHORISED'].includes(d.reason)) throw new Error('This spike only submits proof of fulfillment for INR/unauthorized disputes');
      const requested = d.evidences?.filter(e => e.source === 'REQUESTED_FROM_SELLER') ?? [];
      if (requested.length && !requested.some(e => e.evidence_type === 'PROOF_OF_FULFILLMENT')) throw new Error('Requested evidence does not include PROOF_OF_FULFILLMENT');
      const form = new FormData();
      form.append('input', new Blob([JSON.stringify({ evidences: [{ evidence_type: 'PROOF_OF_FULFILLMENT', evidence_info: { tracking_info: [t] }, documents: [{ name }], notes: 'Sandbox proof of delivery; see attached document and carrier tracking.' }] })], { type: 'application/json' }), 'input.json');
      form.append('evidence-file', new Blob([await readFile(arg)], { type }), name);
      await request(`${disputePath}/provide-evidence`, { method: 'POST', body: form }); break;
    }
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(e => {
  // Do not log fetch errors, headers, request bodies, or arbitrary server text.
  const safe = /^(Usage:|Invalid ID|Invalid BASE|BASE must|Only PayPal|Expected |Set |OAuth |HTTP \d|Action |Unexpected |Invalid action|No approve|Network request|Evidence must|Use a simple|This spike|Requested evidence)/;
  console.error(safe.test(e.message) ? e.message : 'Command failed (details suppressed)'); process.exitCode = 1;
});
