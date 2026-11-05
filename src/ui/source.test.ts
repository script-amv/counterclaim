import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Source } from './case';
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
