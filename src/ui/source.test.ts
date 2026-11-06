import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Editor, Source } from './case';
import { draft } from '../agent/test-fixtures';
import { recordsForScenario } from '../records';
import { fieldValue, paypalStatus } from './format';
it('renders only relevant highlights, human booleans and dates, and muted metadata', () => {
  const record = recordsForScenario('strong-delivery')[1]!;
  const html = renderToStaticMarkup(createElement(Source, { data: record, highlights: ['status', 'signed', 'address_matches'] }));
  expect(html.match(/<mark>/g)).toHaveLength(3);
  expect(html).toContain('<mark>DELIVERED</mark>');
  expect(html.match(/<mark>Yes<\/mark>/g)).toHaveLength(2);
  expect(html).toContain('Nov 2, 2026');
  const metadata = html.slice(html.indexOf('source-metadata'), html.indexOf('source-fields'));
  expect(metadata).toContain(record.id);
  expect(metadata).not.toContain('<mark>');
  expect(renderToStaticMarkup(createElement(Source, { data: record }))).not.toContain('<mark>');
});
it('falls back to a content summary without marking every field', () => {
  const record = recordsForScenario('strong-delivery')[0]!;
  const html = renderToStaticMarkup(createElement(Source, { data: record, highlights: [] }));
  expect(html.match(/<mark>/g)).toHaveLength(1);
  expect(html).toContain('source-summary');
  expect(html).toContain('Demo desk lamp');
  expect(fieldValue(false)).toBe('No');
  expect(paypalStatus('WAITING_FOR_SELLER_RESPONSE')).toBe('Waiting for your response');
});

it('labels the exact editable outbound note as visible to PayPal and the buyer', () => {
  const note = 'Thank you.\nThe carrier recorded delivery & a signature.';
  const file = draft('strong-delivery'); file.evidence_draft.seller_note = note;
  const html = renderToStaticMarkup(createElement(Editor, { file, version: { id: 'v', runId: 'r', createdAt: '2026-11-05T00:00:00Z', caseFile: file, guard: { accepted: true, reasons: [] }, sources: [] }, disabled: false, onDirty: () => {}, save: () => {} }));
  expect(html).toContain('<label for="seller-note">Sent to PayPal and visible to the buyer</label>');
  expect(html).toContain('Thank you.\nThe carrier recorded delivery &amp; a signature.</textarea>');
});

it('shows the checked outbound blocks and reports private exclusions separately', async () => {
  const { OutboundPreview } = await import('./outbound-preview');
  const { buildOutboundPacket } = await import('../evidence/packet');
  const file = draft('strong-delivery');
  file.summary = 'Private outcome is -$4.42.';
  const packet = buildOutboundPacket(file, [...recordsForScenario('strong-delivery').map(data => ({ id: data.id, data })), { id: 'dispute.dispute_amount', data: { currency_code: 'USD', value: '120.00' } }, ...['create_time', 'reason', 'dispute_life_cycle_stage'].map(key => ({ id: `dispute.${key}`, data: 'Recorded sandbox case' }))]);
  const html = renderToStaticMarkup(createElement(OutboundPreview, { packet }));
  const preview = html.slice(0, html.indexOf('Excluded from PDF'));
  expect(preview).toContain('SANDBOX DEMO DATA');
  expect(preview).toContain(file.evidence_draft.seller_note);
  expect(preview).not.toContain('Private outcome');
  expect(html).toContain('Excluded from PDF');
  expect(html).toContain('Private outcome is -$4.42.');
});
