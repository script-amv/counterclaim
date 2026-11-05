import { trustedFacts, type TrustedFacts } from '../agent/facts';
import type { SellerRecord } from '../records';
import type { Dispute } from '../paypal/schemas';
import type { CaseFile, GuardResult, ReadSource } from '../agent/schema';
import { units } from '../agent/money';
import { containsPrivateText } from '../api/privacy';

const currencyCodes = new Set(Intl.supportedValuesOf('currency'));
function moneyMentions(text: string): { code: string; value: string; start: number; end: number }[] {
  const out: { code: string; value: string; start: number; end: number }[] = [];
  const names: Record<string, string> = { '$':'USD', '€':'EUR', '£':'GBP', '¥':'JPY', dollar:'USD', dollars:'USD', euro:'EUR', euros:'EUR', pound:'GBP', pounds:'GBP', yen:'JPY' };
  const codes = [...currencyCodes].join('|');
  const amount = '([+\\-−]?\\d(?:[\\d,]*\\d)?(?:\\.\\d+)?)';
  const prefix = new RegExp(`(?:\\b(${codes})\\s*|([$€£¥])\\s*)${amount}`, 'gi');
  const suffix = new RegExp(`(?<![\\w.,])${amount}\\s*(dollars?|euros?|pounds?|yen|${codes})\\b`, 'gi');
  for (const m of text.matchAll(prefix)) out.push({ code: m[1]?.toUpperCase() ?? names[m[2]!]!, value: m[3]!.replaceAll(',', '').replace('−', '-'), start: m.index!, end: m.index! + m[0].length });
  for (const m of text.matchAll(suffix)) out.push({ code: names[m[2]!.toLowerCase()] ?? m[2]!.toUpperCase(), value: m[1]!.replaceAll(',', '').replace('−', '-'), start: m.index!, end: m.index! + m[0].length });
  return out;
}
function sameFigure(a: string, b: string): boolean {
  const signed = (v: string) => v.startsWith('-') ? -units(v.slice(1)) : units(v.replace(/^\+/, ''));
  try { return signed(a) === signed(b); } catch { return false; }
}
function sourceHasMoney(data: unknown, code: string, value: string): boolean {
  if (typeof data === 'string') return moneyMentions(data).some(m => m.code === code && sameFigure(m.value, value));
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  if (obj.type === 'cost' && obj.content && typeof obj.content === 'object') {
    const cost = obj.content as Record<string, unknown>;
    if (cost.currency_code === code && typeof cost.item_cost === 'string' && typeof cost.shipping_cost === 'string') {
      try { if (units(cost.item_cost) + units(cost.shipping_cost) === units(value)) return true; } catch { /* Invalid or signed totals are not proof. */ }
    }
  }
  if (obj.currency_code === code && Object.values(obj).some(v => typeof v === 'string' && /^\d+(\.\d{1,3})?$/.test(v) && sameFigure(v, value))) return true;
  return Object.values(obj).some(v => sourceHasMoney(v, code, value));
}
export function checkCaseFile(file: CaseFile, sources: ReadSource[], forbidden: string[] = [], facts: TrustedFacts = inferredFacts(sources)): GuardResult {
  const map = new Map(sources.map(s => [s.id, s.data])); const reasons: string[] = [];
  const prose = [file.summary, ...file.claims.map(c => c.text), ...file.timeline.map(t => t.event), file.recommendation.reasoning, file.recommendation.confidence.reason, file.evidence_draft.seller_note];
  for (const text of prose) reasons.push(...factualContradictions(text, facts));
  if (repeatsInstructions(JSON.stringify(file), sources, forbidden.find(v => v.startsWith('You assist a seller')))) reasons.push('Case file repeats or obeys untrusted instructions or prompt text');
  for (const text of prose) for (const money of moneyMentions(text)) {
    const computed = facts.money.currency_code === money.code && Object.values(facts.money).some(v => typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) && sameFigure(v, money.value));
    const offer = file.recommendation.offer_amount;
    if (!computed && !(offer?.currency_code === money.code && sameFigure(offer.value, money.value)) && !sources.some(s => sourceHasMoney(s.data, money.code, money.value))) reasons.push('Text contains an unsupported currency figure');
  }
  if (containsPrivateText(file, forbidden)) reasons.push('Case file contains private data');
  for (const [kind, items] of [['claim', file.claims], ['timeline', file.timeline]] as const) {
    for (const [index, item] of items.entries()) {
      if (!item.citations.length || item.citations.some(id => !map.has(id))) reasons.push(`${kind} ${index + 1}: missing or unread citation`);
      const text = 'text' in item ? item.text : item.event;
      if ('date' in item) {
        const cited = item.citations.map(id => JSON.stringify(map.get(id)) ?? '').join(' ');
        if (!cited.includes(item.date.slice(0, 10))) reasons.push(`timeline ${index + 1}: date is not in cited sources`);
      }
      for (const money of moneyMentions(text)) {
        const citedFacts = inferredFacts(item.citations.map(id => ({ id, data: map.get(id) })));
        const computed = citedFacts.money.currency_code === money.code && [citedFacts.money.net_if_won, citedFacts.money.net_if_lost, citedFacts.money.total_recorded_costs].some(v => v !== null && sameFigure(v, money.value));
        if (!computed && !item.citations.some(id => sourceHasMoney(map.get(id), money.code, money.value))) reasons.push(`${kind} ${index + 1}: currency figure is not in cited sources`);
      }
    }
  }
  for (const id of file.evidence_draft.attach_records) {
    if (!map.has(id) || id.startsWith('dispute.') || id.startsWith('order.')) reasons.push('Attachment is missing or unread');
  }
  const amount = file.recommendation.offer_amount;
  const disputed = map.get('dispute.dispute_amount') as { currency_code?: string; value?: string } | undefined;
  if (amount && (!disputed?.value || amount.currency_code !== disputed.currency_code || units(amount.value) > units(disputed.value))) reasons.push('Offer exceeds disputed amount or currency is unavailable/mismatched');
  if (!sources.some(s => !s.id.startsWith('dispute.') && !s.id.startsWith('order.')) && !file.gaps.length) reasons.push('No seller records read: missing proof must be reported as gaps');
  const warnings: string[] = [];
  if (file.recommendation.action === 'fight' && (facts.trackingStalled || facts.addressMatches === false || facts.delivered !== true)) warnings.push('Advice to fight conflicts with computed delivery evidence');
  return { accepted: reasons.length === 0, reasons: [...new Set(reasons)], warnings };
}
export function evidenceStrength(guard: GuardResult | undefined, facts: TrustedFacts): 'unreviewed' | 'rejected' | 'weak' | 'partial' | 'strong' {
  if (!guard) return 'unreviewed';
  if (!guard.accepted) return 'rejected';
  if (facts.trackingStalled || facts.addressMatches === false) return 'weak';
  if (facts.delivered === true && facts.signed === true && facts.addressMatches === true) return 'strong';
  return facts.delivered === true || facts.addressMatches === true ? 'partial' : 'weak';
}

