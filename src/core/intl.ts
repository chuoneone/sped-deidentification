// Checks for international identifiers found by the builtin patterns (see specs/007-intl-pii-patterns):
// phone numbers, payment cards, US social security numbers, IBANs, IPv6 addresses and dates of birth.
// Each returns whether the match is valid, or how much of its start is (see Pattern.validate).
import { isValidPhoneNumber, parsePhoneNumberFromString } from 'libphonenumber-js';

const digitsOf = (s: string) => s.replace(/\D/g, '');

/**
 * The longest valid phone number at the start of the match, dropping trailing groups that ran on into
 * the next number. Numbers with a + are checked by their country code, others as North American
 * (+1: the US and Canada). Taiwan (+886) is left to the 手機 and 市話 rules.
 */
export function phoneLength(match: string): number | false {
  if (/^\+\s*886/.test(match)) return false;
  const groups = match.split(/(?<=\d|\))(?=[\s.-])/);
  for (let n = groups.length; n >= 1; n--) {
    const candidate = groups.slice(0, n).join('');
    const valid = candidate.startsWith('+') ? isValidPhoneNumber(candidate) : isValidPhoneNumber(candidate, { defaultCallingCode: '1' });
    if (valid) return candidate.length;
  }
  return false;
}

/** How many characters of a phone number are its country code (+44 , or the North American area code). */
export function phonePrefixLength(value: string): number {
  if (value.startsWith('+')) {
    const code = parsePhoneNumberFromString(value)?.countryCallingCode;
    return code ? (value.match(new RegExp(`^\\+\\s*${code}[\\s.-]?`))?.[0].length ?? 0) : 0;
  }
  return value.match(/^(?:\(\d{3}\)\s?|\d{3}[\s.-])/)?.[0].length ?? 0;
}

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

/** Issuer prefixes: Visa, Mastercard, American Express, Discover, JCB, UnionPay, Diners Club. */
const CARD_PREFIX = /^(?:4|5[1-5]|2(?:2[2-9][1-9]|2[3-9]\d|[3-6]\d\d|7[01]\d|720)|3[47]|6011|65|64[4-9]|35(?:2[89]|[3-8]\d)|62|30[0-5]|36|38)/;
/** Grouped card numbers come in these shapes only (4-4-4-4, 4-4-4-4-3, Amex 4-6-5, Diners 4-6-4). */
const CARD_GROUPS = new Set(['4-4-4-4', '4-4-4-4-3', '4-6-5', '4-6-4', '4-4-4-1', '4-4-4-2', '4-4-4-3']);

export function isCardNumber(match: string): boolean {
  const digits = digitsOf(match);
  if (digits.length < 13 || digits.length > 19 || !CARD_PREFIX.test(digits) || !luhn(digits)) return false;
  const groups = match.split(/[\s-]/);
  return groups.length === 1 || (new Set(match.match(/[\s-]/g)).size === 1 && CARD_GROUPS.has(groups.map((g) => g.length).join('-')));
}

/** A US social security number in a range that is ever issued (not 000, 666, 9xx; group 00; serial 0000). */
export function isSsn(match: string): boolean {
  const d = digitsOf(match);
  return d.length === 9 && !/^(?:000|666|9)/.test(d) && d.slice(3, 5) !== '00' && d.slice(5) !== '0000';
}

/** IBAN lengths per country (ISO 13616); others are accepted at 15–34 characters. */
const IBAN_LENGTH: Record<string, number> = {
  AD: 24, AE: 23, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29, CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DK: 18, DO: 28, EE: 20, EG: 29,
  ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IS: 26, IT: 27, JO: 30, KW: 30,
  KZ: 20, LB: 28, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24, PL: 28, PS: 29,
  PT: 25, QA: 29, RO: 24, RS: 22, SA: 24, SE: 24, SI: 19, SK: 24, SM: 27, TN: 24, TR: 26, UA: 29, VG: 24, XK: 20,
};

function mod97(iban: string): number {
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rest = 0;
  for (const ch of moved) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of v) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest;
}

/** The IBAN at the start of the match, cut to its country's length, if its check digits hold. */
export function ibanLength(match: string): number | false {
  const want = IBAN_LENGTH[match.slice(0, 2)];
  let [chars, end] = [0, 0];
  for (; end < match.length && (want === undefined || chars < want); end++) if (match[end] !== ' ') chars++;
  const iban = match.slice(0, end).replace(/ /g, '');
  if (want !== undefined ? iban.length !== want : iban.length < 15 || iban.length > 34) return false;
  return mod97(iban) === 1 ? end : false;
}

/** An IPv6 address, as the browser's own URL parser reads one (times and MAC addresses fail). */
export function isIpv6(match: string): boolean {
  if ((match.match(/[0-9a-f]+/gi) ?? []).length < 2) return false;
  try {
    return new URL(`http://[${match}]/`).hostname.length > 2;
  } catch {
    return false;
  }
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** A date of birth whose month and day are possible (the year is not checked: 民國 years are short). */
export function isBirthDate(match: string): boolean {
  const word = match.match(/[A-Za-z]{3,}/)?.[0];
  const numbers = (match.match(/\d+/g) ?? []).map(Number);
  let [month, day] = [0, 0];
  if (word) {
    month = MONTHS.indexOf(word.slice(0, 3).toLowerCase()) + 1;
    day = numbers.find((n) => n <= 31) ?? 0;
  } else if (/年/.test(match) || /^\d{4}/.test(match)) {
    [month, day] = [numbers[1], numbers[2]];
  } else {
    // 03/14/1985 or 14/03/1985: either order, as long as one reading is a date.
    const [a, b] = numbers;
    [month, day] = a <= 12 ? [a, b] : [b, a];
  }
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/** How many characters at each end of a date of birth are its year (with the separator next to it). */
export function birthYearSplit(value: string): { head: number; tail: number } {
  const head = value.match(/^(?:(?:民國\s*)?\d{2,4}\s*年|\d{4}[-/.])\s*/)?.[0];
  if (head) return { head: head.length, tail: 0 };
  const tail = value.match(/[\s,/.-]+\d{4}$/)?.[0];
  return tail ? { head: 0, tail: tail.length } : { head: 0, tail: 0 };
}
