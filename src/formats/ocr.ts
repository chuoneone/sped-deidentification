import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type Tesseract from 'tesseract.js';
import type { PdfCheckbox, PdfFill, PdfPicture, PdfRule, Rgb } from '../core/types';
import { isValidTaxId, isValidTwId } from '../core/twid';
import type { PdfPage, PdfTextItem } from './pdf';
import { eraseRules, estimateSkew, findCheckboxes, findFills, findRules, lineOrientation, paperTone, textColour } from './layout-scan';

/** What the recognition screen shows (see specs/004-scanned-pdf-ocr/contracts/ocr-progress-ui.md). */
export interface OcrProgress {
  /** 'engine': downloading and starting the recogniser; 'recognize': reading page `page`. */
  stage: 'engine' | 'recognize';
  /** Within a page: straightening it, reading its text, or analysing its layout. */
  step?: 'orient' | 'read' | 'layout';
  page: number;
  pages: number;
  /** Overall progress, 0–1. */
  progress: number;
  /** Small JPEG data URL of the page being read. */
  thumbnail?: string;
}

export interface OcrOptions {
  signal?: AbortSignal;
  onProgress?: (p: OcrProgress) => void;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
/** The subset of Tesseract's word / line output used here. */
export interface OcrWord {
  text: string;
  confidence: number;
  bbox: Box;
}
export interface OcrLine {
  words: OcrWord[];
  bbox: Box;
  baseline?: Box;
  rowAttributes?: { rowHeight: number };
}
/** RGBA pixels, as in ImageData. */
export interface Raster {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const RENDER_SCALE = 3; // ≈216 DPI for A4
const MAX_SIDE = 4000; // px, keeps the canvas memory bounded for large pages
const THUMB_WIDTH = 160;

/** A gap wider than this many row heights starts a new run (table cell, form field, side-by-side card). */
const SPLIT_GAP = 1.5;
/** Next to a CJK character, only a gap wider than this many row heights is a space (e.g. a fullwidth one). */
const SPACE_GAP = 0.8;
/** Digit groups closer than this many row heights are one number split by the recogniser. */
const NUMBER_GAP = 0.2;
/** Below this confidence a word made only of symbols is treated as noise. */
const MIN_SYMBOL_CONFIDENCE = 60;
/** CJK ideographs, kana, bopomofo, CJK punctuation and fullwidth forms. */
const WIDE = /[⺀-鿿豈-﫿︰-﹏＀-￯]/u;
/** One Chinese character (not punctuation). */
const HAN = /^\p{Script=Han}$/u;
/** A word of Chinese characters only. */
const HAN_WORD = /^\p{Script=Han}+$/u;
const SYMBOLS_ONLY = /^[^\p{L}\p{N}]+$/u;
/** Table borders and underlines read as characters. */
const RULE_CHARS = /[|｜_＿=~]/u;
/** Rules and quote marks stuck to the ends of a Latin/digit word by a nearby cell border. */
const EDGE_NOISE = /^[|｜]+|[|｜]+$|^[「“"]+(?=[A-Za-z0-9])|(?<=[A-Za-z0-9.])[」”"]+$/gu;

// ---------------------------------------------------------------------------------------
// Pattern-guided correction: letters read in place of digits in ID / phone / tax numbers.
// ---------------------------------------------------------------------------------------
const AS_DIGIT: Record<string, string> = { O: '0', o: '0', D: '0', Q: '0', I: '1', l: '1', i: '1', '|': '1', Z: '2', z: '2', S: '5', s: '5', G: '6', B: '8', g: '9', q: '9' };
const NUMBER_LIKE = /(?<![0-9A-Za-z|])[0-9A-Za-z|][0-9A-Za-z|-]{7,13}(?![0-9A-Za-z|])/g;
const PHONE = /^(?:09\d{2}-?\d{3}-?\d{3}|0\d{1,3}-?\d{3,4}-?\d{3,4})$/;
const toDigits = (s: string) => s.replace(/./g, (c) => AS_DIGIT[c] ?? c);

/**
 * Reads look-alike letters as digits (I→1, O→0, g→9, …) inside tokens that then become a valid
 * national ID (checksum), phone number or tax ID (checksum). Anything that does not validate is left
 * as recognised, so ordinary words are never touched. Lengths never change.
 */
export function fixConfusables(text: string): string {
  return text.replace(NUMBER_LIKE, (t) => {
    const bare = t.replace(/-/g, '');
    if (!/[A-Za-z|]/.test(bare) || (bare.match(/\d/g)?.length ?? 0) < bare.length * 0.6) return t;
    if (/^[A-Za-z]/.test(t) && bare.length === 10 && !t.includes('-')) {
      const id = t[0].toUpperCase() + toDigits(t.slice(1));
      return isValidTwId(id) ? id : t;
    }
    const digits = toDigits(t);
    if (!/^[\d-]+$/.test(digits)) return t;
    if (PHONE.test(digits) || (/^\d{8}$/.test(digits) && isValidTaxId(digits))) return digits;
    return t;
  });
}

/**
 * Turns recognised lines (canvas pixels, origin top-left) into positioned text runs (PDF points,
 * origin bottom-left, y = baseline). Each line is cut where words are far apart, so table cells and
 * form fields keep their own position; CJK characters inside a run are joined without spaces.
 */
export function ocrLinesToItems(
  lines: OcrLine[],
  scale: number,
  pageHeight: number,
  { colourOf, walls = [] }: { colourOf?: (box: Box) => Rgb | undefined; walls?: Box[] } = {},
): PdfTextItem[] {
  const items: PdfTextItem[] = [];
  for (const line of lines) {
    const h = line.rowAttributes?.rowHeight || line.bbox.y1 - line.bbox.y0;
    const words = line.words
      .filter((w) => {
        const t = w.text.trim();
        return !(SYMBOLS_ONLY.test(t) && (RULE_CHARS.test(t) || w.confidence < MIN_SYMBOL_CONFIDENCE));
      })
      .map((w) => ({ ...w, text: w.text.trim().replace(EDGE_NOISE, '') }))
      .filter((w) => w.text.length > 0);
    const bl = line.baseline;
    const baselineAt = (x: number) => (bl && bl.x1 > bl.x0 ? bl.y0 + ((x - bl.x0) * (bl.y1 - bl.y0)) / (bl.x1 - bl.x0) : line.bbox.y1);

    let run: OcrWord[] = [];
    const flush = () => {
      if (run.length === 0) return;
      let text = run[0].text;
      for (let i = 1; i < run.length; i++) {
        const a = run[i - 1];
        const b = run[i];
        // Tesseract splits Latin words only at spaces; CJK comes one character per word and needs none.
        // A number it cut in two (0918-1 54-331) is rejoined when the pieces nearly touch.
        const gap = b.bbox.x0 - a.bbox.x1;
        const latin = !WIDE.test(a.text.at(-1)!) && !WIDE.test(b.text[0]);
        const number = /[\d-]$/.test(a.text) && /^[\d-]/.test(b.text) && gap < NUMBER_GAP * h;
        text += ((latin && !number) || gap > SPACE_GAP * h ? ' ' : '') + b.text;
      }
      const first = run[0].bbox;
      // A line can join runs of different sizes (a printed label beside a large handwritten note), so
      // a run is never drawn larger than its own tallest glyphs allow.
      const tallest = Math.max(...run.map((w) => w.bbox.y1 - w.bbox.y0));
      // Chinese characters fill about 0.95 em: a steadier measure than the row height, which
      // includes the line spacing (≈1.24 em) and drew Chinese text a fifth too large.
      const han = run.filter((w) => HAN_WORD.test(w.text)).map((w) => w.bbox.y1 - w.bbox.y0);
      const byHan = han.length >= 2 ? median(han) / HAN_EM : Infinity;
      // …nor below its own glyphs: such a line's baseline belongs to the larger neighbour.
      const bottom = Math.max(...run.map((w) => w.bbox.y1));
      const color = colourOf?.({ x0: first.x0, y0: Math.min(...run.map((w) => w.bbox.y0)), x1: run.at(-1)!.bbox.x1, y1: bottom });
      items.push({
        ...(color && { color }),
        text: fixConfusables(text),
        x: first.x0 / scale,
        y: pageHeight - Math.min(baselineAt(first.x0), bottom) / scale,
        fontSize: Math.min(h, tallest * 1.2, byHan) / scale,
        width: (run.at(-1)!.bbox.x1 - first.x0) / scale,
      });
      run = [];
    };
    // A checkbox or a table's vertical rule between two words also ends the run.
    const walled = (a: Box, b: Box) => walls.some((v) => v.x0 >= a.x1 - h * 0.2 && v.x1 <= b.x0 + h * 0.2 && v.y0 < Math.max(a.y1, b.y1) && v.y1 > Math.min(a.y0, b.y0));
    for (const w of words) {
      const prev = run.at(-1);
      if (prev && (w.bbox.x0 - prev.bbox.x1 > SPLIT_GAP * h || walled(prev.bbox, w.bbox))) flush();
      run.push(w);
    }
    flush();
  }
  separateLines(items);
  return items;
}

/** Ink height of a Chinese character, in em; glyphs reach 0.12 em below the baseline and 0.88 above. */
const HAN_EM = 0.95;
const DESCENT = 0.12;
const ASCENT = 0.88;

/**
 * Shrinks runs whose glyphs would reach into the run above them (cramped lines on a business card,
 * a baseline misjudged on a tilted one): the lower run alone when that keeps most of its size,
 * otherwise both. Runs side by side on one line are not stacked and are left alone.
 */
function separateLines(items: PdfTextItem[]): void {
  for (const a of items) {
    for (const b of items) {
      const pitch = b.y - a.y; // b is the upper run
      if (pitch <= Math.min(a.fontSize, b.fontSize) * 0.3 || Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) <= 1) continue;
      const need = ASCENT * a.fontSize + DESCENT * b.fontSize;
      if (need <= pitch) continue;
      const lower = (pitch - DESCENT * b.fontSize) / ASCENT;
      if (lower >= a.fontSize * 0.6) a.fontSize = lower;
      else [a.fontSize, b.fontSize] = [(a.fontSize * pitch) / need, (b.fontSize * pitch) / need];
    }
  }
}

// ---------------------------------------------------------------------------------------
// Image analysis on the rendered page (pure functions over RGBA pixels).
// ---------------------------------------------------------------------------------------
const luminance = (d: Uint8ClampedArray, i: number) => (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;

/**
 * Greys the page for recognition with saturated colour counted as ink: grey = luminance − ½·chroma.
 * Orange or green print (luminance ≈140) would otherwise come out as faint grey and be misread, while
 * a pale highlighter stays pale and black-on-white is unchanged.
 */
export function deepenColour(img: Raster): void {
  const { data } = img;
  for (let i = 0; i < data.length; i += 4) {
    const chroma = Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
    data[i] = data[i + 1] = data[i + 2] = Math.max(0, luminance(data, i) - chroma / 2);
  }
}

/**
 * Whitens long straight dark runs (table borders, underlines, form boxes) so they are not read as
 * 「|」「_」 or merged into the text next to them. Character strokes are far shorter than `minRun`.
 */
export function removeRules(img: Raster, minRun = Math.max(80, Math.round(img.width * 0.05))): void {
  const { data, width: w, height: h } = img;
  const dark = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) dark[p] = luminance(data, p * 4) < 160 ? 1 : 0;
  const erase = new Uint8Array(w * h);
  const mark = (p: number) => {
    if (p >= 0 && p < w * h) erase[p] = 1;
  };
  for (let y = 0; y < h; y++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const on = x < w && dark[y * w + x] === 1;
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        if (x - start >= minRun) for (let k = start; k < x; k++) [-w, 0, w].forEach((o) => mark(y * w + k + o)); // with the anti-aliased rows beside it
        start = -1;
      }
    }
  }
  for (let x = 0; x < w; x++) {
    let start = -1;
    for (let y = 0; y <= h; y++) {
      const on = y < h && dark[y * w + x] === 1;
      if (on && start < 0) start = y;
      if (!on && start >= 0) {
        if (y - start >= minRun) for (let k = start; k < y; k++) [-1, 0, 1].forEach((o) => x + o >= 0 && x + o < w && mark(k * w + x + o));
        start = -1;
      }
    }
  }
  for (let p = 0; p < w * h; p++) if (erase[p]) data[p * 4] = data[p * 4 + 1] = data[p * 4 + 2] = 255;
}

