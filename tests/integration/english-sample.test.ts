// The English onboarding e-mail (tests/fixtures/english-sample.txt): every international identifier is
// found, the ordinary numbers planted beside them are not, and the output restores exactly.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CodeBook, parseMarkers } from '../../src/core/codes';
import { detect, resplitItems } from '../../src/core/detector';
import { BUILTIN_PATTERNS } from '../../src/core/patterns';
import { applyRedactions, type MarkerStyle } from '../../src/core/redactor';
import { restore } from '../../src/core/restorer';

const text = readFileSync('tests/fixtures/english-sample.txt', 'utf8');

/** Everything the sample holds that the rules should find (English names and addresses are layer 2). */
const EXPECTED: [string, string][] = [
  ['生日', 'March 14, 1985'],
  ['SSN', '219-09-9999'],
  ['電子郵件', 'emily.carter@example.com'],
  ['國際電話', '+1 (415) 867-5309'],
  ['國際電話', '(416) 967-1111'],
  ['國際電話', '+44 20 7946 0958'],
  ['國際電話', '+81 3-1234-5678'],
  ['信用卡', '4242 4242 4242 4242'],
  ['信用卡', '3782 822463 10005'],
  ['IBAN', 'GB82 WEST 1234 5698 7654 32'],
  ['IBAN', 'DE89370400440532013000'],
  ['生日', '07/04/1990'],
  ['國際電話', '415-555-0123'],
  ['手機', '0912-345-678'],
  ['IP', '192.168.1.10'],
  ['IP', '2001:db8::1'],
];

describe('English sample', () => {
  it('finds every international identifier and nothing else (order numbers, amounts, dates, versions, times, MACs, invalid cards and SSNs)', () => {
    expect(detect(text, BUILTIN_PATTERNS).map((it) => [it.category, it.original])).toEqual(EXPECTED);
  });

  it.each(['code', 'label', 'blank'] as MarkerStyle[])('leaves none of the values in the %s output', (style) => {
    const book = new CodeBook();
    const items = detect(text, BUILTIN_PATTERNS, book);
    for (const partial of [false, true]) {
      resplitItems(items, book, () => (partial ? { mode: 'preview' } : undefined));
      const { redactedText } = applyRedactions(text, items, style);
      for (const [, value] of EXPECTED) expect(redactedText, value).not.toContain(value);
    }
  });

  it('restores exactly from the mapping table, with whole values hidden and with 部分保留', () => {
    const book = new CodeBook();
    const items = detect(text, BUILTIN_PATTERNS, book);
    for (const partial of [false, true]) {
      resplitItems(items, book, () => (partial ? { mode: 'preview' } : undefined));
      const { redactedText, mapping } = applyRedactions(text, items);
      expect(parseMarkers(redactedText)).toHaveLength(EXPECTED.length);
      expect(restore(redactedText, mapping).restoredText).toBe(text);
    }
  });
});
