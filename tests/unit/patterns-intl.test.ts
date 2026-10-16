import { describe, expect, it } from 'vitest';
import { CodeBook } from '../../src/core/codes';
import { detect, resplitItems } from '../../src/core/detector';
import { BUILTIN_PATTERNS } from '../../src/core/patterns';
import { outputFor } from '../../src/core/redactor';
import type { Category } from '../../src/core/types';

/** [category, value] of every detected item. */
const found = (text: string) => detect(text, BUILTIN_PATTERNS).map((it) => [it.category, it.original]);
/** The values of one category detected in `text`. */
const of = (category: Category, text: string) => detect(text, BUILTIN_PATTERNS).filter((it) => it.category === category).map((it) => it.original);

describe('international phone numbers', () => {
  it.each(['+1 (415) 867-5309', '(416) 967-1111', '415-867-5309', '415.867.5309', '+44 20 7946 0958', '+81 3-1234-5678', '+33 1 42 68 53 00', '+61 2 9374 4000'])(
    'finds %s',
    (phone) => expect(of('國際電話', `Call ${phone} today.`)).toEqual([phone]),
  );

  it('leaves Taiwanese numbers to the 手機 and 市話 rules', () => {
    expect(found('Tel +886 912 345 678, +886-2-2712-3456, 0912-345-678, 02-2712-3456')).toEqual([
      ['手機', '+886 912 345 678'],
      ['市話', '+886-2-2712-3456'],
      ['手機', '0912-345-678'],
      ['市話', '02-2712-3456'],
    ]);
  });

  it('does not take fictional numbers, dates or order numbers for phones', () => {
    expect(of('國際電話', 'Call 555-0123 or +1 555 555 0100. Shipped 2026-10-16, order 123-456-7890.')).toEqual([]);
  });

  it('keeps only the valid number when another number follows it', () => {
    expect(of('國際電話', 'Phone +44 20 7946 0958 2026 annual report')).toEqual(['+44 20 7946 0958']);
  });
});

describe('credit cards', () => {
  it.each(['4242 4242 4242 4242', '5555-5555-5555-4444', '3782 822463 10005', '6011111111111117', '3530111333300000'])('finds %s', (card) =>
    expect(of('信用卡', `Card: ${card}.`)).toEqual([card]),
  );

  it('rejects failed checksums, unknown prefixes and odd groupings', () => {
    expect(of('信用卡', 'Cards 4242 4242 4242 4241, 1234 5678 9012 3452, 42 4242 4242 424242, tracking 1000000000000008.')).toEqual([]);
  });
});

describe('US social security numbers', () => {
  it('finds dashed, spaced and labelled numbers', () => {
    expect(of('SSN', 'SSN 123-45-6789; spouse 219 09 9999; SSN: 078051121.')).toEqual(['123-45-6789', '219 09 9999', '078051121']);
  });

  it('rejects never-issued ranges and mixed separators', () => {
    expect(of('SSN', '000-12-3456 666-12-3456 912-34-5678 123-00-4567 123-45-0000 123-45 6789 and 123456789 unlabelled')).toEqual([]);
  });
});

describe('IBAN', () => {
  it('finds grouped and compact IBANs that pass the check digits', () => {
    expect(of('IBAN', 'Pay GB82 WEST 1234 5698 7654 32 or DE89370400440532013000 or FR14 2004 1010 0505 0001 3M02 606.')).toEqual([
      'GB82 WEST 1234 5698 7654 32',
      'DE89370400440532013000',
      'FR14 2004 1010 0505 0001 3M02 606',
    ]);
  });

  it('rejects wrong check digits and stops at the country length', () => {
    expect(of('IBAN', 'GB83 WEST 1234 5698 7654 32')).toEqual([]);
    expect(of('IBAN', 'GB82 WEST 1234 5698 7654 32 SORT CODE')).toEqual(['GB82 WEST 1234 5698 7654 32']);
  });
});

describe('IP addresses', () => {
  it('finds IPv4 and IPv6', () => {
    expect(of('IP', 'from 192.168.1.10 and 8.8.8.8, v6 2001:db8::1 and fe80::1ff:fe23:4567:890a.')).toEqual(['192.168.1.10', '8.8.8.8', '2001:db8::1', 'fe80::1ff:fe23:4567:890a']);
  });

  it('rejects out-of-range numbers, version strings, times and MAC addresses', () => {
    expect(of('IP', 'v999.1.1.1, build 1.2.3.4.5, date 2026.10.16, at 12:30:45, MAC 00:1A:2B:3C:4D:5E')).toEqual([]);
  });
});

describe('dates of birth', () => {
  it.each([
    ['DOB: 1985-03-14', '1985-03-14'],
    ['D.O.B. 03/14/1985', '03/14/1985'],
    ['Date of Birth: March 14, 1985', 'March 14, 1985'],
    ['Born on 14 March 1985', '14 March 1985'],
    ['Birthday: Sept. 3, 1990', 'Sept. 3, 1990'],
    ['出生日期：民國 80 年 5 月 1 日', '民國 80 年 5 月 1 日'],
    ['出生日期 80 年5月1日', '80 年5月1日'],
    ['生日 1990/12/31', '1990/12/31'],
    ['出生年月日：1979年8月8日', '1979年8月8日'],
  ])('finds the date in「%s」', (text, date) => expect(of('生日', text)).toEqual([date]));

  it('takes the next table cell but not a column of dates under a header', () => {
    expect(of('生日', '姓名\t王小明\t出生日期\t1990-01-02')).toEqual(['1990-01-02']);
    expect(of('生日', '編號\t姓名\t出生日期\n001\t王小明\t1974-10-27\n出生日期\n1974-10-27')).toEqual([]);
  });

  it('leaves unlabelled and impossible dates alone', () => {
    expect(of('生日', 'Invoice Date: 2026-10-16. Due 2026/11/15. DOB: 2026-13-40. 簽約日期 2026 年 9 月 17 日')).toEqual([]);
  });
});

describe('部分保留 for the new categories', () => {
  const partial = (text: string) => {
    const book = new CodeBook();
    const items = detect(text, BUILTIN_PATTERNS, book);
    resplitItems(items, book, () => ({ mode: 'preview' }));
    return items.map((it) => outputFor(it, 'label'));
  };

  it('shows only the statistics-friendly part', () => {
    expect(
      partial('4242 4242 4242 4242 / DOB: 1985-03-14 / Born on 14 March 1985 / +44 20 7946 0958 / (415) 867-5309 / GB82 WEST 1234 5698 7654 32 / 192.168.1.10 / 2001:db8::1 / 123-45-6789'),
    ).toEqual(['[信用卡]4242', '1985-[生日]', '[生日] 1985', '+44 [國際電話]', '(415) [國際電話]', 'GB[IBAN]', '192.168.[IP]', '2001:db8:[IP]', '[SSN]']);
  });
});
