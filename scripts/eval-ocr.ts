// Scores scanned-PDF recognition in the real site against the samples' answer keys
// (tests/fixtures/*.answer.json, written by `npm run examples`).
// Prerequisite: the built site served at BASE_URL (default: `npm run build && npm run preview` → http://localhost:4173/).
// Run: npm run eval:ocr   (options after `--`: --sample main|angles|all, --verbose, --json out.json)
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer, { type Browser } from 'puppeteer-core';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4173/';
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const args = process.argv.slice(2);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const verbose = args.includes('--verbose');
const jsonOut = option('--json');
const which = option('--sample') ?? 'all';
const SAMPLES = { main: 'tests/fixtures/scanned-sample.answer.json', angles: 'tests/fixtures/scan-angles.answer.json' };

type Rgb = [number, number, number];
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Rule {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  dashed?: boolean;
}
interface AnswerPage {
  title: string;
  planted: [string, string][];
  handwritten: [string, string][];
  manual: string[];
  text: string;
  pictures: Box[];
  rules: Rule[];
  fills: (Box & { color: Rgb })[];
  checkboxes: { x: number; y: number; size: number; checked: boolean }[];
  rotation?: string;
}
interface Answer {
  source: string;
  pages: AnswerPage[];
}

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

const horizontal = (r: Rule) => Math.abs(r.y2 - r.y1) <= Math.abs(r.x2 - r.x1);
/** How much of `a` lies along `b`: same direction, within 3pt across, measured along `a`. */
function along(a: Rule, b: Rule): number {
  if (horizontal(a) !== horizontal(b)) return 0;
  const [pa, pb] = horizontal(a) ? [(a.y1 + a.y2) / 2, (b.y1 + b.y2) / 2] : [(a.x1 + a.x2) / 2, (b.x1 + b.x2) / 2];
  if (Math.abs(pa - pb) > 3) return 0;
  const span = (r: Rule) => (horizontal(r) ? [Math.min(r.x1, r.x2), Math.max(r.x1, r.x2)] : [Math.min(r.y1, r.y2), Math.max(r.y1, r.y2)]);
  const [[a0, a1], [b0, b1]] = [span(a), span(b)];
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)) / Math.max(1, a1 - a0);
}
/** The share of `t` covered by the union of found rules (a long border may be found in pieces). */
function covered(t: Rule, found: Rule[]): number {
  return Math.min(1, found.reduce((n, f) => n + along(t, f), 0));
}

/** Loads a sample in the site and reads back, per page, what it recognised and redrew. */
async function readSite(browser: Browser, source: string) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('dialog', (d) => void d.accept());
  await page.goto(BASE_URL, { waitUntil: 'load' });
  const started = Date.now();
  const input = await page.waitForSelector('.process-view input[type=file]');
  await input!.uploadFile(resolve(source));
  await page.waitForSelector('.badge-ocr', { timeout: 600000 });
  const seconds = (Date.now() - started) / 1000;
  // tsx wraps named arrow functions in a `__name` helper that does not exist inside the page.
  await page.evaluate('globalThis.__name = (f) => f');
  const pages = await page.evaluate(() =>
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
      const height = Number(pg.style.getPropertyValue('--h'));
      const pictures = [...pg.querySelectorAll<HTMLElement>('.pdf-picture')].map((f) => ({ x: pt(f.style.left), y: height - pt(f.style.top) - pt(f.style.height), width: pt(f.style.width), height: pt(f.style.height) }));
      const nums = (el: Element, name: string) => (el.getAttribute(name) ?? '').split(',').map(Number);
      const rules = [...pg.querySelectorAll('[data-rule]')].map((el) => {
        const [x1, y1, x2, y2] = nums(el, 'data-rule');
        return { x1, y1, x2, y2 };
      });
      const fills = [...pg.querySelectorAll('[data-fill]')].map((el) => {
        const [x, y, width, h, r, g, b] = nums(el, 'data-fill');
        return { x, y, width, height: h, color: [r, g, b] };
      });
      const checkboxes = [...pg.querySelectorAll('[data-checkbox]')].map((el) => {
        const [x, y, size, checked] = nums(el, 'data-checkbox');
        return { x, y, size, checked: checked === 1 };
      });
      // Text runs as drawn: glyphs span from 0.12 em below the baseline to 0.88 em above it.
      const runs = [...pg.querySelectorAll<HTMLElement>('.pdf-item')].map((s) => {
        const size = pt(s.style.fontSize);
        const top = pt(s.style.top) - 0.08 * size;
        return { x0: pt(s.style.left), x1: pt(s.style.left) + Number(s.dataset.w), y0: top, y1: top + size, text: s.textContent ?? '' };
      });
      const overlaps = runs.flatMap((a, i) =>
        runs.slice(i + 1).filter((b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 1 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5).map((b) => `${a.text.slice(0, 12)}／${b.text.slice(0, 12)}`),
      );
      return { text, found, pictures, rules, fills, checkboxes, overlaps };
    }),
  );
  await page.close();
  return { seconds, pages };
}

