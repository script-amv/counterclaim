import { containsPrivateText } from '../api/privacy';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { caseFileSchema, type CaseFile, type ReadSource } from '../agent/schema';
import type { EvidenceInput } from '../paypal/client';

export const DEMO_LABEL = 'SANDBOX DEMO DATA';
export const MAX_EVIDENCE_BYTES = 10_000_000;
const knownCarriers = new Set(['UPS', 'USPS', 'FEDEX', 'DHL', 'ROYAL_MAIL', 'PARCELFORCE', 'AIRBORNE_EXPRESS', 'AIRSURE', 'SWIFTAIR', 'OTHER']);
const filenamePattern = /^[A-Za-z0-9-_,\s]+[.][A-Za-z]+$/;
function validateFilename(name: string) {
  if (name.length < 1 || name.length > 2000 || !filenamePattern.test(name)) throw new Error('Invalid evidence filename');
}
export function validateEvidenceFile(file: File): void {
  validateFilename(file.name);
  if (!file.size || file.size >= MAX_EVIDENCE_BYTES || !['application/pdf', 'image/jpeg', 'image/png', 'image/gif'].includes(file.type)) {
    throw new Error('Evidence must be a nonempty supported file smaller than 10 MB');
  }
}
function selectedSources(file: CaseFile, sources: ReadSource[]): ReadSource[] {
  const ids = [...new Set([...file.claims.flatMap(c => c.citations), ...file.timeline.flatMap(t => t.citations), ...file.evidence_draft.attach_records])];
  const available = new Map(sources.map(s => [s.id, s]));
  return ids.map(id => { const source = available.get(id); if (!source) throw new Error('Evidence source is missing or unread'); return source; });
}
interface Shipment { signed?: boolean; carrier_name?: string; carrier_name_other?: string; tracking_number?: string }
function shipments(sources: ReadSource[]): Shipment[] {
  return sources.flatMap(source => {
    const record = source.data as { type?: string; content?: Shipment } | undefined;
    return record?.type === 'shipment' && record.content ? [record.content] : [];
  });
}
export function evidenceInput(reason: string | undefined, file: CaseFile, sources: ReadSource[], filename: string): EvidenceInput {
  caseFileSchema.parse(file); validateFilename(filename);
  const shipping = shipments(selectedSources(file, sources));
  const tracking = shipping.flatMap(shipment => {
    if (shipment.tracking_number === undefined && shipment.carrier_name === undefined) return [];
    if (!shipment.tracking_number || shipment.tracking_number.length > 255 || !shipment.carrier_name || shipment.carrier_name.length > 2000) throw new Error('Invalid shipment tracking fields');
    // The seeded carrier is explicitly synthetic. Map it to the schema-supported OTHER shape.
    const carrier = knownCarriers.has(shipment.carrier_name) ? shipment.carrier_name : 'OTHER';
    const other = carrier === 'OTHER' ? shipment.carrier_name_other ?? shipment.carrier_name : undefined;
    if (carrier === 'OTHER' && (!other || other.length > 2000)) throw new Error('Invalid shipment tracking carrier');
    return [{ carrier_name: carrier, ...(other ? { carrier_name_other: other } : {}), tracking_number: shipment.tracking_number }];
  });
  if (tracking.length > 10) throw new Error('Too many shipment tracking records (maximum 10)');
  const delivery = file.recommendation.action === 'fight' && reason === 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED' && shipping.length > 0;
  const type = delivery ? shipping.some(s => s.signed) ? 'PROOF_OF_DELIVERY_SIGNATURE' : 'PROOF_OF_FULFILLMENT' : 'OTHER';
  return { evidences: [{ evidence_type: type, notes: file.evidence_draft.seller_note, documents: [{ name: filename }],
    ...(tracking.length ? { evidence_info: { tracking_info: tracking } } : {}),
  }] };
}

