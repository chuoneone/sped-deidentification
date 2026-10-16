// Scores scanned-PDF recognition in the real site against the sample's answer key
// (tests/fixtures/scanned-sample.answer.json, written by `npm run examples`).
// Prerequisite: the built site served at BASE_URL (default: `npm run build && npm run preview` → http://localhost:4173/).
// Run: npm run eval:ocr            (add `-- --verbose` for misses and false positives, `-- --json out.json` to save)
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4173/';
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface AnswerPage {
  title: string;
  planted: [string, string][];
  handwritten: [string, string][];
  manual: string[];
  text: string;
  pictures: Box[];
}
const answer: { source: string; pages: AnswerPage[] } = JSON.parse(readFileSync('tests/fixtures/scanned-sample.answer.json', 'utf8'));

/** Characters as a multiset, whitespace ignored; NFKC so a fullwidth「：」and the「:」read for it count as the same. */
function bag(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const ch of s.normalize('NFKC').replace(/\s/g, '')) m.set(ch, (m.get(ch) ?? 0) + 1);
  return m;
}

/**
 * Character recall / precision without regard to order: the recogniser may read a table column by
 * column while the original runs row by row, which would make an ordered edit distance meaningless.
 */
function characters(truth: string, read: string) {
  const [t, r] = [bag(truth), bag(read)];
  let same = 0;
  for (const [ch, n] of t) same += Math.min(n, r.get(ch) ?? 0);
  const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  const diff = (a: Map<string, number>, b: Map<string, number>) =>
    [...a].flatMap(([ch, n]) => Array<string>(Math.max(0, n - (b.get(ch) ?? 0))).fill(ch)).join('');
  return { truth: total(t), read: total(r), same, missing: diff(t, r), extra: diff(r, t) };
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

const iou = (a: Box, b: Box) => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  const inter = Math.max(0, w) * Math.max(0, h);
  return inter / (a.width * a.height + b.width * b.height - inter);
};

const browser = await puppeteer.launch({ executablePath: CHROME });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
page.on('dialog', (d) => void d.accept());
await page.goto(BASE_URL, { waitUntil: 'load' });
const started = Date.now();
const input = await page.waitForSelector('.process-view input[type=file]');
await input!.uploadFile(resolve(answer.source));
await page.waitForSelector('.badge-ocr', { timeout: 600000 });
const seconds = (Date.now() - started) / 1000;
// tsx wraps named arrow functions in a `__name` helper that does not exist inside the page.
await page.evaluate('globalThis.__name = (f) => f');

// What the site recognised, per page: the original text behind every mark, the detected values and
// the kept pictures (their position comes from the preview's `calc(var(--s) * Npx)` styles).
const read = await page.evaluate(() =>
  [...document.querySelectorAll<HTMLElement>('.pdf-page')].map((pg) => {
    const original = (m: HTMLElement) => m.dataset.tip?.match(/原文：(.*?)｜/)?.[1] ?? '';
    const text = [...pg.querySelectorAll<HTMLElement>('.pdf-item')]
      .map((item) =>
        [...item.childNodes]
          .map((n) => (n instanceof HTMLElement && n.tagName === 'MARK' ? (n.classList.contains('mark-cont') ? '' : original(n)) : (n.textContent ?? '')))
          .join(''),
      )
      .join('\n');
    const found = [...pg.querySelectorAll<HTMLElement>('mark[data-tip]:not(.mark-cont)')].map((m) => `${m.dataset.tip!.split('｜')[0]}|${original(m)}`);
    const pt = (v: string) => parseFloat(v.split('*')[1]);
    const pictures = [...pg.querySelectorAll<HTMLElement>('.pdf-picture')].map((f) => ({ left: pt(f.style.left), top: pt(f.style.top), width: pt(f.style.width), height: pt(f.style.height) }));
    return { text, found, pictures, height: Number(pg.style.getPropertyValue('--h')) };
  }),
);
await browser.close();

