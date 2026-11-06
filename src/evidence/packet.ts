import { caseFileSchema, type CaseFile, type ReadSource } from '../agent/schema';
import { checkOutboundNote } from '../guard/case-file';

export const DEMO_LABEL = 'SANDBOX DEMO DATA';
export function outboundTextReasons(text: string, sources: ReadSource[]): string[] {
  const amount = sources.find(s => s.id === 'dispute.dispute_amount')?.data;
  const disputed = amount && typeof amount === 'object' && 'currency_code' in amount && 'value' in amount
    && typeof amount.currency_code === 'string' && typeof amount.value === 'string'
    ? { currency_code: amount.currency_code, value: amount.value } : undefined;
  // Offers belong to the structured action, not this PDF.
  return [...new Set([...checkOutboundNote(text, sources, disputed), ...checkOutboundNote(printable(text), sources, disputed)])];
}
export interface OutboundPacket {
  header: string;
  blocks: { text: string; heading?: boolean }[];
  excluded: { path: string; text: string; reasons: string[] }[];
}
// Use the same normalization for the preview, safety check and PDF font.
export function printable(text: string) {
  return text.normalize('NFKD').replace(/[\u2010-\u2015]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[^\x20-\x7E\n]/g, '?');
}

/** The only projection authorized for PDF rendering and its approval preview. */
export function buildOutboundPacket(file: CaseFile, sources: ReadSource[]): OutboundPacket {
  caseFileSchema.parse(file);
  const packet: OutboundPacket = { header: DEMO_LABEL, blocks: [], excluded: [] };
  const exclude = (path: string, value: unknown, reasons: string[]) => {
    packet.excluded.push({ path, text: typeof value === 'string' ? value : JSON.stringify(value), reasons });
  };
  const safe = (text: string, path: string) => {
    const reasons = outboundTextReasons(text, sources);
    if (reasons.length) exclude(path, text, reasons);
    return reasons.length === 0;
  };
  safe(packet.header, 'header');
  const add = (text: string, path: string, heading = false) => {
    if (safe(text, path)) packet.blocks.push({ text: printable(text), ...(heading ? { heading: true } : {}) });
  };
  const available = new Map(sources.map(s => [s.id, s]));
  const ids = [...new Set([...file.claims.flatMap(c => c.citations), ...file.timeline.flatMap(t => t.citations), ...file.evidence_draft.attach_records])];
  const selected = ids.map(id => {
    const source = available.get(id);
    if (!source) throw new Error('Evidence source is missing or unread');
    return source;
  });
  const internal = new Set(selected.filter(source => {
    const record = source.data as { type?: unknown } | null;
    return record?.type === 'cost' || record?.type === 'policy' || /(?:^|[._-])(?:cost|policy)(?:[._-]|$)/i.test(source.id);
  }).map(source => source.id));
  for (const id of internal) exclude(`sources.${id}`, available.get(id)!.data, ['Internal source record']);
  const labels = new Map(selected.filter(s => !internal.has(s.id)).map((s, i) => [s.id, `Source ${i >= 26 ? String.fromCharCode(64 + Math.floor(i / 26)) : ''}${String.fromCharCode(65 + i % 26)}`]));
  const cited = (text: string, citations: string[], path: string) => {
    if (citations.some(id => internal.has(id))) { exclude(path, text, ['Cites an internal source record']); return; }
    add(`${text}\nSources: ${citations.map(id => labels.get(id)!).join(', ')}`, path);
  };
  // Explicit allowlist: no generic serialization of the case file.
  if (safe(file.summary, 'summary')) { add('Case summary', 'headings.summary', true); add(file.summary, 'summary'); }
  add('Seller note', 'headings.note', true); add(file.evidence_draft.seller_note, 'evidence_draft.seller_note');
  add('Timeline', 'headings.timeline', true);
  file.timeline.forEach((item, i) => cited(`${item.date}: ${item.event}`, item.citations, `timeline[${i}]`));
  add('Sourced claims', 'headings.claims', true);
  file.claims.forEach((claim, i) => cited(claim.text, claim.citations, `claims[${i}]`));
  file.gaps.forEach((gap, i) => exclude(`gaps[${i}]`, gap, ['Seller-only evidence weakness']));
  exclude('recommendation', file.recommendation, ['Seller-only decision, confidence and economics']);

  // Strip internal IDs structurally; check every remaining key and value, including nested fields.
  const clean = (value: unknown, path: string): unknown => {
    if (typeof value === 'string' || typeof value === 'number') return safe(String(value), path) ? value : undefined;
    if (Array.isArray(value)) return value.map((item, i) => clean(item, `${path}[${i}]`)).filter(v => v !== undefined);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
      if (key === 'id') { exclude(`${path}.${key}`, item, ['Internal source identifier']); return []; }
      if (!safe(key.replace(/([a-z])([A-Z])/g, '$1 $2'), `${path}.${key}`)) return [];
      const result = clean(item, `${path}.${key}`);
      return result === undefined ? [] : [[key, result]];
    }));
  };
  add('Delivery evidence', 'headings.delivery', true);
  const publicSources = selected.filter(s => !internal.has(s.id)).map(source => ({ ...source, data: clean(source.data, `sources.${source.id}`) }));
  for (const source of publicSources) {
    const record = source.data as { type?: string; timestamp?: string; content?: Record<string, unknown> } | null;
    if (!record?.content || !['shipment', 'tracking_event'].includes(record.type ?? '')) continue;
    if (record.timestamp) add(`Recorded: ${record.timestamp}`, `delivery.${source.id}.timestamp`);
    for (const key of ['carrier_name', 'carrier_name_other', 'tracking_number', 'status', 'signed', 'address_matches']) {
      const value = record.content[key];
      if (typeof value === 'string' || typeof value === 'boolean') add(`${key.replaceAll('_', ' ')}: ${value}`, `delivery.${source.id}.${key}`);
    }
  }
  add('Cited source records', 'headings.sources', true);
  for (const source of publicSources) {
    if (source.data === undefined) continue;
    const text = JSON.stringify(source.data, null, 2);
    if (!safe(text, `sources.${source.id}.excerpt`)) continue;
    add(labels.get(source.id)!, `sources.${source.id}.label`, true);
    add(text, `sources.${source.id}.excerpt`);
  }
  return packet;
}
