#!/usr/bin/env node
// Deliberately simplified model, NOT evidence of PayPal's sandbox behavior.
import http from 'node:http';
import { fileURLToPath } from 'node:url';
export async function startMock(port = 8787) {
  const state = { order: null, captured: false, tracked: false, dispute: null, evidence: null };
  let base;
  const scope = ['https://uri.paypal.com/services/disputes/update-seller', 'https://uri.paypal.com/services/disputes/read-seller', 'https://uri.paypal.com/services/shipping/trackers/readwrite'].join(' ');
  const link = (rel, path, method = 'POST') => ({ rel, method, href: base + path });
  const dp = '/v1/customer/disputes/PP-MOCK-1';
  function detail() {
    const d = state.dispute;
    const links = [link('self', dp, 'GET')];
    if (d.status === 'UNDER_REVIEW') links.push(link('require-evidence', dp + '/require-evidence'), link('adjudicate', dp + '/adjudicate'));
    if (d.status === 'WAITING_FOR_SELLER_RESPONSE') links.push(link('provide_evidence', dp + '/provide-evidence'));
    return { ...d, dispute_state: ({ RESOLVED: 'RESOLVED', OPEN: 'OPEN_INQUIRIES', UNDER_REVIEW: 'UNDER_PAYPAL_REVIEW' })[d.status] ?? 'REQUIRED_ACTION', evidences: state.evidence ?? [{ evidence_type: 'PROOF_OF_FULFILLMENT', source: 'REQUESTED_FROM_SELLER' }], links: state.omitLinks ? [] : links };
  }
  const server = http.createServer(async (req, res) => {
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'PayPal-Debug-Id': 'mock-debug-id' }); res.end(JSON.stringify(data)); };
    const fail = issue => send(422, { name: 'VALIDATION_ERROR', debug_id: 'mock-debug-id', details: [{ issue }] });
    try {
      const u = new URL(req.url, base); const path = u.pathname; const method = req.method;
      const chunks = []; for await (const c of req) { chunks.push(c); if (chunks.reduce((n, b) => n + b.length, 0) > 11000000) throw new Error('too big'); }
      const raw = Buffer.concat(chunks);
      const json = () => JSON.parse(raw.toString() || '{}');
      if (path === '/v1/oauth2/token' && method === 'POST') {
        if (req.headers.authorization !== `Basic ${Buffer.from('mock-client:mock-secret').toString('base64')}` || new URLSearchParams(raw.toString()).get('grant_type') !== 'client_credentials') return send(401, {});
        return send(200, { access_token: 'mock-token-never-print', token_type: 'Bearer', scope });
      }
      // Local stand-ins for browser approval, case creation and claim escalation.
      if (path.startsWith('/__mock/') && method === 'POST') {
        if (path === '/__mock/approve' && state.order) { state.order = 'APPROVED'; return send(200, { status: 'APPROVED' }); }
        if (path === '/__mock/create-dispute' && state.captured) {
          state.dispute = { dispute_id: 'PP-MOCK-1', status: 'OPEN', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', dispute_life_cycle_stage: 'INQUIRY' };
          return send(201, detail());
        }
        if (path === '/__mock/escalate' && state.dispute?.status === 'OPEN') {
          state.dispute.status = 'UNDER_REVIEW'; state.dispute.dispute_life_cycle_stage = 'CHARGEBACK'; return send(200, detail());
        }
        return fail('MOCK_BROWSER_STEP_NOT_ALLOWED');
      }
      if (req.headers.authorization !== 'Bearer mock-token-never-print') return send(401, { name: 'AUTHENTICATION_FAILURE' });
      if (path === '/v2/checkout/orders' && method === 'POST') {
        if (json().intent !== 'CAPTURE') return fail('INVALID_INTENT');
        state.order = 'CREATED'; return send(201, { id: 'ORDER-MOCK-1', status: state.order, links: [link('approve', '/__mock/approve', 'GET')] });
      }
      if (path === '/v2/checkout/orders/ORDER-MOCK-1/capture' && method === 'POST') {
        if (state.order !== 'APPROVED') return fail('ORDER_NOT_APPROVED');
        state.captured = true; return send(201, { id: 'ORDER-MOCK-1', status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CAPTURE-MOCK-1', status: 'COMPLETED' }] } }] });
      }
      if (path === '/v1/shipping/trackers' && method === 'POST') {
        const t = json().trackers?.[0];
        if (!state.captured || t?.transaction_id !== 'CAPTURE-MOCK-1' || !t.tracking_number || !t.carrier || t.status !== 'SHIPPED') return fail('INVALID_TRACKING');
        state.tracked = true; return send(200, { tracker_identifiers: [{ transaction_id: t.transaction_id, tracking_number: t.tracking_number, links: [link('self', '/v1/shipping/trackers/MOCK-TRACKER', 'GET')] }], links: [] });
      }
      if (path === '/v1/customer/disputes' && method === 'GET') return send(200, { items: state.dispute ? [detail()] : [], links: [] });
      if (!state.dispute || !path.startsWith(dp)) return send(404, { name: 'RESOURCE_NOT_FOUND' });
      if (path === dp && method === 'GET') return send(200, detail());
      if (method !== 'POST') return send(405, {});
      if (path === dp + '/require-evidence') {
        if (state.dispute.status !== 'UNDER_REVIEW' || json().action !== 'SELLER_EVIDENCE') return fail('ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE');
        state.dispute.status = 'WAITING_FOR_SELLER_RESPONSE'; return send(200, { links: [link('self', dp, 'GET')] });
      }
      if (path === dp + '/provide-evidence') {
        if (state.dispute.status !== 'WAITING_FOR_SELLER_RESPONSE') return fail('ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE');
        const form = await new Request(base, { method: 'POST', headers: { 'Content-Type': req.headers['content-type'] }, body: raw }).formData();
        const input = form.get('input'); const file = form.get('evidence-file');
        if (input?.type !== 'application/json' || !file?.size || file.size >= 10000000 || !['application/pdf', 'image/jpeg', 'image/gif', 'image/png'].includes(file.type)) return fail('INVALID_MULTIPART');
        const e = JSON.parse(await input.text()).evidences?.[0];
        const tracking = e?.evidence_info?.tracking_info?.[0];
        if (e?.evidence_type !== 'PROOF_OF_FULFILLMENT' || !tracking?.tracking_number || !tracking?.carrier_name || e.documents?.[0]?.name !== file.name) return fail('INVALID_EVIDENCE');
        state.evidence = [{ ...e, source: 'SUBMITTED_BY_SELLER' }]; state.dispute.status = 'UNDER_REVIEW';
        return send(200, { links: [link('self', dp, 'GET')] });
      }
      if (path === dp + '/adjudicate') {
        if (state.dispute.status !== 'UNDER_REVIEW' || json().adjudication_outcome !== 'SELLER_FAVOR' || !state.evidence) return fail('ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE');
        state.dispute.status = 'RESOLVED'; state.dispute.dispute_outcome = { outcome_code: 'RESOLVED_SELLER_FAVOUR' };
        return send(200, { links: [link('self', dp, 'GET')] });
      }
      send(404, {});
    } catch { send(400, { name: 'BAD_REQUEST' }); }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  return { server, base, state };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { base } = await startMock(Number(process.env.PORT ?? 8787));
  console.log(`Mock listening at ${base}; browser stand-ins are POST /__mock/approve, /__mock/create-dispute, /__mock/escalate`);
}