const PICTURE_CELL = 12; // px
/** Smallest picture kept, as a share of the page area; smaller marks (icons, bullets, bold glyphs) are dropped. */
const MIN_PICTURE_AREA = 0.0015;
/** Pictures are at least this many cells on each side and no more elongated than this (rules are). */
const MIN_PICTURE_CELLS = 4;
const MAX_PICTURE_ASPECT = 6;
/** Share of a region's cells that must be inked: photos and emblems ≈0.6–1, stamps and frames ≈0.2. */
const MIN_PICTURE_FILL = 0.35;
/** Cells a picture may grow on each side into its pale edges, stopping at any recognised word. */
const MAX_PICTURE_GROWTH = 4;

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const area = (b: Box) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const intersection = (a: Box, b: Box): Box => ({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });
/** A word lying mostly inside a picture is the recogniser misreading the picture itself (an emblem read as「0」). */
export const insidePicture = (word: Box, picture: Box): boolean => area(intersection(word, picture)) >= area(word) * 0.5;

/**
 * A region holds text if any word in it reads this confidently: real text (printed or handwritten)
 * reads at 85+, the texture of a photo or emblem at most ≈70.
 */
const PICTURE_TEXT_CONFIDENCE = 80;
/**
 * …or if it holds this many letter/number words read at least half-confidently (a note written on a
 * coloured sticker); the texture of a photo yields scattered fragments mostly below that.
 */