const key = ([c, v]: [string, string]) => `${c}|${v}`;
type Read = Awaited<ReturnType<typeof readSite>>['pages'][number];

function score(truth: AnswerPage, got: Read, page: number) {
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
    // Spacing is not a misreading (OCR reads 80 年5月1日 for 80 年 5 月 1 日).
    const [a, b] = [fv.replace(/\s/g, ''), mv.replace(/\s/g, '')];
    return fc === mc && editDistance(a, b) <= Math.max(1, Math.round(b.length * 0.2));
  };
  const misread = extra.filter((f) => missedValues.some((m) => close(f, m)));
  const falsePositives = extra.filter((f) => !misread.includes(f));
  const matchedPictures = truth.pictures.filter((t) => got.pictures.some((p) => iou(t, p) >= 0.5)).length;
  const rulesFound = truth.rules.filter((t) => covered(t, got.rules) >= 0.8).length;
  const rulesRight = got.rules.filter((r) => covered(r, truth.rules) >= 0.5).length;
  const colourClose = (a: Rgb, b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i]))) <= 40;
  const fillsFound = truth.fills.filter((t) => got.fills.some((f) => iou(t, f) >= 0.5 && colourClose(t.color, f.color))).length;
  const near = (a: { x: number; y: number; size: number }, b: { x: number; y: number; size: number }) =>
    Math.hypot(a.x + a.size / 2 - b.x - b.size / 2, a.y + a.size / 2 - b.y - b.size / 2) <= 4;
  const boxesFound = truth.checkboxes.filter((t) => got.checkboxes.some((c) => near(t, c)));
  const boxesRight = truth.checkboxes.filter((t) => got.checkboxes.some((c) => near(t, c) && c.checked === t.checked));
  return {
    page,
    title: truth.title,
    rotation: truth.rotation ?? '',
    chars,
    charRecall: chars.same / Math.max(1, chars.truth),
    charPrecision: chars.same / Math.max(1, chars.read),
    printed: [printed.filter((k) => found.has(k)).length, printed.length],
    handwritten: [hand.filter((k) => found.has(k)).length, hand.length],
    misread,
    falsePositives,
    pictures: [matchedPictures, truth.pictures.length, got.pictures.length - matchedPictures],
    rules: [rulesFound, truth.rules.length, rulesRight, got.rules.length],
    fills: [fillsFound, truth.fills.length, got.fills.length],
    checkboxes: [boxesFound.length, boxesRight.length, truth.checkboxes.length, got.checkboxes.length],
    overlaps: got.overlaps,
    missedValues,
  };
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const ratio = (a: number, b: number) => (b ? `${a}/${b}` : '—');
const boxes = (c: number[]) => (c[2] ? `${c[0]}／${c[1]}／${c[2]}${c[3] > c[0] ? `（多 ${c[3] - c[0]}）` : ''}` : c[3] ? `（多 ${c[3]}）` : '—');