// Standard PDF fonts support WinAnsi, not arbitrary Unicode. Make substitutions explicit and deterministic.
function printable(text: string) {
  return text.normalize('NFKD').replace(/[\u2010-\u2015]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[^\x20-\x7E\n]/g, '?');
}
/** Check the rendering normalization too: accents and unsupported glyphs change in PDF fonts. */
export function packetContainsPrivateText(file: CaseFile, sources: ReadSource[], forbidden: string[]): boolean {
  const normalize = (text: string) => printable(text.normalize('NFKD').replace(/\p{M}/gu, '')).replaceAll('?', '');
  return containsPrivateText({ file, sources }, forbidden)
    || containsPrivateText(normalize(JSON.stringify({ file, sources })), forbidden.map(normalize));
}
function wrapped(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of printable(text).split('\n')) {
    let line = '';
    // Split by measured glyph width, including long IDs and unbroken record text.
    for (const character of paragraph) {
      if (font.widthOfTextAtSize(line + character, size) > width) {
        const space = line.lastIndexOf(' ');
        if (space > line.length / 2) { lines.push(line.slice(0, space)); line = line.slice(space + 1) + character; }
        else { lines.push(line); line = character; }
      } else line += character;
    }
    lines.push(line);
  }
  return lines;
}

/** Caller must supply the exact approved CaseFile and the read sources saved with that version. */
export async function generatePacket(file: CaseFile, sources: ReadSource[]): Promise<Uint8Array> {
  caseFileSchema.parse(file);
  const selected = selectedSources(file, sources);
  const document = await PDFDocument.create();
  // Fixed metadata means approval hashes can bind reproducible document bytes.
  const fixedDate = new Date('2026-11-05T00:00:00.000Z');
  document.setCreationDate(fixedDate); document.setModificationDate(fixedDate);
  document.setTitle('Counterclaim sandbox demo evidence packet'); document.setAuthor('Counterclaim sandbox demo');
  document.setProducer('Counterclaim / pdf-lib'); document.setCreator('Counterclaim sandbox demo');
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage; let y = 0; let pageNumber = 0;
  const addPage = () => {
    page = document.addPage([612, 792]); pageNumber++; y = 720;
    page.drawText(DEMO_LABEL, { x: 48, y: 758, size: 11, font: bold, color: rgb(0.55, 0.12, 0.12) });
    page.drawLine({ start: { x: 48, y: 746 }, end: { x: 564, y: 746 }, thickness: 0.5, color: rgb(0.75, 0.75, 0.75) });
    page.drawText(`Counterclaim | Sandbox demo | Page ${pageNumber}`, { x: 48, y: 30, size: 9, font: regular, color: rgb(0.4, 0.4, 0.4) });
  };
  addPage();
  const write = (text: string, heading = false) => {
    const font = heading ? bold : regular; const size = heading ? 13 : 10;
    const lines = wrapped(text, font, size, 516);
    if (heading && y < 96) addPage();
    for (const line of lines) {
      if (y < 58) addPage();
      if (line) page.drawText(line, { x: 48, y, size, font, color: rgb(0.12, 0.15, 0.18) });
      y -= heading ? 20 : 14;
    }
    y -= 8;
  };
  write('Case summary', true); write(file.summary);
  write('Timeline', true);
  for (const item of file.timeline) write(`${item.date}: ${item.event}\nSources: ${item.citations.join(', ')}`);
  write('Sourced claims', true);
  for (const claim of file.claims) write(`${claim.text}\nSources: ${claim.citations.join(', ')}`);
  write('Seller note', true); write(file.evidence_draft.seller_note);
  write('Cited source records', true);
  for (const source of selected) { write(source.id, true); write(JSON.stringify(source.data, null, 2)); }
  const bytes = await document.save({ useObjectStreams: true, addDefaultPage: false });
  if (!bytes.byteLength || bytes.byteLength >= MAX_EVIDENCE_BYTES) throw new Error('Evidence packet must be smaller than 10 MB');
  return bytes;
}