const PICTURE_MAX_WORDS = 3;
const PICTURE_WORD_CONFIDENCE = 60;

/** Whether the words found in or on a region show that it holds text. */
export function holdsText(region: Box, words: OcrWord[]): boolean {
  const touching = words.filter((w) => overlaps(w.bbox, region) && /[\p{L}\p{N}]/u.test(w.text));
  return (
    touching.filter((w) => w.confidence >= PICTURE_WORD_CONFIDENCE).length >= PICTURE_MAX_WORDS ||
    touching.some((w) => w.confidence >= PICTURE_TEXT_CONFIDENCE || !insidePicture(w.bbox, region))
  );
}

/**
 * Regions that look like pictures (photos, emblems): solidly inked areas holding no text. Thin
 * strokes (text, handwriting, stamps, rules) never fill a cell enough to count, and a region with a
 * confident word, a word crossing its edge or several words is rejected, so text is not kept as an image.
 */
export function pictureCandidates(img: Raster, words: OcrWord[]): Box[] {
  const { data, width: w, height: h } = img;
  const cols = Math.ceil(w / PICTURE_CELL);
  const rows = Math.ceil(h / PICTURE_CELL);
  // Paper tone: a bright percentile of the page, so a tinted scan still has a "white".
  const hist = new Uint32Array(256);
  for (let p = 0; p < w * h; p += 7) hist[Math.round(luminance(data, p * 4))]++;
  let seen = 0;
  let paper = 255;
  const total = hist.reduce((a, b) => a + b, 0);
  for (let v = 255; v >= 0; v--) {
    seen += hist[v];
    if (seen >= total * 0.1) {
      paper = v;
      break;
    }
  }
  // `ink`: a solidly inked cell; `tint`: a cell with any visible mark, used to grow a picture to its
  // pale edges (the light half of an emblem, a photo's frame).
  const ink = new Uint8Array(cols * rows);
  const tint = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let n = 0;
      let hits = 0;
      let faint = 0;
      for (let y = r * PICTURE_CELL; y < Math.min(h, (r + 1) * PICTURE_CELL); y += 2) {
        for (let x = c * PICTURE_CELL; x < Math.min(w, (c + 1) * PICTURE_CELL); x += 2) {
          const i = (y * w + x) * 4;
          const chroma = Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
          const dark = paper - luminance(data, i);
          if (dark > 30 || chroma > 60) hits++;
          if (dark > 20 || chroma > 30) faint++;
          n++;
        }
      }
      ink[r * cols + c] = hits >= n * 0.5 ? 1 : 0;
      tint[r * cols + c] = faint >= n * 0.08 ? 1 : 0; // above paper grain and specks
    }
  }
  const cellBox = (ca: number, ra: number, cb: number, rb: number): Box => ({ x0: ca * PICTURE_CELL, y0: ra * PICTURE_CELL, x1: Math.min(w, (cb + 1) * PICTURE_CELL), y1: Math.min(h, (rb + 1) * PICTURE_CELL) });
  /** A strip of cells the picture may grow into: marked, and clear of words other than its own misreadings. */
  const canGrow = (core: Box, ca: number, ra: number, cb: number, rb: number): boolean => {
    if (ca < 0 || ra < 0 || cb >= cols || rb >= rows) return false;
    let marked = false;
    for (let r = ra; r <= rb && !marked; r++) for (let c = ca; c <= cb && !marked; c++) marked = tint[r * cols + c] === 1;
    const strip = cellBox(ca, ra, cb, rb);
    return marked && !words.some((wd) => overlaps(wd.bbox, strip) && !insidePicture(wd.bbox, core));
  };
  const seenCell = new Uint8Array(cols * rows);
  const out: Box[] = [];
  for (let start = 0; start < cols * rows; start++) {
    if (!ink[start] || seenCell[start]) continue;
    const stack = [start];
    seenCell[start] = 1;
    let count = 0;
    let [c0, r0, c1, r1] = [cols, rows, 0, 0];
    while (stack.length) {
      const cell = stack.pop()!;
      const c = cell % cols;
      const r = (cell - c) / cols;
      count++;
      [c0, r0, c1, r1] = [Math.min(c0, c), Math.min(r0, r), Math.max(c1, c), Math.max(r1, r)];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
          const n = nr * cols + nc;
          if (ink[n] && !seenCell[n]) {
            seenCell[n] = 1;
            stack.push(n);
          }
        }
      }
    }
    const [bc, br] = [c1 - c0 + 1, r1 - r0 + 1];
    if (area(cellBox(c0, r0, c1, r1)) < w * h * MIN_PICTURE_AREA) continue;
    if (Math.min(bc, br) < MIN_PICTURE_CELLS || Math.max(bc, br) > MAX_PICTURE_ASPECT * Math.min(bc, br)) continue;
    if (count < bc * br * MIN_PICTURE_FILL) continue; // a frame, stamp or scattered marks, not a solid picture
    if (bc > cols * 0.9 && br > rows * 0.9) continue; // a tinted page background
    const core = cellBox(c0, r0, c1, r1);
    for (let i = 0; i < MAX_PICTURE_GROWTH; i++) {
      if (canGrow(core, c0 - 1, r0, c0 - 1, r1)) c0--;
      if (canGrow(core, c1 + 1, r0, c1 + 1, r1)) c1++;
      if (canGrow(core, c0, r0 - 1, c1, r0 - 1)) r0--;
      if (canGrow(core, c0, r1 + 1, c1, r1 + 1)) r1++;
    }
    const box = cellBox(c0, r0, c1, r1);
    if (holdsText(box, words)) continue;
    out.push(box);
  }
  return out;
}