function inferredFacts(sources: ReadSource[]): TrustedFacts {
  const dispute = Object.fromEntries(sources.filter(s => s.id.startsWith('dispute.')).map(s => [s.id.slice(8), s.data])) as unknown as Dispute;
  const records = sources.map(s => s.data).filter((d): d is SellerRecord => !!d && typeof d === 'object' && 'type' in d && 'content' in d);
  return trustedFacts(dispute, records, sources.some(s => s.id === 'order.id'));
}
function factualContradictions(text: string, facts: TrustedFacts): string[] {
  const reasons: string[] = [];
  // Evaluate clauses independently so a negation about one predicate cannot excuse another.
  // Resolve coordinated absence before comma splitting, preserving its scope to named predicates.
  const absentPredicate = '(?:a )?signed receipt|stalled tracking|tracking stall|address mismatch|signature(?: confirmation)?|(?:confirmed )?delivery(?: confirmation| to the order address)?|matching[- ](?:(?:shipment|delivery|order) )?address(?: (?:proof|evidence))?';
  const absenceList = new RegExp(`\\b(?:no|neither|absence of|lack of|without|cannot (?:evidence|confirm|establish|prove)|missing|lacks?)\\s+(?:${absentPredicate})(?:,\\s*(?:${absentPredicate}))*\\s*,?\\s+(?:or|and|nor)\\s+(?:${absentPredicate})\\b`, 'gi');
  const scoped = text.replace(/\b(?:delivery|signature|address match|(?:a )?matching address)(?:,\s*|\s+and\s+)(?:signature|address match|(?:a )?matching address)(?:\s+and\s+(?:address match|(?:a )?matching address))?\s+are\s+(?:all\s+)?(?:unestablished|unconfirmed|unproven|unsupported|not established)\b/gi,
    group => {
      const predicates = group.toLowerCase().replace(/\b(?:a )?matching address\b/g, 'address match');
      return ['delivery', 'signature', 'address match'].filter(predicate => predicates.includes(predicate)).map(predicate => `no ${predicate}`).join('; ');
    })
    .replace(absenceList, group => (group.match(new RegExp(absentPredicate, 'gi')) ?? []).map(predicate => `no ${predicate}`).join('; '));
  for (const clause of scoped.split(/[.!?;,\n]|\bbut\b/i)) {
    const normalized = clause.toLowerCase().replaceAll('_', ' ').replace(/\bnon[- ]matching\b/g, 'not matching')
      // Absence of evidence inside a customer message does not deny shipment delivery.
      .replace(/\b(?:customer|buyer) message record contains no (?:delivery|settlement)(?: or (?:delivery|settlement))? (?:evidence|proof)\b/g, 'source evidence absent')
      // A defense explicitly excluded as irrelevant is not an asserted shipment state.
      .replace(/\b(?:usual )?(?:stalled[- ]tracking|wrong[- ]address)(?: or (?:stalled[- ]tracking|wrong[- ]address))? defenses are not the issue(?: here)?\b/g, '');
    const literalKeys = { delivered: 'delivered', signed: 'signed', address_matches: 'addressMatches', tracking_stalled: 'trackingStalled', customer_willing_to_settle: 'customerWillingToSettle' } as const;
    for (const [key, fact] of Object.entries(literalKeys)) {
      const match = clause.match(new RegExp(`\\b${key}\\s*[:=]\\s*(true|false)\\b`, 'i'));
      if (match && facts[fact] !== (match[1]!.toLowerCase() === 'true')) reasons.push(`Text contradicts trusted fact: ${fact}`);
    }
    const assertions: [keyof Pick<TrustedFacts, 'delivered' | 'signed' | 'addressMatches' | 'trackingStalled' | 'customerWillingToSettle'>, RegExp, RegExp][] = [
      ['delivered', /\b(?:delivered|received by (?:the )?(?:buyer|customer)|(?:parcel|package|shipment) (?:arrived|reached)|delivery (?:is )?confirmed|confirmed delivery|proof of delivery|receipt (?:is )?confirmed)\b/, /\b(?:not|no|never|unconfirmed|without|missing|lacks?|unavailable|cannot|unestablished|hasn't|has not|isn't)\b.{0,65}\b(?:deliver\w*|receipt)|\bdeliver\w*.{0,30}\b(?:not|false|unconfirmed|missing|unavailable)\b/],
      ['signed', /\b(?:signed|signature (?:confirmation|confirmed|proof)|signature)\b/, /\b(?:not|no|never|unsigned|without|missing|lacks?|unavailable|cannot)\b.{0,45}\b(?:signed|signature)|\b(?:signed|signature).{0,30}\b(?:false|missing|unavailable|absent|not)\b/],
      ['addressMatches', /\b(?:address matches|address match|matching address|matching (?:order|shipment|delivery) address|address (?:reference )?matches|same address|correct address|to the (?:order|matching) address)\b/, /\b(?:not|no|without|missing|cannot)\b.{0,40}\b(?:match|address)|\baddress matches\s*[:=]?\s*false\b|\b(?:to the order address|address match(?:es)?)\s+(?:is |has )?(?:not established|unestablished|unconfirmed|false)\b/],
      ['trackingStalled', /\b(?:stalled|tracking (?:has )?not (?:advanced|progressed))\b/, /\b(?:not|no|never)\b.{0,15}\bstalled\b/],
      ['customerWillingToSettle', /\b(?:willing to settle|customer (?:agreed|agrees) to settle)\b/, /\b(?:not|no|never)\b.{0,15}\bwilling\b/],
    ];
    for (const [key, positive, negative] of assertions) {
      if (positive.test(normalized) && !negative.test(normalized) && facts[key] !== true) reasons.push(`Text contradicts trusted fact: ${key}`);
    }
    if (/\b(?:tracking (?:is )?not stalled|tracking (?:is )?(?:progressing|advancing)|tracking has progressed)\b/.test(normalized) && facts.trackingStalled === true) reasons.push('Text contradicts trusted fact: trackingStalled');
    if (/\b(?:not willing to settle|unwilling to settle)\b/.test(normalized) && facts.customerWillingToSettle) reasons.push('Text contradicts trusted fact: customerWillingToSettle');
    if (/\b(?:address (?:mismatch|differs)|mismatched address|different address)\b/.test(normalized.replace(/\b(?:no|not(?: an?)?|without)\s+(?:address mismatch|mismatched address|different address)\b/g, '')) && facts.addressMatches === true) reasons.push('Text contradicts trusted fact: addressMatches');
    if (/\b(?:not delivered|no (?:confirmed )?delivery\b(?!\s+(?:failure|issue|problem))|delivery (?:is )?not confirmed)\b/.test(normalized) && facts.delivered === true) reasons.push('Text contradicts trusted fact: delivered');
    if (/\b(?:not signed|unsigned|no signature)\b/.test(normalized) && facts.signed === true) reasons.push('Text contradicts trusted fact: signed');
  }
  const monetaryPredicates: [RegExp, string | null][] = [
    [/\b(?:disputed amount|dispute amount|amount disputed)\b/i, facts.money.disputed_amount],
    [/\b(?:total (?:recorded )?costs|total_recorded_costs)\b/i, facts.money.total_recorded_costs],
    [/\bitem cost\b/i, facts.money.item_cost], [/\bshipping cost\b/i, facts.money.shipping_cost],
    [/\b(?:net if won|net_if_won)\b/i, facts.money.net_if_won], [/\b(?:net if lost|net_if_lost)\b/i, facts.money.net_if_lost],
  ];
  for (const rawSentence of text.split(/[;\n]|(?<=[.!?])\s/)) {
    const sentence = rawSentence.replace(/\([^()]*\)/g, '');
    const figures = moneyMentions(sentence);
    for (const [label, expected] of monetaryPredicates) {
      for (const match of sentence.matchAll(new RegExp(label.source, 'gi'))) {
        const labelEnd = match.index! + match[0].length;
        for (const figure of figures) {
          const before = figure.start >= labelEnd && /^\s*(?:(?:is|was|of|equals|would be|would equal|:|=)\s*)?$/i.test(sentence.slice(labelEnd, figure.start));
          const after = figure.end <= match.index! && /^\s*(?:,\s*)?(?:(?:is|was) (?:the )?|as the |which is the )$/i.test(sentence.slice(figure.end, match.index!));
          if ((before || after) && (expected === null || figure.code !== facts.money.currency_code || !sameFigure(figure.value, expected))) reasons.push('Text contradicts trusted monetary fact');
        }
      }
    }
  }
  for (const date of text.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? []) if (!facts.dates.includes(date)) reasons.push('Text contains an unsupported date');
  return reasons;
}
export function repeatsInstructions(output: string, sources: ReadSource[], prompt = ''): boolean {
  const normalize = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const words = normalize(output).join(' ');
  const instructionText = sources.flatMap(s => {
    const strings: string[] = [];
    const visit = (v: unknown) => { if (typeof v === 'string' && /\b(?:ignore|reveal|system instructions|system prompt|disregard|override|follow these instructions)\b/i.test(v)) strings.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(visit); };
    visit(s.data); return strings;
  });
  // Short overlaps count for instructions, not ordinary domain vocabulary from the prompt.
  const promptInstructions = prompt.split(/[.!?;]\s/).filter(sentence => /^(?:You |Stored text|Do not|Never |Return ONLY)/i.test(sentence));
  for (const text of [...instructionText, ...promptInstructions]) {
    const tokens = normalize(text);
    for (let i = 0; i + 5 <= tokens.length; i++) if (words.includes(tokens.slice(i, i + 5).join(' '))) return true;
  }
  const promptTokens = normalize(prompt);
  for (let i = 0; i + 12 <= promptTokens.length; i++) if (words.includes(promptTokens.slice(i, i + 12).join(' '))) return true;
  return /\b(?:following|obeying|as instructed by|per)\b.{0,70}\b(?:customer message|buyer message|injected|system instructions)\b/i.test(output);
}
