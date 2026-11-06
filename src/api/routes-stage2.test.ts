import { detailView } from './views';
import { decodedPacketText } from '../evidence/test-text';
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { CaseStore } from '../cases/storage';
import { CaseService } from './service';
import { scenarios, syntheticDispute } from '../records';
import { scripted, draft } from '../agent/test-fixtures';
import { investigate } from '../agent/loop';
const runtime = vi.hoisted(() => ({ store: undefined as unknown as CaseStore, service: undefined as unknown as CaseService, model: vi.fn() }));
vi.mock('../cases/runtime', () => ({ getStore: () => runtime.store }));
vi.mock('./runtime', () => ({ getCaseService: () => runtime.service, getModel: () => runtime.model() }));
import { GET as queue } from '../app/api/cases/route';
import { GET as detail } from '../app/api/cases/[id]/route';
import { POST as run } from '../app/api/cases/[id]/investigate/route';
import { PUT as edit } from '../app/api/cases/[id]/case-file/route';
import { POST as approve } from '../app/api/cases/[id]/approve/route';
import { POST as submit } from '../app/api/cases/[id]/submit/route';
import { GET as pdf } from '../app/api/cases/[id]/evidence.pdf/route';
const d = { ...syntheticDispute('strong-delivery'), disputed_transactions: [{ buyer: { email: 'buyer-sensitive@example.invalid', name: 'Buyer Sensitive Name' } }] };
const context = () => ({ params: Promise.resolve({ id: d.dispute_id }) });
const request = (method = 'POST', payload: unknown = {}, code = 'test-code', ip = '192.0.2.1') => new Request('http://localhost/api/cases/test', { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${code}`, 'x-forwarded-for': ip }, ...(method === 'GET' ? {} : { body: JSON.stringify(payload) }) });
beforeEach(() => {
  runtime.store = new CaseStore(':memory:'); runtime.store.save(d); runtime.store.assignScenario(d.dispute_id, 'strong-delivery');
  runtime.service = new CaseService(runtime.store, { getDispute: vi.fn(async () => d), provideEvidence: vi.fn(async () => ({})), makeOffer: vi.fn(async () => ({})), acceptClaim: vi.fn(async () => ({})) });
  runtime.model.mockReset().mockImplementation(() => scripted('strong-delivery')); vi.stubEnv('OPERATOR_CODE', 'test-code');
});
afterEach(() => { runtime.store.close(); vi.unstubAllEnvs(); });
it.each(['Gift for buyer@example.invalid', 'Gift for Buyer Sensitive Name'])('filters private queue titles independently of derived records: %s', item => {
  const order = scenarios['strong-delivery'].find(r => r.type === 'order')!;
  const original = order.content.item;
  // Offline records bypass live derivation, so the public boundary must check them itself.
  order.content.item = item;
  return queue().then(async response => {
    const output = await response.json();
    expect(output.cases[0].title).toBe('Sandbox order item · Order STR-DEL');
    expect(JSON.stringify(output)).not.toContain(item);
  }).finally(() => { order.content.item = original; });
});
it('all public read responses and mutation responses omit buyer identity', async () => {
  const investigated = await run(request(), context()); expect(investigated.status).toBe(200); const data = await investigated.json();
  const edited = await edit(request('PUT', { caseFile: draft('strong-delivery'), baseVersionId: runtime.service.latest(d.dispute_id).id }), context()); expect(edited.status).toBe(200); const v = await edited.json();
  const approved = await approve(request('POST', { versionId: v.version.id, snapshotFingerprint: detailView(runtime.store, d.dispute_id).snapshotFingerprint }), context()); expect(approved.status).toBe(200); const a = await approved.json();
  const sent = await submit(request('POST', { approvalId: a.approval.id }), context()); expect(sent.status).toBe(200);
  const responses = [data, v, a, await (await queue()).json(), await (await detail(request('GET'), context())).json(), await sent.json()];
  const text = JSON.stringify(responses); expect(text).not.toContain('buyer-sensitive'); expect(text).not.toContain('Buyer Sensitive Name'); expect(text).not.toContain('pdfBase64'); expect(text).not.toContain('test-code');
  const preview = await pdf(request('GET'), context()); expect(preview.headers.get('content-type')).toBe('application/pdf'); const decoded = await decodedPacketText(new Uint8Array(await preview.arrayBuffer()));
  expect(decoded).toContain('SANDBOX DEMO DATA'); expect(decoded).toContain('Sandbox demo seller note');
  expect(decoded).not.toContain('buyer-sensitive'); expect(decoded).not.toContain('Buyer Sensitive Name');
});
it.each([run, edit, approve, submit])('fails closed before any mutation or model call', async handler => {
  vi.stubEnv('OPERATOR_CODE', ''); expect((await handler(request(), context())).status).toBe(503);
  vi.stubEnv('OPERATOR_CODE', 'test-code'); expect((await handler(request('POST', {}, 'wrong'), context())).status).toBe(401); expect(runtime.model).not.toHaveBeenCalled(); expect(runtime.store.runs(d.dispute_id)).toEqual([]);
});
it('limits investigations per nearest proxy IP across requests', async () => {
  for (let i = 0; i < 4; i++) expect((await run(request(), context())).status).toBe(200);
  expect((await run(request(), context())).status).toBe(429); expect(runtime.model).toHaveBeenCalledTimes(4);
  expect((await run(request('POST', {}, 'test-code', '192.0.2.2'), context())).status).toBe(200);
});
it('returns new state when submission is refused', async () => {
  const { version } = await investigate(runtime.store, scripted('strong-delivery'), d.dispute_id);
  const a = await runtime.service.approve(d.dispute_id, version!.id, runtime.store.snapshotFingerprint(d.dispute_id)); runtime.service.edit(d.dispute_id, draft('strong-delivery'), runtime.service.latest(d.dispute_id).id);
  const result = await submit(request('POST', { approvalId: a.id }), context()); expect(result.status).toBe(409); expect((await result.json()).case.caseFileVersions).toHaveLength(2);
});
it('does not return private seller edits, including rejected versions', async () => {
  await investigate(runtime.store, scripted('strong-delivery'), d.dispute_id);
  const file = draft('strong-delivery'); file.summary = 'Buyer Sensitive Name';
  const response = await edit(request('PUT', { caseFile: file, baseVersionId: runtime.service.latest(d.dispute_id).id }), context()); const output = await response.json(); expect(output.version.guard.accepted).toBe(false); expect(output.version.caseFile).toBeNull();
  expect(await (await detail(request('GET'), context())).text()).not.toContain('Buyer Sensitive Name');
});
it('returns safe validation errors and missing cases', async () => {
  expect((await run(request('POST', { extra: true }), context())).status).toBe(400);
  expect((await detail(request('GET'), { params: Promise.resolve({ id: 'MISSING' }) })).status).toBe(404);
  expect((await pdf(request('GET'), context())).status).toBe(409);
});
it('persists rate limit counts even for the same millisecond', () => {
  expect([1,2,3,4,5].map(() => runtime.store.takeInvestigationSlot('hashed-ip', 1000))).toEqual([true,true,true,true,false]);
});
it('rejects historical names and short buyer names in seller edits', async () => {
  runtime.store.save({ ...d, buyer: { name: 'Li' } });
  runtime.store.save({ ...d, disputed_transactions: [], buyer: {} });
  await investigate(runtime.store, scripted('strong-delivery'), d.dispute_id);
  for (const name of ['Buyer Sensitive Name', 'Li']) {
    const file = draft('strong-delivery'); file.summary = name;
    const response = await edit(request('PUT', { caseFile: file, baseVersionId: runtime.service.latest(d.dispute_id).id }), context()); const output = await response.json();
    expect(output.version.guard.accepted).toBe(false); expect(output.version.caseFile).toBeNull();
  }
});

it('withholds a previously approved PDF when newly synced identity appears in its decoded text', async () => {
  const { version } = await investigate(runtime.store, scripted('strong-delivery'), d.dispute_id);
  const file = draft('strong-delivery'); file.evidence_draft.seller_note = 'Previously unknown recipient marker';
  const edited = runtime.service.edit(d.dispute_id, file, runtime.service.latest(d.dispute_id).id);
  await runtime.service.approve(d.dispute_id, edited.id, runtime.store.snapshotFingerprint(d.dispute_id));
  const before = await pdf(request('GET'), context()); expect(before.status).toBe(200);
  const text = await decodedPacketText(new Uint8Array(await before.arrayBuffer()));
  expect(text).toContain('Previously unknown recipient marker'); expect(text).not.toContain('Buyer Sensitive Name');
  runtime.store.save({ ...d, buyer: { name: 'Previously unknown recipient marker' } });
  expect((await pdf(request('GET'), context())).status).toBe(409);
  runtime.store.save({ ...d, buyer: {}, disputed_transactions: [] });
  expect((await pdf(request('GET'), context())).status).toBe(409);
  expect(version?.guard.accepted).toBe(true);
});
it('withholds the PDF if new identity matches a cited source rather than the model prose', async () => {
  const { version } = await investigate(runtime.store, scripted('strong-delivery'), d.dispute_id);
  await runtime.service.approve(d.dispute_id, version!.id, runtime.store.snapshotFingerprint(d.dispute_id));
  const before = await decodedPacketText(await runtime.service.preview(d.dispute_id));
  expect(before).toContain('DEMO CARRIER');
  runtime.store.save({ ...d, buyer: { name: 'DEMO CARRIER' } });
  expect((await pdf(request('GET'), context())).status).toBe(409);
});
it('enforces the global daily cap despite client header rotation', async () => {
  vi.stubEnv('MAX_INVESTIGATIONS_PER_DAY', '1');
  expect((await run(request('POST', {}, 'test-code', '192.0.2.20'), context())).status).toBe(200);
  expect((await run(request('POST', {}, 'test-code', '192.0.2.21'), context())).status).toBe(429);
  expect(runtime.model).toHaveBeenCalledTimes(1);
});
it('rechecks private text after PDF accent normalization', async () => {
  await investigate(runtime.store, scripted('strong-delivery'), d.dispute_id);
  const file = draft('strong-delivery'); file.evidence_draft.seller_note = 'Jose Marker';
  const v = runtime.service.edit(d.dispute_id, file, runtime.service.latest(d.dispute_id).id); await runtime.service.approve(d.dispute_id, v.id, runtime.store.snapshotFingerprint(d.dispute_id));
  expect(await decodedPacketText(await runtime.service.preview(d.dispute_id))).toContain('Jose Marker');
  runtime.store.save({ ...d, buyer: { name: 'José Marker' } });
  expect((await pdf(request('GET'), context())).status).toBe(409);
});
it('keeps test states out of the normal demo queue, including its open balance', async () => {
  runtime.store.save({ ...d, dispute_id: 'TEST-editable' });
  vi.stubEnv('DATABASE_PATH', './data/counterclaim.db');
  const demo = await (await queue()).json();
  expect(demo.cases.map((r: { id: string }) => r.id)).toEqual([d.dispute_id]);
  expect(demo.cases.reduce((sum: number, row: { amount: { value: string } }) => sum + Number(row.amount.value), 0)).toBe(120);
  vi.stubEnv('DATABASE_PATH', './data/e2e.db');
  expect((await (await queue()).json()).cases).toHaveLength(2);
});

it('requires the reviewed fingerprint and returns the changed snapshot on approval conflict', async () => {
  const { version } = await investigate(runtime.store, scripted('strong-delivery'), d.dispute_id);
  const reviewed = detailView(runtime.store, d.dispute_id);
  expect((await approve(request('POST', { versionId: version!.id }), context())).status).toBe(400);
  runtime.store.save({ ...d, dispute_life_cycle_stage: 'CHARGEBACK' });
  const response = await approve(request('POST', { versionId: version!.id, snapshotFingerprint: reviewed.snapshotFingerprint }), context());
  expect(response.status).toBe(409);
  const body = await response.json();
  expect(body.case.case.stage).toBe('CHARGEBACK');
  expect(body.case.snapshotFingerprint).not.toBe(reviewed.snapshotFingerprint);
  expect(runtime.store.approvals(d.dispute_id)).toEqual([]);
  const retry = await approve(request('POST', { versionId: version!.id, snapshotFingerprint: body.case.snapshotFingerprint }), context());
  expect(retry.status).toBe(200);
});
it('requires the base version and returns the first edit on a stale edit conflict', async () => {
  const { version } = await investigate(runtime.store, scripted('strong-delivery'), d.dispute_id);
  expect((await edit(request('PUT', { caseFile: draft('strong-delivery') }), context())).status).toBe(400);
  const first = await edit(request('PUT', { caseFile: draft('strong-delivery'), baseVersionId: version!.id }), context());
  expect(first.status).toBe(200);
  const response = await edit(request('PUT', { caseFile: draft('strong-delivery'), baseVersionId: version!.id }), context());
  expect(response.status).toBe(409);
  expect((await response.json()).case.caseFileVersions.at(-1).id).toBe((await first.json()).version.id);
  expect(runtime.store.versions(d.dispute_id)).toHaveLength(2);
});

it('withholds a stored packet produced before the current outbound allowlist', async () => {
  const { contentHash } = await import('../guard/submission');
  const { version } = await investigate(runtime.store, scripted('strong-delivery'), d.dispute_id);
  const approved = await runtime.service.approve(d.dispute_id, version!.id, runtime.store.snapshotFingerprint(d.dispute_id));
  const older = structuredClone(approved);
  older.id = crypto.randomUUID();
  older.content.evidence!.pdfBase64 = Buffer.from('previous packet format containing private analysis').toString('base64');
  older.contentHash = contentHash(older.content);
  runtime.store.addApproval(older);
  expect((await pdf(request('GET'), context())).status).toBe(409);
});
it('returns the exact checked packet blocks for review and the same approved PDF bytes', async () => {
  const { version } = await investigate(runtime.store, scripted('strong-delivery'), d.dispute_id);
  const file = draft('strong-delivery'); file.summary = 'The outcome is -$53.00.';
  const edited = runtime.service.edit(d.dispute_id, file, version!.id);
  const response = await detail(request('GET'), context());
  const view = await response.json();
  const packet = view.caseFileVersions.at(-1).outboundPacket;
  expect(packet.excluded).toContainEqual(expect.objectContaining({ path: 'summary', text: file.summary }));
  const approved = await runtime.service.approve(d.dispute_id, edited.id, runtime.store.snapshotFingerprint(d.dispute_id));
  const rendered = await pdf(request('GET'), context());
  const bytes = new Uint8Array(await rendered.arrayBuffer());
  expect(Buffer.from(bytes).toString('base64')).toBe(approved.content.evidence!.pdfBase64);
  const text = (await decodedPacketText(bytes)).replace(/\s+/g, ' ');
  for (const block of packet.blocks) expect(text).toContain(block.text.replace(/\s+/g, ' '));
  expect(text).not.toContain('outcome');
});