const GAP_CELL = 8; // px
/** Line-shaped only (wider than tall): stamps are square and read as scrambled characters. */
const GAP_MIN_ASPECT = 1.8;
const GAP_MAX_REGIONS = 12;

/**
 * Inked, line-shaped regions that no recognised word covers: text the page-level layout analysis
 * skipped (a signature line beside a photo, a large letter-spaced name). Pictures in `skip` are left
 * out. Runs on the cleaned page, so rules are already gone.
 */
export function uncoveredText(img: Raster, words: Box[], skip: Box[]): Box[] {
  const { data, width: w, height: h } = img;
  const cols = Math.ceil(w / GAP_CELL);
  const rows = Math.ceil(h / GAP_CELL);
  const covered = [...words, ...skip].map((b) => ({ x0: b.x0 - GAP_CELL, y0: b.y0 - GAP_CELL, x1: b.x1 + GAP_CELL, y1: b.y1 + GAP_CELL }));
  const ink = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = { x0: c * GAP_CELL, y0: r * GAP_CELL, x1: (c + 1) * GAP_CELL, y1: (r + 1) * GAP_CELL };
      if (covered.some((b) => overlaps(b, cell))) continue;
      let dark = false;
      for (let y = cell.y0; y < Math.min(h, cell.y1) && !dark; y += 2) {
        for (let x = cell.x0; x < Math.min(w, cell.x1) && !dark; x += 2) dark = luminance(data, (y * w + x) * 4) < 150;
      }
      ink[r * cols + c] = dark ? 1 : 0;
    }
  }
  // Join the glyphs of a line: neighbours up to 3 cells apart sideways, 1 cell apart vertically.
  const seen = new Uint8Array(cols * rows);
  const out: (Box & { cells: number })[] = [];
  for (let start = 0; start < cols * rows; start++) {
    if (!ink[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let cells = 0;
    let [c0, r0, c1, r1] = [cols, rows, 0, 0];
    while (stack.length) {
      const cell = stack.pop()!;
      const c = cell % cols;
      const r = (cell - c) / cols;
      cells++;
      [c0, r0, c1, r1] = [Math.min(c0, c), Math.min(r0, r), Math.max(c1, c), Math.max(r1, r)];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -3; dc <= 3; dc++) {
          const [nc, nr] = [c + dc, r + dr];
          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
          const n = nr * cols + nc;
          if (ink[n] && !seen[n]) {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
    }
    const box = { x0: c0 * GAP_CELL, y0: r0 * GAP_CELL, x1: Math.min(w, (c1 + 1) * GAP_CELL), y1: Math.min(h, (r1 + 1) * GAP_CELL), cells };
    const [bw, bh] = [box.x1 - box.x0, box.y1 - box.y0];
    if (bh < 16 || bh > 200 || bw < 32 || cells < 6) continue; // specks, or a tall graphic
    if (bw < bh * GAP_MIN_ASPECT || bw * bh > w * h * 0.1) continue;
    out.push(box);
  }
  return out
    .sort((a, b) => b.cells - a.cells)
    .slice(0, GAP_MAX_REGIONS)
    .map(({ x0, y0, x1, y1 }) => ({ x0, y0, x1, y1 }));
}

/**
 * Where uncovered ink starts just before a line's first word (a list number 一、 the recogniser
 * dropped: alone it is a bare stroke), or null. Looks up to 2.5 row heights to the left, within the
 * line's height, at dark pixels that no clearly read word covers; the ink must reach to within a row
 * height of the word, as a list number does (a table's previous cell stands further off).
 */
export function leadingInk(img: Raster, line: Box, rowHeight: number, covered: Box[]): number | null {
  const { data, width: w, height: h } = img;
  const [x0, x1, y0, y1] = [Math.max(0, Math.round(line.x0 - rowHeight * 2.5)), Math.round(line.x0 - 2), Math.max(0, Math.round(line.y0)), Math.min(h, Math.round(line.y1))];
  const near = covered.filter((b) => b.x0 < x1 && b.x1 > x0 && b.y0 < y1 && b.y1 > y0);
  let [left, right, ink] = [Infinity, -Infinity, 0];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (luminance(data, (y * w + x) * 4) >= 150 || near.some((b) => x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1)) continue;
      ink++;
      [left, right] = [Math.min(left, x), Math.max(right, x)];
    }
  }
  return ink >= rowHeight && right >= line.x0 - rowHeight ? left : null;
}