const browser = await puppeteer.launch({ executablePath: CHROME });
const report: Record<string, unknown> = {};
try {
  for (const [name, path] of Object.entries(SAMPLES)) {
    if (which !== 'all' && which !== name) continue;
    const answer: Answer = JSON.parse(readFileSync(path, 'utf8'));
    const { seconds, pages } = await readSite(browser, answer.source);
    const rows = answer.pages.map((t, i) => score(t, pages[i], i + 1));
    const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((n, r) => n + f(r), 0);
    console.log(`\n${answer.source}（${rows.length} 頁，${seconds.toFixed(1)} 秒）\n`);
    if (name === 'main') {
      console.log('頁 | 內容 | 字元召回 | 字元精確 | 印刷值 | 手寫值 | 讀錯仍遮蔽 | 誤判 | 圖片 | 線段召回 | 線段精確 | 底色 | 勾選框（找到／狀態對／原稿） | 文字重疊');
      for (const r of rows) {
        console.log(
          `${r.page} | ${r.title} | ${pct(r.charRecall)} | ${pct(r.charPrecision)} | ${ratio(r.printed[0], r.printed[1])} | ${ratio(r.handwritten[0], r.handwritten[1])} | ${r.misread.length} | ${r.falsePositives.length} | ${ratio(r.pictures[0], r.pictures[1])}${r.pictures[2] ? `（+${r.pictures[2]}）` : ''} | ${ratio(r.rules[0], r.rules[1])} | ${ratio(r.rules[2], r.rules[3])} | ${ratio(r.fills[0], r.fills[1])}${r.fills[2] > r.fills[0] ? `（畫了 ${r.fills[2]}）` : ''} | ${boxes(r.checkboxes)} | ${r.overlaps.length}`,
        );
      }
      console.log(
        `合計 | | ${pct(sum((r) => r.chars.same) / sum((r) => r.chars.truth))} | ${pct(sum((r) => r.chars.same) / sum((r) => r.chars.read))} | ${sum((r) => r.printed[0])}/${sum((r) => r.printed[1])} | ${sum((r) => r.handwritten[0])}/${sum((r) => r.handwritten[1])} | ${sum((r) => r.misread.length)} | ${sum((r) => r.falsePositives.length)} | ${sum((r) => r.pictures[0])}/${sum((r) => r.pictures[1])} | ${sum((r) => r.rules[0])}/${sum((r) => r.rules[1])} | ${sum((r) => r.rules[2])}/${sum((r) => r.rules[3])} | ${sum((r) => r.fills[0])}/${sum((r) => r.fills[1])} | ${sum((r) => r.checkboxes[0])}／${sum((r) => r.checkboxes[1])}／${sum((r) => r.checkboxes[2])} | ${sum((r) => r.overlaps.length)}`,
      );
    } else {
      console.log('頁 | 內容 | 角度 | 字元召回 | 印刷值 | 線段召回 | 勾選框（找到／狀態對／原稿）');
      for (const r of rows) {
        console.log(`${r.page} | ${r.title} | ${r.rotation} | ${pct(r.charRecall)} | ${ratio(r.printed[0], r.printed[1])} | ${ratio(r.rules[0], r.rules[1])} | ${boxes(r.checkboxes)}`);
      }
    }
    if (verbose) {
      for (const r of rows) {
        console.log(`\n第 ${r.page} 頁 ${r.title} ${r.rotation}`);
        if (r.missedValues.length) console.log('  漏抓：', r.missedValues.join('；'));
        if (r.misread.length) console.log('  讀錯仍遮蔽：', r.misread.join('；'));
        if (r.falsePositives.length) console.log('  誤判：', r.falsePositives.join('；'));
        if (r.overlaps.length) console.log('  重疊的文字：', r.overlaps.join('；'));
        console.log('  少讀的字：', r.chars.missing.slice(0, 80) || '（無）');
        console.log('  多出的字：', r.chars.extra.slice(0, 80) || '（無）');
      }
    }
    report[name] = { seconds, pages: rows.map(({ chars: _c, ...r }) => r) };
  }
} finally {
  await browser.close();
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2));
