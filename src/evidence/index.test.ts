import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { evidenceInput, generatePacket, validateEvidenceFile } from './index';
import type { CaseFile, ReadSource } from '../agent/schema';

const file = (): CaseFile => ({
  summary: 'Sandbox test case summary',
  timeline: [{ date: '2026-11-03T10:00:00Z', event: 'Delivery scan recorded', citations: ['shipment-demo'] }],
  claims: [{ text: 'Signed delivery is recorded', citations: ['shipment-demo'] }], gaps: [],
  recommendation: { action: 'fight', reasoning: 'Signed delivery to matching reference', confidence: { level: 'medium', reason: 'Demo records' } },
  evidence_draft: { seller_note: 'Demo seller note for review.', attach_records: ['shipment-demo'] },
});
const sources: ReadSource[] = [
  { id: 'shipment-demo', data: { id: 'shipment-demo', type: 'shipment', source: 'Sandbox demo data', timestamp: '2026-11-03T10:00:00Z', content: { signed: true, carrier_name: 'DEMO CARRIER', tracking_number: 'DEMO-TRACK-123', address_matches: true } } },
  { id: 'unread-message', data: { type: 'customer_message', content: { text: 'THIS MUST NOT APPEAR' } } },
];
async function streams(bytes: Uint8Array) {
  const document = await PDFDocument.load(bytes);
  return { document, texts: document.getPages().map(page => {
    const contents = page.node.Contents();
    const objects = contents && 'asArray' in contents ? contents.asArray() : contents ? [contents] : [];
    return objects.map(object => {
      const stream = document.context.lookup(object);
      return stream instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(stream).decode()).toString() : '';
    }).join('\n');
  }) };
}
function encoded(text: string) { return Buffer.from(text).toString('hex').toUpperCase(); }

describe('sandbox evidence packet', () => {
  it('generates deterministic parseable PDF with label and only selected sources', async () => {
    const bytes = await generatePacket(file(), sources);
    expect(bytes).toEqual(await generatePacket(file(), sources));
    const { document, texts } = await streams(bytes);
    expect(document.getPageCount()).toBeGreaterThan(0);
    expect(texts.every(text => text.includes(encoded('SANDBOX DEMO DATA')))).toBe(true);
    expect(texts.join('')).toContain(encoded('Demo seller note for review.'));
    expect(texts.join('')).not.toContain(encoded('THIS MUST NOT APPEAR'));
    expect(bytes.byteLength).toBeLessThan(10_000_000);
    expect(document.catalog.get(PDFName.of('Type'))?.toString()).toBe('/Catalog');
  });
  it('paginates long sources and labels every page', async () => {
    const long = structuredClone(sources); (long[0]!.data as { content: object }).content = { text: 'Long delivery documentation. '.repeat(2000) };
    const { document, texts } = await streams(await generatePacket(file(), long));
    expect(document.getPageCount()).toBeGreaterThan(1);
    expect(texts.every(text => text.includes(encoded('SANDBOX DEMO DATA')))).toBe(true);
  });
  it('rejects an unread attachment or source', async () => {
    const f = file(); f.evidence_draft.attach_records.push('invented');
    await expect(generatePacket(f, sources)).rejects.toThrow('source');
    expect(() => evidenceInput(undefined, f, sources, 'evidence.pdf')).toThrow('source');
  });
  it('maps signed delivery and tracking using the supplied schema', () => {
    expect(evidenceInput('MERCHANDISE_OR_SERVICE_NOT_RECEIVED', file(), sources, 'evidence.pdf')).toEqual({ evidences: [{
      evidence_type: 'PROOF_OF_DELIVERY_SIGNATURE', notes: 'Demo seller note for review.', documents: [{ name: 'evidence.pdf' }],
      evidence_info: { tracking_info: [{ carrier_name: 'OTHER', carrier_name_other: 'DEMO CARRIER', tracking_number: 'DEMO-TRACK-123' }] },
    }] });
    const f = file(); f.recommendation.action = 'refund';
    expect(evidenceInput('MERCHANDISE_OR_SERVICE_NOT_RECEIVED', f, sources, 'evidence.pdf').evidences[0]!.evidence_type).toBe('OTHER');
    expect(evidenceInput('OTHER', file(), sources, 'evidence.pdf').evidences[0]!.evidence_type).toBe('OTHER');
  });
  it('uses fulfillment for unsigned shipment and caps tracking records at ten', () => {
    const changed = structuredClone(sources); const data = changed[0]!.data as { content: { signed: boolean } }; data.content.signed = false;
    expect(evidenceInput('MERCHANDISE_OR_SERVICE_NOT_RECEIVED', file(), changed, 'evidence.pdf').evidences[0]!.evidence_type).toBe('PROOF_OF_FULFILLMENT');
    const many = Array.from({ length: 11 }, (_, i) => ({ id: `shipment-${i}`, data: { type: 'shipment', content: { carrier_name: 'UPS', tracking_number: `DEMO-${i}` } } }));
    const f = file(); f.timeline = []; f.claims = []; f.evidence_draft.attach_records = many.map(s => s.id);
    expect(() => evidenceInput(undefined, f, many, 'evidence.pdf')).toThrow('tracking');
  });
  it('enforces supplied filename, note and tracking limits', () => {
    expect(() => evidenceInput(undefined, file(), sources, '../bad.pdf')).toThrow('filename');
    expect(() => evidenceInput(undefined, file(), sources, `${'x'.repeat(2000)}.pdf`)).toThrow('filename');
    const f = file(); f.evidence_draft.seller_note = 'x'.repeat(2001);
    expect(() => evidenceInput(undefined, f, sources, 'evidence.pdf')).toThrow();
    const bad = structuredClone(sources); (bad[0]!.data as { content: object }).content = { carrier_name: 'UPS', tracking_number: 'x'.repeat(256) };
    expect(() => evidenceInput(undefined, file(), bad, 'evidence.pdf')).toThrow('tracking');
  });
  it('enforces file type, name, nonempty bytes, and strict under-10-MB bound', () => {
    expect(() => validateEvidenceFile(new File(['x'], 'evidence.pdf', { type: 'application/pdf' }))).not.toThrow();
    expect(() => validateEvidenceFile(new File([], 'evidence.pdf', { type: 'application/pdf' }))).toThrow();
    expect(() => validateEvidenceFile(new File(['x'], 'evidence.txt', { type: 'text/plain' }))).toThrow();
    expect(() => validateEvidenceFile(new File([new Uint8Array(10_000_000)], 'evidence.pdf', { type: 'application/pdf' }))).toThrow();
  });
});