// ---------------------------------------------------------------------------------------
// Browser side: render, recognise, second opinions, pictures.
// ---------------------------------------------------------------------------------------
/** Renders the page turned `deg` clockwise about its centre: a straightened scan is resampled only once. */
async function renderPage(page: PDFPageProxy, deg = 0): Promise<{ canvas: HTMLCanvasElement; scale: number; width: number; height: number }> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(RENDER_SCALE, MAX_SIDE / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const [w, h] = [Math.ceil(viewport.width), Math.ceil(viewport.height)];
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = Math.abs(Math.round(deg / 90)) % 2 === 1 ? [h, w] : [w, h];
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const [cos, sin] = [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
  const transform = [cos, sin, -sin, cos, canvas.width / 2 - (cos * w - sin * h) / 2, canvas.height / 2 - (sin * w + cos * h) / 2];
  await page.render({ canvasContext: ctx, viewport, ...(deg !== 0 && { transform }) }).promise;
  return { canvas, scale, width: base.width, height: base.height };
}

function thumbnailOf(canvas: HTMLCanvasElement): string {
  const t = document.createElement('canvas');
  t.width = THUMB_WIDTH;
  t.height = Math.round((THUMB_WIDTH * canvas.height) / canvas.width);
  t.getContext('2d')!.drawImage(canvas, 0, 0, t.width, t.height);
  return t.toDataURL('image/jpeg', 0.7);
}

/** A copy of part of a canvas, optionally enlarged (small, so handing it to the recogniser is cheap). */
function crop(src: HTMLCanvasElement, b: Box, zoom = 1): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const [w, h] = [Math.max(1, Math.round(b.x1 - b.x0)), Math.max(1, Math.round(b.y1 - b.y0))];
  [c.width, c.height] = [w * zoom, h * zoom];
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, b.x0, b.y0, w, h, 0, 0, c.width, c.height);
  return c;
}

const pad = (b: Box, by: number, w: number, h: number): Box => ({ x0: Math.max(0, b.x0 - by), y0: Math.max(0, b.y0 - by), x1: Math.min(w, b.x1 + by), y1: Math.min(h, b.y1 + by) });
const linesOf = (data: Tesseract.Page): OcrLine[] => (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1] ?? 0;

/** What the recogniser makes of an empty (口) or ticked (了) checkbox; another Chinese character read this confidently is a framed character. */
const BOX_LOOKALIKES = /^[口囗□了]$/u;
const CHARACTER_CONFIDENCE = 85;
/** Skews smaller than this are left alone (estimateSkew's resolution). */
const MIN_SKEW = 0.1;
/**
 * A page tilted less than this is recognised as scanned: the recogniser copes with a slight tilt, and
 * redrawing the page only shifts which characters it misreads. Its layout is still found on a
 * straightened copy, since rules must run straight to be found.
 */
const READ_SKEW = 1;
/** A page read with less average confidence than this is tried upside down. */
const UPSIDE_DOWN_CONFIDENCE = 60;

