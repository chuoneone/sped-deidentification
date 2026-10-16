import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type Tesseract from 'tesseract.js';
import type { PdfPicture } from '../core/types';
import { isValidTaxId, isValidTwId } from '../core/twid';
import type { PdfPage, PdfTextItem } from './pdf';

/** What the recognition screen shows (see specs/004-scanned-pdf-ocr/contracts/ocr-progress-ui.md). */
export interface OcrProgress {
  /** 'engine': downloading and starting the recogniser; 'recognize': reading page `page`. */
  stage: 'engine' | 'recognize';
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
export function ocrLinesToItems(lines: OcrLine[], scale: number, pageHeight: number): PdfTextItem[] {
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
      // …nor below its own glyphs: such a line's baseline belongs to the larger neighbour.
      const bottom = Math.max(...run.map((w) => w.bbox.y1));
      items.push({
        text: fixConfusables(text),
        x: first.x0 / scale,
        y: pageHeight - Math.min(baselineAt(first.x0), bottom) / scale,
        fontSize: Math.min(h, tallest * 1.2) / scale,
        width: (run.at(-1)!.bbox.x1 - first.x0) / scale,
      });
      run = [];
    };
    for (const w of words) {
      const prev = run.at(-1);
      if (prev && w.bbox.x0 - prev.bbox.x1 > SPLIT_GAP * h) flush();
      run.push(w);
    }
    flush();
  }
  return items;
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

// ---------------------------------------------------------------------------------------
// Browser side: render, recognise, second opinions, pictures.
// ---------------------------------------------------------------------------------------
async function renderPage(page: PDFPageProxy): Promise<{ canvas: HTMLCanvasElement; scale: number; width: number; height: number }> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(RENDER_SCALE, MAX_SIDE / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
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

/** Latin words read with less confidence than this get a second, Chinese-only reading of their region. */
const RECHECK_CONFIDENCE = 70;
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
      const { canvas, scale, width, height } = await race(pdf.getPage(page).then(renderPage));
      thumbnail = thumbnailOf(canvas);
      onProgress?.({ stage: 'recognize', page, pages, progress: (page - 1) / pages, thumbnail });

      // Recognise a cleaned copy (colour print darkened, table rules removed); pictures are cut from the untouched page.
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      const cleaned = new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height);
      deepenColour(cleaned);
      removeRules(cleaned);
      const text = document.createElement('canvas');
      [text.width, text.height] = [canvas.width, canvas.height];
      text.getContext('2d')!.putImageData(cleaned, 0, 0);

      await race(worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO }));
      const lines = linesOf((await race(worker.recognize(text, {}, { blocks: true }))).data);
      // Found before the second opinions, which would otherwise "read" an emblem as a confident character.
      const candidates = pictureCandidates(pixels, lines.flatMap((l) => l.words));

      // Text the layout analysis skipped: read each uncovered line-shaped region on its own.
      // Faint misreadings (an orange company name read as「oA」) do not count as covering their region.
      const gaps = uncoveredText(cleaned, lines.flatMap((l) => l.words.filter((w) => w.confidence >= GAP_COVER_CONFIDENCE).map((w) => w.bbox)), candidates);
      if (gaps.length > 0) {
        await race(worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK }));
        for (const gap of gaps) {
          const area = pad(gap, 8, text.width, text.height);
          for (const found of linesOf((await race(worker.recognize(crop(text, area), {}, { blocks: true }))).data)) {
            const shift = (b: Box): Box => ({ x0: b.x0 + area.x0, y0: b.y0 + area.y0, x1: b.x1 + area.x0, y1: b.y1 + area.y0 });
            // A line counts once something in it reads clearly; then its CJK characters stay even when
            // unsure (廖宜婷 with 婷 at 20), Latin fragments only when clear (they get a second opinion next).
            if (!found.words.some((w) => w.confidence >= GAP_WORD_CONFIDENCE)) continue;
            const read = found.words.filter((w) => WIDE.test(w.text) || w.confidence >= GAP_WORD_CONFIDENCE / 2).map((w) => ({ ...w, bbox: shift(w.bbox) }));
            // A new reading replaces the page pass's words under it only where it is more confident.
            const words = read.filter((n) => lines.every((l) => l.words.every((w) => !overlaps(n.bbox, w.bbox) || w.confidence < n.confidence)));
            if (words.length === 0) continue;
            for (const line of lines) line.words = line.words.filter((w) => !words.some((n) => overlaps(n.bbox, w.bbox)));
            lines.push({ ...found, words, bbox: shift(found.bbox), baseline: found.baseline && shift(found.baseline) });
          }
        }
      }

      for (const line of lines) {
        for (let i = 0; i < line.words.length; i++) {
          const word = line.words[i];
          if (word.confidence >= RECHECK_CONFIDENCE || WIDE.test(word.text) || SYMBOLS_ONLY.test(word.text)) continue;
          if (candidates.some((c) => insidePicture(word.bbox, c))) continue;
          const area = pad(word.bbox, 6, text.width, text.height);
          let best: { words: OcrWord[]; confidence: number; zoom: number } | null = null;
          for (const zoom of RECHECK_ZOOMS) {
            const alt = linesOf((await race((await race(chineseWorker())).recognize(crop(text, area, zoom), {}, { blocks: true }))).data).flatMap((l) => l.words);
            const confidence = mean(alt.map((a) => a.confidence));
            const needed = alt.every((a) => WIDE.test(a.text)) ? word.confidence : word.confidence + RECHECK_MARGIN;
            if (alt.length > 0 && confidence > needed && confidence > (best?.confidence ?? -1)) best = { words: alt, confidence, zoom };
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
      canvas.width = canvas.height = text.width = text.height = 0;
      out.push({ width, height, items: ocrLinesToItems(lines, scale, height), pictures });
    }
    return out;
  } finally {
    starting.then((w) => w.terminate()).catch(() => {});
    second.worker?.then((w) => w.terminate()).catch(() => {});
  }
}