const key = ([c, v]: [string, string]) => `${c}|${v}`;
const rows = answer.pages.map((truth, i) => {
  const got = read[i];
  const chars = characters(truth.text, got.text);
  const found = new Set(got.found);
  const printed = truth.planted.map(key);
  const hand = truth.handwritten.map(key);
  const expected = new Set([...printed, ...hand]);
  // A value found under another category, or one the key lists for manual adding, is not a false alarm.
  const values = new Set([...printed, ...hand].map((k) => k.split('|')[1]).concat(truth.manual));
  const extra = [...found].filter((f) => !expected.has(f) && !values.has(f.split('|')[1]));
  const missedValues = [...printed, ...hand].filter((k) => !found.has(k));
  // A value read with a character or two wrong (徐語妤 → 徐語即) is still masked where it stands.
  const close = (f: string, m: string) => {
    const [[fc, fv], [mc, mv]] = [f.split('|'), m.split('|')];
    return fc === mc && editDistance(fv, mv) <= Math.max(1, Math.round(mv.length * 0.2));
  };
  const misread = extra.filter((f) => missedValues.some((m) => close(f, m)));
  const falsePositives = extra.filter((f) => !misread.includes(f));
  const pictures = got.pictures.map((p) => ({ x: p.left, y: got.height - p.top - p.height, width: p.width, height: p.height }));
  const matchedPictures = truth.pictures.filter((t) => pictures.some((p) => iou(t, p) >= 0.5)).length;
  return {
    page: i + 1,
    title: truth.title,
    charRecall: chars.same / chars.truth,
    charPrecision: chars.same / Math.max(1, chars.read),
    printed: [printed.filter((k) => found.has(k)).length, printed.length],
    handwritten: [hand.filter((k) => found.has(k)).length, hand.length],
    misread,
    falsePositives,
    pictures: [matchedPictures, truth.pictures.length, pictures.length - matchedPictures],
    missedValues,
    missingChars: chars.missing,
    extraChars: chars.extra,
    chars,
  };
});

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((n, r) => n + f(r), 0);
console.log(`\n掃描範例辨識評分（${answer.source}，${seconds.toFixed(1)} 秒）\n`);
console.log('頁 | 內容 | 字元召回 | 字元精確 | 印刷值 | 手寫值 | 讀錯仍遮蔽 | 誤判 | 圖片（多保留）');
for (const r of rows) {
  console.log(
    `${r.page} | ${r.title} | ${pct(r.charRecall)} | ${pct(r.charPrecision)} | ${r.printed[0]}/${r.printed[1]} | ${r.handwritten[0]}/${r.handwritten[1]} | ${r.misread.length} | ${r.falsePositives.length} | ${r.pictures[0]}/${r.pictures[1]}${r.pictures[2] ? `（+${r.pictures[2]}）` : ''}`,
  );
}
const total = {
  charRecall: sum((r) => r.chars.same) / sum((r) => r.chars.truth),
  charPrecision: sum((r) => r.chars.same) / sum((r) => r.chars.read),
  printed: [sum((r) => r.printed[0]), sum((r) => r.printed[1])],
  handwritten: [sum((r) => r.handwritten[0]), sum((r) => r.handwritten[1])],
  misread: sum((r) => r.misread.length),
  falsePositives: sum((r) => r.falsePositives.length),
  pictures: [sum((r) => r.pictures[0]), sum((r) => r.pictures[1]), sum((r) => r.pictures[2])],
  seconds,
};
console.log(
  `合計 | | ${pct(total.charRecall)} | ${pct(total.charPrecision)} | ${total.printed[0]}/${total.printed[1]}（${pct(total.printed[0] / total.printed[1])}） | ${total.handwritten[0]}/${total.handwritten[1]} | ${total.misread} | ${total.falsePositives} | ${total.pictures[0]}/${total.pictures[1]}${total.pictures[2] ? `（+${total.pictures[2]}）` : ''}`,
);
if (verbose) {
  for (const r of rows) {
    console.log(`\n第 ${r.page} 頁 ${r.title}`);
    if (r.missedValues.length) console.log('  漏抓：', r.missedValues.join('；'));
    if (r.misread.length) console.log('  讀錯仍遮蔽：', r.misread.join('；'));
    if (r.falsePositives.length) console.log('  誤判：', r.falsePositives.join('；'));
    console.log('  少讀的字：', r.missingChars.slice(0, 80) || '（無）');
    console.log('  多出的字：', r.extraChars.slice(0, 80) || '（無）');
  }
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ total, pages: rows.map(({ chars: _c, ...r }) => r) }, null, 2));