/** The canvas turned by `deg` clockwise: quarter turns swap the sides, other angles keep the size. */
function rotateCanvas(src: HTMLCanvasElement, deg: number): HTMLCanvasElement {
  const quarter = Math.abs(deg % 180) === 90;
  const c = document.createElement('canvas');
  [c.width, c.height] = quarter ? [src.height, src.width] : [src.width, src.height];
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

const pixelsOf = (c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
const readable = (w: OcrWord) => /[\p{L}\p{N}]/u.test(w.text);
/** Average confidence of the letter/number words of some lines (0 when there are none). */
const confidenceOf = (lines: OcrLine[]) => {
  const words = lines.flatMap((l) => l.words).filter(readable);
  return words.length ? mean(words.map((w) => w.confidence)) : 0;
};

/** Latin words read with less confidence than this get a second, Chinese-only reading of their region. */
const RECHECK_CONFIDENCE = 70;
/** …and so do 1–3 letter Latin fragments in a Chinese line below this (丁承 read as「TR」at 74). */
const SHORT_LATIN_CONFIDENCE = 90;
/**
 * Single Chinese characters below this (函 read as「闊」at 0) get one too, at most CJK_RECHECK_MAX a
 * page, and take it only when it is clearly better: an unsure name character (婷 at 20) is often right.
 */
const CJK_RECHECK_CONFIDENCE = 10;
const CJK_RECHECK_MARGIN = 15;
const CJK_RECHECK_MAX = 20;
/** Lines whose start is read again with the uncovered ink before it (list numbers), at most this many a page. */
const LEADING_MAX = 15;
/** Page-pass words below this confidence are treated as unread when looking for skipped text. */
const GAP_COVER_CONFIDENCE = 30;
/** A line read in a skipped region is kept if any word in it reads this confidently (else speckle noise). */
const GAP_WORD_CONFIDENCE = 60;
/** The second reading looks at the word as is and enlarged (CJK names read better enlarged, IDs often as is). */
const RECHECK_ZOOMS = [1, 2];
/** A Latin/digit second reading must beat the first by this much; a Chinese one just has to beat it. */
const RECHECK_MARGIN = 10;

/**
 * Recognises every page of an image-only PDF in the browser (Traditional Chinese + English), and cuts
 * out text-free pictures to keep in the output. Rejects with an AbortError as soon as `signal`
 * aborts; the recognisers are always shut down.
 */
export async function recognizePdf(pdf: PDFDocumentProxy, { signal, onProgress }: OcrOptions = {}): Promise<PdfPage[]> {
  const abortError = () => new DOMException('已取消辨識', 'AbortError');
  if (signal?.aborted) throw abortError();
  // Neither recognize() nor createWorker() can be interrupted: race them against the signal and
  // terminate the workers afterwards.
  let fail!: (e: unknown) => void;
  const aborted = new Promise<never>((_, reject) => (fail = reject));
  aborted.catch(() => {});
  signal?.addEventListener('abort', () => fail(abortError()), { once: true });
  const race = <T>(p: Promise<T>): Promise<T> => Promise.race([p, aborted]);

  const pages = pdf.numPages;
  let page = 0;
  let thumbnail: string | undefined;
  onProgress?.({ stage: 'engine', page, pages, progress: 0 });

  const { createWorker, OEM, PSM } = (await race(import('tesseract.js'))).default;
  // Served by this site (vite.config.ts ocrAssets), never from a CDN; absolute because the worker runs from a blob URL.
  const assets = new URL(`${import.meta.env.BASE_URL}ocr/`, document.baseURI).href;
  const options = {
    workerPath: `${assets}worker.min.js`,
    corePath: `${assets}core/`,
    langPath: `${assets}lang`,
    // Only pattern settings may live in browser storage (constitution); rely on the HTTP cache.
    cacheMethod: 'none',
  };
  const starting = createWorker(['chi_tra', 'eng'], OEM.LSTM_ONLY, {
    ...options,
    logger: (m) => {
      if (page > 0 && m.status === 'recognizing text') {
        onProgress?.({ stage: 'recognize', page, pages, progress: (page - 1 + m.progress) / pages, thumbnail });
      }
    },
  });
  // Chinese-only, one line at a time: the second opinion for short CJK words the bilingual pass
  // read as Latin (a narrow column of names, say). Started on first use.
  const second: { worker?: Promise<Tesseract.Worker> } = {};
  const chineseWorker = () =>
    (second.worker ??= createWorker('chi_tra', OEM.LSTM_ONLY, options).then(async (w) => {
      await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
      return w;
    }));

  try {
    const worker = await race(starting);
    const out: PdfPage[] = [];
    for (page = 1; page <= pages; page++) {
      const pdfPage = await race(pdf.getPage(page));
      const rendered = await race(renderPage(pdfPage));
      const { scale } = rendered;
      thumbnail = thumbnailOf(rendered.canvas);
      const report = (step: OcrProgress['step'], done = 0) => onProgress?.({ stage: 'recognize', step, page, pages, progress: (page - 1 + done) / pages, thumbnail });
      report('orient');

      // Straighten the page: a quarter turn when its text runs up and down, then the skew (rendered
      // again turned, rather than turning the rendered pixels, which would blur them).
      let canvas = rendered.canvas;
      const turn = lineOrientation(pixelsOf(canvas)) === 'vertical' ? 90 : 0;
      if (turn) canvas = rotateCanvas(canvas, turn);
      const skew = estimateSkew(pixelsOf(canvas));
      let level: HTMLCanvasElement | undefined; // the straightened copy of a slightly tilted page, for the layout
      if (Math.abs(skew) >= READ_SKEW) {
        if (canvas !== rendered.canvas) canvas.width = canvas.height = 0;
        canvas = (await race(renderPage(pdfPage, turn - skew))).canvas;
      } else if (Math.abs(skew) >= MIN_SKEW) level = (await race(renderPage(pdfPage, turn - skew))).canvas;

      // Rules are read from the page, then erased (with colour print darkened) from the copy that is
      // recognised; an upside-down page reads badly, so a poor first pass is tried turned around.
      const firstPass = async (source: HTMLCanvasElement) => {
        const pixels = pixelsOf(source);
        const rules = findRules(pixels);
        const cleaned = new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height);
        deepenColour(cleaned);
        removeRules(cleaned);
        eraseRules(cleaned, rules.filter((r) => r.dashed));
        const text = document.createElement('canvas');
        [text.width, text.height] = [source.width, source.height];
        text.getContext('2d')!.putImageData(cleaned, 0, 0);
        await race(worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO }));
        const lines = linesOf((await race(worker.recognize(text, {}, { blocks: true }))).data);
        return { canvas: source, pixels, rules, cleaned, text, lines, confidence: confidenceOf(lines) };
      };
      report('read');
      let pass = await firstPass(canvas);
      if (pass.confidence < UPSIDE_DOWN_CONFIDENCE) {
        const turned = await firstPass(rotateCanvas(canvas, 180));
        if (turned.confidence > pass.confidence + 15) {
          pass = turned;
          if (level) level = rotateCanvas(level, 180);
        }
      }
      const { pixels, rules, cleaned, text, lines } = pass;
      canvas = pass.canvas;
      const [width, height] = [canvas.width / scale, canvas.height / scale];
      // Found before the second opinions, which would otherwise "read" an emblem as a confident character.
      const candidates = pictureCandidates(pixels, lines.flatMap((l) => l.words));
      // Text the layout analysis skipped: read each uncovered line-shaped region on its own.
      // Faint misreadings (an orange company name read as「oA」) do not count as covering their region.
      const gaps = uncoveredText(cleaned, lines.flatMap((l) => l.words.filter((w) => w.confidence >= GAP_COVER_CONFIDENCE).map((w) => w.bbox)), candidates);
      /** Lines read from a region of the cleaned page, enlarged `zoom` times, back in page pixels. */
      const readAt = async (reader: Tesseract.Worker, area: Box, zoom = 1): Promise<OcrLine[]> => {
        const shift = (b: Box): Box => ({ x0: b.x0 / zoom + area.x0, y0: b.y0 / zoom + area.y0, x1: b.x1 / zoom + area.x0, y1: b.y1 / zoom + area.y0 });
        return linesOf((await race(reader.recognize(crop(text, area, zoom), {}, { blocks: true }))).data).map((l) => ({
          words: l.words.map((w) => ({ ...w, bbox: shift(w.bbox) })),
          bbox: shift(l.bbox),
          baseline: l.baseline && shift(l.baseline),
          rowAttributes: l.rowAttributes && { rowHeight: l.rowAttributes.rowHeight / zoom },
        }));
      };
      const clear = (found: OcrLine[]) => found.some((l) => l.words.some((w) => w.confidence >= GAP_WORD_CONFIDENCE));
      if (gaps.length > 0) {
        await race(worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK }));
        for (const gap of gaps) {
          const region = pad(gap, 8, text.width, text.height);
          // Letter-spaced large type (董　事　長) that the page pass did not see at all often reads only
          // enlarged. Under a faint misreading (游文瑜 as「WESC」) the second opinion below does better.
          let found = await readAt(worker, region);
          if (!clear(found) && lines.every((l) => l.words.every((w) => !overlaps(w.bbox, region)))) found = await readAt(worker, region, 2);
          for (const line of found) {
            // A line counts once something in it reads clearly; then its CJK characters stay even when
            // unsure (廖宜婷 with 婷 at 20), Latin fragments only when clear (they get a second opinion next).
            if (!clear([line])) continue;
            const read = line.words.filter((w) => WIDE.test(w.text) || w.confidence >= GAP_WORD_CONFIDENCE / 2);
            // A new reading replaces the page pass's words under it only where it is more confident.
            const words = read.filter((n) => lines.every((l) => l.words.every((w) => !overlaps(n.bbox, w.bbox) || w.confidence < n.confidence)));
            if (words.length === 0) continue;
            for (const l of lines) l.words = l.words.filter((w) => !words.some((n) => overlaps(n.bbox, w.bbox)));
            lines.push({ ...line, words });
          }
        }
      }

      // A line's start read again with the ink just before it, which alone was too slight to read:
      // 一、 is a bare stroke, but「一、依據」reads. New words before the first one are added; unclear
      // words they cover (六 read as「人 大」) go.
      const coveredBy = () => lines.flatMap((l) => l.words.filter((w) => w.confidence >= GAP_COVER_CONFIDENCE).map((w) => w.bbox));
      const leading = lines
        .filter((l) => l.words.length > 0 && !candidates.some((c) => overlaps(c, l.bbox)))
        .map((l) => {
          const first = l.words.reduce((a, b) => (b.bbox.x0 < a.bbox.x0 ? b : a));
          const h = l.rowAttributes?.rowHeight || l.bbox.y1 - l.bbox.y0;
          return { l, first, h, ink: leadingInk(cleaned, { ...l.bbox, x0: first.bbox.x0 }, h, coveredBy()) };
        })
        .filter((c) => c.ink !== null)
        .slice(0, LEADING_MAX);
      if (leading.length > 0) {
        await race(worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE }));
        for (const { l, first, h, ink } of leading) {
          // About five characters of the line give the recogniser enough to go on.
          const area = pad({ x0: ink!, y0: l.bbox.y0, x1: Math.min(l.bbox.x1, first.bbox.x0 + h * 5), y1: l.bbox.y1 }, 8, text.width, text.height);
          const taken = coveredBy();
          const before = (found: OcrLine[]) =>
            found
              .flatMap((f) => f.words)
              .filter((w) => (w.bbox.x0 + w.bbox.x1) / 2 < first.bbox.x0 && WIDE.test(w.text) && w.confidence >= GAP_WORD_CONFIDENCE && !taken.some((b) => insidePicture(w.bbox, b)));
          let added = before(await readAt(worker, area));
          if (added.length === 0) added = before(await readAt(worker, area, 2));
          if (added.length === 0) continue;
          for (const o of lines) o.words = o.words.filter((w) => w.confidence >= GAP_COVER_CONFIDENCE || !added.some((n) => overlaps(n.bbox, w.bbox)));
          l.words = [...added, ...l.words];
          l.bbox = { ...l.bbox, x0: Math.min(l.bbox.x0, ...added.map((w) => w.bbox.x0)) };
        }
      }

      // Second opinions, Chinese only: unsure Latin words; short Latin fragments in a Chinese line
      // (handwritten 丁承 read as「TR」); single Chinese characters read almost blindly (函 as「闊」).
      let cjkRechecks = 0;
      for (const line of lines) {
        const chinese = line.words.some((w) => WIDE.test(w.text));
        for (let i = 0; i < line.words.length; i++) {
          const word = line.words[i];
          const latin = !WIDE.test(word.text) && !SYMBOLS_ONLY.test(word.text);
          const unsureLatin = latin && (word.confidence < RECHECK_CONFIDENCE || (chinese && /^[A-Za-z]{1,3}$/.test(word.text) && word.confidence < SHORT_LATIN_CONFIDENCE));
          const unsureChar = HAN.test(word.text) && word.confidence < CJK_RECHECK_CONFIDENCE && cjkRechecks < CJK_RECHECK_MAX;
          if (!unsureLatin && !unsureChar) continue;
          if (candidates.some((c) => insidePicture(word.bbox, c))) continue;
          if (unsureChar) cjkRechecks++;
          const area = pad(word.bbox, 6, text.width, text.height);
          let best: { words: OcrWord[]; confidence: number; zoom: number } | null = null;
          for (const zoom of RECHECK_ZOOMS) {
            const alt = linesOf((await race((await race(chineseWorker())).recognize(crop(text, area, zoom), {}, { blocks: true }))).data).flatMap((l) => l.words);
            const confidence = mean(alt.map((a) => a.confidence));
            const needed = unsureChar ? word.confidence + CJK_RECHECK_MARGIN : alt.every((a) => WIDE.test(a.text)) ? word.confidence : word.confidence + RECHECK_MARGIN;
            // A character stays a single character.
            const fits = !unsureChar || (alt.length === 1 && HAN.test(alt[0].text));
            if (alt.length > 0 && fits && confidence > needed && confidence > (best?.confidence ?? -1)) best = { words: alt, confidence, zoom };
          }
          if (!best) continue;
          const { zoom } = best;
          const at = (v: number, o: number) => v / zoom + o;
          const shifted = best.words.map((a) => ({ ...a, bbox: { x0: at(a.bbox.x0, area.x0), y0: at(a.bbox.y0, area.y0), x1: at(a.bbox.x1, area.x0), y1: at(a.bbox.y1, area.y0) } }));
          line.words.splice(i, 1, ...shifted);
          i += shifted.length - 1;
        }
      }

      const pictures: PdfPicture[] = [];
      if (candidates.length > 0) {
        await race(worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT }));
        for (const box of candidates) {
          // A second, sparse-text reading of just this region: text the page pass missed shows up here.
          const found = linesOf((await race(worker.recognize(crop(canvas, box), {}, { blocks: true }))).data).flatMap((l) => l.words);
          if (holdsText({ x0: 0, y0: 0, x1: box.x1 - box.x0, y1: box.y1 - box.y0 }, found)) continue;
          // The page pass's misreadings of the picture itself are not text.
          for (const line of lines) line.words = line.words.filter((w) => !insidePicture(w.bbox, box));
          const blob = await race(new Promise<Blob | null>((r) => crop(canvas, box).toBlob(r, 'image/jpeg', 0.9)));
          if (!blob) continue;
          pictures.push({
            x: box.x0 / scale,
            y: height - box.y1 / scale,
            width: (box.x1 - box.x0) / scale,
            height: (box.y1 - box.y0) / scale,
            jpeg: new Uint8Array(await blob.arrayBuffer()),
            keep: true,
          });
        }
      }

      // The layout is found on a straight page: the recognised one, or the straightened copy of a
      // slightly tilted one, turned back here into the recognised page's pixels (shapes keep their size).
      report('layout', 0.9);
      const straight = level ? pixelsOf(level) : pixels;
      const straightRules = level ? findRules(straight) : rules;
      const [cx, cy, cos, sin] = [canvas.width / 2, canvas.height / 2, Math.cos((skew * Math.PI) / 180), Math.sin((skew * Math.PI) / 180)];
      const back = (x: number, y: number) => (level ? [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos] : [x, y]);
      const moved = <T extends Box>(b: T): T => {
        const [mx, my] = back((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
        const [hw, hh] = [(b.x1 - b.x0) / 2, (b.y1 - b.y0) / 2];
        return { ...b, x0: mx - hw, y0: my - hh, x1: mx + hw, y1: my + hh };
      };
      // Checkboxes: square frames standing apart from the text around them (findCheckboxes); a framed
      // character the recogniser reads confidently as itself (國、回) is not one. Whatever it made of
      // a checkbox (口, O, [, 了) is dropped.
      const textHeight = median(lines.map((l) => l.rowAttributes?.rowHeight || l.bbox.y1 - l.bbox.y0)) || 30;
      const boxes = findCheckboxes(straight, textHeight)
        .map(moved)
        .filter((b) => {
          if (candidates.some((c) => overlaps(c, b))) return false;
          const within = lines.flatMap((l) => l.words).filter((w) => insidePicture(w.bbox, pad(b, 3, Infinity, Infinity)));
          return !within.some((w) => WIDE.test(w.text) && w.confidence >= CHARACTER_CONFIDENCE && !BOX_LOOKALIKES.test(w.text));
        });
      // A word read across a box and its label (☑男 as「Ms」,「[手」) keeps the label: the part beside
      // the box is read again, Chinese only, with the boxes (and a tick's tail above them) whited out.
      const boxOf = (w: OcrWord) => boxes.find((b) => insidePicture(w.bbox, pad(b, 3, Infinity, Infinity)) || area(intersection(w.bbox, b)) >= area(b) * 0.5);
      const spills = (w: OcrWord, b: Box) => Math.max(b.x0 - w.bbox.x0, w.bbox.x1 - b.x1) > (b.x1 - b.x0) * 0.3;
      if (lines.some((l) => l.words.some((w) => boxOf(w) && spills(w, boxOf(w)!)))) {
        const ctx = text.getContext('2d')!;
        ctx.fillStyle = '#fff';
        for (const b of boxes) {
          const side = b.x1 - b.x0;
          ctx.fillRect(b.x0 - 2, b.y0 - 2, side + 4, b.y1 - b.y0 + 4);
          ctx.fillRect(b.x0, b.y0 - side * 0.4, side * 1.3, side * 0.4);
        }
      }
      for (const line of lines) {
        const words: OcrWord[] = [];
        for (const w of line.words) {
          const b = boxOf(w);
          if (!b) words.push(w);
          else if (spills(w, b)) {
            const part = w.bbox.x1 - b.x1 >= b.x0 - w.bbox.x0 ? { ...w.bbox, x0: b.x1 } : { ...w.bbox, x1: b.x0 };
            const region = pad(part, 6, text.width, text.height);
            const zoom = 2;
            const read = linesOf((await race((await race(chineseWorker())).recognize(crop(text, region, zoom), {}, { blocks: true }))).data).flatMap((l) => l.words);
            const at = (v: number, o: number) => v / zoom + o;
            for (const a of read) {
              const bbox = { x0: at(a.bbox.x0, region.x0), y0: at(a.bbox.y0, region.y0), x1: at(a.bbox.x1, region.x0), y1: at(a.bbox.y1, region.y0) };
              const taken = lines.some((l) => l.words.some((o) => o !== w && !boxOf(o) && overlaps(o.bbox, bbox)));
              if (readable(a) && a.confidence >= GAP_WORD_CONFIDENCE && !taken && !boxOf({ ...a, bbox })) words.push({ ...a, bbox });
            }
          }
        }
        line.words = words;
      }
      // Rules and fills redrawn as plain shapes; none inside a picture (a photo's edges are not rules).
      const inPicture = (b: Box) => candidates.some((c) => overlaps(c, b));
      const paper = paperTone(pixels);
      const toPt = { x: (v: number) => v / scale, y: (v: number) => height - v / scale, len: (v: number) => v / scale };
      const ruled = straightRules
        .map((r) => {
          const [[x1, y1], [x2, y2]] = [back(r.x1, r.y1), back(r.x2, r.y2)];
          const half = r.thickness / 2;
          return { ...r, x1, y1, x2, y2, box: { x0: Math.min(x1, x2) - half, y0: Math.min(y1, y2) - half, x1: Math.max(x1, x2) + half, y1: Math.max(y1, y2) + half } };
        })
        .filter((r) => !inPicture(r.box));
      const pageRules: PdfRule[] = ruled.map((r) => ({ x1: toPt.x(r.x1), y1: toPt.y(r.y1), x2: toPt.x(r.x2), y2: toPt.y(r.y2), width: Math.max(0.4, toPt.len(r.thickness)), color: r.color, ...(r.dashed && { dashed: true }) }));
      const fills: PdfFill[] = findFills(straight, straightRules)
        .map(moved)
        .filter((f) => !inPicture(f))
        .map((f) => ({ x: toPt.x(f.x0), y: toPt.y(f.y1), width: toPt.len(f.x1 - f.x0), height: toPt.len(f.y1 - f.y0), color: f.color }));
      const checkboxes: PdfCheckbox[] = boxes.map((b) => ({ x: toPt.x(b.x0), y: toPt.y(b.y1), size: toPt.len(b.x1 - b.x0), checked: b.checked, color: b.color }));
      const walls = [...boxes, ...ruled.filter((r) => Math.abs(r.x2 - r.x1) < Math.abs(r.y2 - r.y1)).map((r) => r.box)];
      const items = ocrLinesToItems(lines, scale, height, { colourOf: (box) => textColour(pixels, box, paper), walls });
      canvas.width = canvas.height = text.width = text.height = rendered.canvas.width = rendered.canvas.height = 0;
      if (level) level.width = level.height = 0;
      out.push({ width, height, items, pictures, rules: pageRules, fills, checkboxes });
      report('layout', 1);
    }
    return out;
  } finally {
    starting.then((w) => w.terminate()).catch(() => {});
    second.worker?.then((w) => w.terminate()).catch(() => {});
  }
}
