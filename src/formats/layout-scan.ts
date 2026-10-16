// Layout analysis of a rendered scanned page (pure functions over RGBA pixels): the rules, fills,
// checkboxes and text colours redrawn in the output, and the page's skew and text direction.
// Coordinates are canvas pixels, origin top-left.
import type { Rgb } from '../core/types';
import type { Box, Raster } from './ocr';

export interface PixelRule {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  thickness: number;
  color: Rgb;
  dashed: boolean;
}
export interface PixelFill extends Box {
  color: Rgb;
}
export interface PixelCheckbox extends Box {
  checked: boolean;
  color: Rgb;
}

/** Ink is this much darker than the paper (a 1 px grey rule blurred by the scanner is still ink). */
const INK_BELOW_PAPER = 60;
/**
 * A light grey hairline is a rule down to this, where it is darker than the paper a little way off on
 * both sides (smudged over two rows once straightened, it is no longer ink); a grey background is not.
 */
const HAIRLINE_BELOW_PAPER = 40;
const HAIRLINE_REACH = 3;
const HAIRLINE_CONTRAST = 15;
/** Thicker dark bands are areas (a photo's shadows, a black bar), not rules. */
const MAX_RULE_THICKNESS = 20;
/** A rule has much the same shade on both sides; more different, it is the edge of something (a card on the scanner's lid). */
const SIDE_CONTRAST = 25;
export const luminance = (d: Uint8ClampedArray, i: number) => (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
};

/** The paper's colour: the median of the pixels about as bright as the paper tone (a warm scan is not white). */
export function paperColour(img: Raster, tone = paperTone(img)): Rgb {
  const [rs, gs, bs]: number[][] = [[], [], []];
  for (let p = 0; p < img.width * img.height; p += 13) {
    const i = p * 4;
    if (Math.abs(luminance(img.data, i) - tone) > 3) continue;
    rs.push(img.data[i]);
    gs.push(img.data[i + 1]);
    bs.push(img.data[i + 2]);
  }
  return rs.length ? [median(rs), median(gs), median(bs)] : [tone, tone, tone];
}

/** The paper tone: a bright percentile of the page, so a tinted scan still has a "white". */
export function paperTone(img: Raster): number {
  const hist = new Uint32Array(256);
  for (let p = 0; p < img.width * img.height; p += 7) hist[Math.round(luminance(img.data, p * 4))]++;
  const total = hist.reduce((a, b) => a + b, 0);
  let seen = 0;
  for (let v = 255; v >= 0; v--) {
    seen += hist[v];
    if (seen >= total * 0.1) return v;
  }
  return 255;
}

function darkMask(img: Raster, paper = paperTone(img)): Uint8Array {
  const mask = new Uint8Array(img.width * img.height);
  for (let p = 0; p < mask.length; p++) mask[p] = luminance(img.data, p * 4) < paper - INK_BELOW_PAPER ? 1 : 0;
  return mask;
}

/** Median colour of the pixels along a rule's centre line. */
function ruleColour(img: Raster, r: { x1: number; y1: number; x2: number; y2: number }, paper: number): Rgb {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const n = Math.max(1, Math.round(Math.max(Math.abs(r.x2 - r.x1), Math.abs(r.y2 - r.y1)) / 3));
  for (let k = 0; k <= n; k++) {
    const x = Math.round(r.x1 + ((r.x2 - r.x1) * k) / n);
    const y = Math.round(r.y1 + ((r.y2 - r.y1) * k) / n);
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
    const i = (y * img.width + x) * 4;
    if (luminance(img.data, i) >= paper - HAIRLINE_BELOW_PAPER) continue; // a gap of a dashed rule
    rs.push(img.data[i]);
    gs.push(img.data[i + 1]);
    bs.push(img.data[i + 2]);
  }
  return [median(rs), median(gs), median(bs)];
}

interface Run {
  pos: number;
  from: number;
  to: number;
}

interface Band {
  from: number;
  to: number;
  first: number;
  last: number;
  /** Total length of the runs it is made of. */
  ink: number;
}

/**
 * Joins runs on consecutive rows (or columns) into bands: runs that cover the same span within
 * `tolerance`, or (with `loose`) that mostly overlap — a slightly tilted edge shifts a little per row.
 */
function bands(runs: Run[], tolerance: number, loose = false): Band[] {
  const open: Band[] = [];
  const done: Band[] = [];
  const joins = (o: Band, r: Run) => {
    if (Math.abs(o.from - r.from) <= tolerance && Math.abs(o.to - r.to) <= tolerance) return true;
    const shared = Math.min(o.to, r.to) - Math.max(o.from, r.from);
    return loose && shared >= Math.min(o.to - o.from, r.to - r.from) * 0.5;
  };
  for (const r of [...runs].sort((a, b) => a.pos - b.pos || a.from - b.from)) {
    const b = open.find((o) => o.last >= r.pos - 1 && joins(o, r));
    if (b) {
      b.last = r.pos;
      b.from = Math.min(b.from, r.from);
      b.to = Math.max(b.to, r.to);
      b.ink += r.to - r.from;
    } else open.push({ from: r.from, to: r.to, first: r.pos, last: r.pos, ink: r.to - r.from });
    for (let i = open.length - 1; i >= 0; i--) {
      if (open[i].last < r.pos - 1) done.push(...open.splice(i, 1));
    }
  }
  return [...done, ...open];
}

/** Folds the scanner's faint halo rows (partial, beside a rule) into the rule they surround. */
function absorbHalos(list: Band[]): Band[] {
  const out: Band[] = [];
  for (const b of [...list].sort((x, y) => (y.last - y.first) - (x.last - x.first) || y.ink - x.ink)) {
    const host = out.find((o) => b.first <= o.last + 2 && b.last >= o.first - 2 && Math.min(o.to, b.to) - Math.max(o.from, b.from) >= (b.to - b.from) * 0.5);
    if (!host) {
      out.push({ ...b });
      continue;
    }
    [host.first, host.last] = [Math.min(host.first, b.first), Math.max(host.last, b.last)];
    host.ink += b.ink;
  }
  return out;
}

/**
 * Dash runs along one row/column: ≥ 6 short dark pieces (3–24 px) of similar length with gaps of at
 * most 16 px, spanning at least `minRun`. A row through a line of text has short pieces too, so the
 * caller also checks that the band is isolated (blank just above and below).
 */
function dashRuns(pieces: { from: number; to: number }[], minRun: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  let seq: { from: number; to: number }[] = [];
  const close = () => {
    if (seq.length >= 6 && seq.at(-1)!.to - seq[0].from >= minRun) {
      const lens = seq.map((p) => p.to - p.from);
      const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
      if (lens.every((l) => Math.abs(l - mean) <= mean * 0.5 + 1)) out.push({ from: seq[0].from, to: seq.at(-1)!.to });
    }
    seq = [];
  };
  for (const p of pieces) {
    const len = p.to - p.from;
    if (len < 3 || len > 24) {
      close();
      continue;
    }
    if (seq.length && p.from - seq.at(-1)!.to > 16) close();
    seq.push(p);
  }
  close();
  return out;
}

/**
 * Horizontal and vertical rules: dark runs of at least `minRun` px (character strokes are far
 * shorter), joined across neighbouring rows into one rule with a thickness and colour; and dashed
 * rules (regular short dashes on an otherwise blank band).
 */
export function findRules(img: Raster, minRun = Math.max(80, Math.round(img.width * 0.05))): PixelRule[] {
  const { width: w, height: h } = img;
  const paper = paperTone(img);
  const dark = darkMask(img, paper);
  const lum = new Uint8Array(w * h);
  for (let p = 0; p < lum.length; p++) lum[p] = luminance(img.data, p * 4);
  const hairline = (p: number, step: number) => {
    const v = lum[p] + HAIRLINE_CONTRAST;
    return lum[p] < paper - HAIRLINE_BELOW_PAPER && p - step >= 0 && p + step < lum.length && lum[p - step] > v && lum[p + step] > v;
  };
  const out: PixelRule[] = [];
  for (const horizontalPass of [true, false]) {
    const [lines, length] = horizontalPass ? [h, w] : [w, h];
    const across = HAIRLINE_REACH * (horizontalPass ? w : 1);
    const get = horizontalPass
      ? (pos: number, i: number) => dark[pos * w + i] === 1 || hairline(pos * w + i, across)
      : (pos: number, i: number) => dark[i * w + pos] === 1 || hairline(i * w + pos, across);
    const solid: Run[] = [];
    const dashed: Run[] = [];
    for (let pos = 0; pos < lines; pos++) {
      const pieces: { from: number; to: number }[] = [];
      let start = -1;
      for (let i = 0; i <= length; i++) {
        const on = i < length && get(pos, i);
        if (on && start < 0) start = i;
        if (!on && start >= 0) {
          if (i - start >= minRun) solid.push({ pos, from: start, to: i });
          else pieces.push({ from: start, to: i });
          start = -1;
        }
      }
      for (const d of dashRuns(pieces, minRun)) dashed.push({ pos, ...d });
    }
    const emit = (b: Band, isDashed: boolean, thickness = b.last - b.first + 1) => {
      const mid = (b.first + b.last) / 2;
      if (mid < lines * 0.01 || mid > lines * 0.99) return; // the scanner's shadow along the page's edge
      const r = horizontalPass ? { x1: b.from, y1: mid, x2: b.to, y2: mid } : { x1: mid, y1: b.from, x2: mid, y2: b.to };
      out.push({ ...r, thickness, color: ruleColour(img, r, paper), dashed: isDashed });
    };
    // A rule is a solid, thin band: its rows run the full length (a tilted stamp's edge steps
    // sideways row by row, a dark area of a photo is thick). A hairline's paler edge rows, smudged
    // by the scanner, cover only part of it; its thickness is the ink's, not theirs.
    const side = (pos: number, b: Band) => {
      const v: number[] = [];
      for (let i = b.from; i < b.to; i += 3) if (pos >= 0 && pos < lines) v.push(lum[horizontalPass ? pos * w + i : i * w + pos]);
      return v.length ? median(v) : paper;
    };
    for (const b of absorbHalos(bands(solid, 6, true))) {
      const rows = b.last - b.first + 1;
      if (rows > MAX_RULE_THICKNESS || b.ink < rows * (b.to - b.from) * (rows <= 6 ? 0.4 : 0.75)) continue;
      if (Math.abs(side(b.first - 4, b) - side(b.last + 4, b)) > SIDE_CONTRAST) continue;
      emit(b, false, Math.max(1, Math.round(b.ink / (b.to - b.from))));
    }
    for (const b of absorbHalos(bands(dashed, 12))) {
      // Isolated: 3 px beyond the band on both sides is almost blank (a text line is not).
      const blank = (pos: number) => {
        if (pos < 0 || pos >= lines) return true;
        let n = 0;
        for (let i = b.from; i < b.to; i++) if (get(pos, i)) n++;
        return n <= (b.to - b.from) * 0.05;
      };
      if (b.last - b.first <= 4 && blank(b.first - 3) && blank(b.last + 3)) emit(b, true);
    }
  }
  return out;
}

/** Whitens the given rules (and the anti-aliased pixel beside them) so recognition does not read them. */
export function eraseRules(img: Raster, rules: PixelRule[]): void {
  const { data, width: w, height: h } = img;
  for (const r of rules) {
    const half = Math.ceil(r.thickness / 2) + 1;
    const [x0, x1] = [Math.max(0, Math.floor(Math.min(r.x1, r.x2) - (r.x1 === r.x2 ? half : 0))), Math.min(w - 1, Math.ceil(Math.max(r.x1, r.x2) + (r.x1 === r.x2 ? half : 0)))];
    const [y0, y1] = [Math.max(0, Math.floor(Math.min(r.y1, r.y2) - (r.y1 === r.y2 ? half : 0))), Math.min(h - 1, Math.ceil(Math.max(r.y1, r.y2) + (r.y1 === r.y2 ? half : 0)))];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = (y * w + x) * 4;
        if (luminance(data, i) < 200) data[i] = data[i + 1] = data[i + 2] = 255;
      }
    }
  }
}

const FILL_CELL = 8;

/**
 * Background fills (table headers, shaded cells, colour blocks): cells whose colour, ignoring the
 * text on them, differs from the paper and is even; similar neighbouring cells form a region kept if
 * it is a well-filled rectangle. Rules split regions (each shaded cell of a table is its own fill)
 * and fills are stretched to the rules that bound them. Whole-page tints and dark blocks are ignored.
 */
export function findFills(img: Raster, rules: PixelRule[] = []): PixelFill[] {
  const { data, width: w, height: h } = img;
  const paper = paperTone(img);
  const sheet = paperColour(img, paper);
  const cols = Math.ceil(w / FILL_CELL);
  const rows = Math.ceil(h / FILL_CELL);
  const colour: (Rgb | null)[] = new Array(cols * rows).fill(null);
  // Cells mostly covered by text (bold headings) show too little background to judge: a fill may
  // run through them, but they do not decide its colour.
  const wordy = new Uint8Array(cols * rows);
  const ruled = new Uint8Array(cols * rows);
  for (const r of rules) {
    const half = r.thickness / 2 + 1;
    const [x0, x1, y0, y1] = [Math.min(r.x1, r.x2) - half, Math.max(r.x1, r.x2) + half, Math.min(r.y1, r.y2) - half, Math.max(r.y1, r.y2) + half];
    for (let row = Math.max(0, Math.floor(y0 / FILL_CELL)); row <= Math.min(rows - 1, Math.floor(y1 / FILL_CELL)); row++) {
      for (let col = Math.max(0, Math.floor(x0 / FILL_CELL)); col <= Math.min(cols - 1, Math.floor(x1 / FILL_CELL)); col++) ruled[row * cols + col] = 1;
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (ruled[row * cols + col]) continue;
      const [rs, gs, bs]: number[][] = [[], [], []];
      let samples = 0;
      let unlikePaper = 0;
      for (let y = row * FILL_CELL; y < Math.min(h, (row + 1) * FILL_CELL); y += 2) {
        for (let x = col * FILL_CELL; x < Math.min(w, (col + 1) * FILL_CELL); x += 2) {
          const i = (y * w + x) * 4;
          samples++;
          if (luminance(data, i) < paper - 60) continue; // text on the fill
          rs.push(data[i]);
          gs.push(data[i + 1]);
          bs.push(data[i + 2]);
          if ([0, 1, 2].some((k) => Math.abs(data[i + k] - sheet[k]) >= 8)) unlikePaper++;
        }
      }
      if (rs.length < samples * 0.5) {
        wordy[row * cols + col] = 1;
        continue;
      }
      // Plain paper: with fewer than half the samples off the paper colour, no median is (off ≥ 8 below).
      if (unlikePaper < rs.length - (rs.length >> 1)) continue;
      const c: Rgb = [median(rs), median(gs), median(bs)];
      const spread = Math.max(...[rs, gs, bs].map((ch, k) => median(ch.map((v) => Math.abs(v - c[k])))));
      const lum = c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
      // Compared channel by channel with the paper: a neutral grey header on warm paper differs mostly in blue.
      const off = Math.max(...c.map((v, k) => Math.abs(v - sheet[k])));
      if (spread <= 6 && lum >= 120 && lum < paper && off >= 8) colour[row * cols + col] = c;
    }
  }
  const near = (a: Rgb, b: Rgb) => Math.max(...a.map((v, k) => Math.abs(v - b[k]))) <= 14;
  const seen = new Uint8Array(cols * rows);
  const out: PixelFill[] = [];
  for (let start = 0; start < cols * rows; start++) {
    const seed = colour[start];
    if (!seed || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    const members: number[] = [];
    while (stack.length) {
      const cell = stack.pop()!;
      members.push(cell);
      const c = cell % cols;
      const r = (cell - c) / cols;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const [nc, nr] = [c + dc, r + dr];
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const n = nr * cols + nc;
        const nColour = colour[n];
        if (!seen[n] && ((nColour && near(nColour, seed)) || wordy[n])) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    const cs = members.map((m) => m % cols);
    const rs = members.map((m) => Math.floor(m / cols));
    let [c0, c1, r0, r1] = [Math.min(...cs), Math.max(...cs), Math.min(...rs), Math.max(...rs)];
    const [bc, br] = [c1 - c0 + 1, r1 - r0 + 1];
    if (bc < 2 || br < 2 || members.length < bc * br * 0.85 || bc * br > cols * rows * 0.5) continue;
    // The scanner's shadow along an edge, not a fill (pages keep margins of more than 3%).
    if (c0 * FILL_CELL < w * 0.03 || r0 * FILL_CELL < h * 0.03 || (c1 + 1) * FILL_CELL > w * 0.97 || (r1 + 1) * FILL_CELL > h * 0.97) continue;
    // Stretch to bounding rules (the fill runs under the line that frames it).
    const ruledEdge = (cc: number[], rr: number[]) => cc.some((c) => rr.some((r) => c >= 0 && r >= 0 && c < cols && r < rows && ruled[r * cols + c]));
    const span = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
    if (ruledEdge([c0 - 1], span(r0, r1))) c0--;
    if (ruledEdge([c1 + 1], span(r0, r1))) c1++;
    if (ruledEdge(span(c0, c1), [r0 - 1])) r0--;
    if (ruledEdge(span(c0, c1), [r1 + 1])) r1++;
    const coloured = members.filter((m) => colour[m]);
    if (coloured.length < Math.max(6, members.length * 0.5)) continue; // mostly text, little visible background
    const mean = (k: number) => Math.round(coloured.reduce((n, m) => n + colour[m]![k], 0) / coloured.length);
    out.push({ x0: c0 * FILL_CELL, y0: r0 * FILL_CELL, x1: Math.min(w, (c1 + 1) * FILL_CELL), y1: Math.min(h, (r1 + 1) * FILL_CELL), color: [mean(0), mean(1), mean(2)] });
  }
  return out;
}

/**
 * The colour a piece of text was printed or written in: the darkest 40% of its ink (anti-aliased
 * edges are paler), greyed when it is nearly neutral so black text does not come out tinted.
 */
export function textColour(img: Raster, box: Box, paper = paperTone(img)): Rgb | undefined {
  const { data, width: w, height: h } = img;
  const ink: [number, number, number, number][] = [];
  for (let y = Math.max(0, Math.floor(box.y0)); y < Math.min(h, Math.ceil(box.y1)); y++) {
    for (let x = Math.max(0, Math.floor(box.x0)); x < Math.min(w, Math.ceil(box.x1)); x++) {
      const i = (y * w + x) * 4;
      const l = luminance(data, i);
      if (l < paper - 60) ink.push([l, data[i], data[i + 1], data[i + 2]]);
    }
  }
  if (ink.length < 4) return undefined;
  ink.sort((a, b) => a[0] - b[0]);
  const core = ink.slice(0, Math.max(1, Math.round(ink.length * 0.4)));
  const avg = [1, 2, 3].map((k) => Math.round(core.reduce((n, p) => n + p[k], 0) / core.length)) as Rgb;
  if (Math.max(...avg) - Math.min(...avg) < 30) {
    const l = Math.round(avg[0] * 0.299 + avg[1] * 0.587 + avg[2] * 0.114);
    return [l, l, l];
  }
  return avg;
}

/**
 * Checkbox squares, found by their sides so a tick drawn past the frame does not hide them: a top
 * and a bottom side starting at the same x (the longer one runs on where a tick crosses it), with
 * left and right sides between them; a box filled in solid is a dark square. `textHeight` bounds the
 * size (0.6–1.6×). A frame only counts when it stands apart: sharp corners (not the loop of an 8 or
 * 9), no stroke right across the inside (日、目、田) or hanging into it (四), and blank paper around
 * it except where a tick leaves at the top right (not the 口 inside 品 or 號). Ticked when the
 * inside holds ink (tick, cross or fill).
 */
export function findCheckboxes(img: Raster, textHeight: number): PixelCheckbox[] {
  const { width: w, height: h } = img;
  const paper = paperTone(img);
  const dark = darkMask(img, paper);
  const [minSide, maxSide] = [Math.round(textHeight * 0.6), Math.round(textHeight * 1.6)];
  const runs: Run[] = [];
  for (let y = 0; y < h; y++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const on = x < w && dark[y * w + x] === 1;
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        if (x - start >= minSide && x - start <= maxSide * 1.6) runs.push({ pos: y, from: start, to: x });
        start = -1;
      }
    }
  }
  const all = bands(runs, 3, true);
  const edges = all.filter((e) => e.last - e.first <= Math.max(3, textHeight * 0.2));
  const byLeft = new Map<number, Band[]>();
  for (const e of edges) byLeft.set(e.from, [...(byLeft.get(e.from) ?? []), e]);
  /** Share of dark pixels in [x0, x1) × [y0, y1), clipped to the page; 0 when empty. */
  const share = (x0: number, y0: number, x1: number, y1: number) => {
    [x0, y0, x1, y1] = [Math.max(0, Math.round(x0)), Math.max(0, Math.round(y0)), Math.min(w, Math.round(x1)), Math.min(h, Math.round(y1))];
    let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) n += dark[y * w + x];
    return x1 > x0 && y1 > y0 ? n / ((x1 - x0) * (y1 - y0)) : 0;
  };
  const framed = (x0: number, y0: number, x1: number, y1: number, t: number) => {
    const side = x1 - x0;
    if (t > Math.max(3, side * 0.2)) return false;
    // Dark along its whole length, each quarter of it (函 has a gap below its top stroke).
    const sideAt = (from: number, to: number) => {
      for (let x = from; x <= to; x++) if ([0, 1, 2, 3].every((q) => share(x, y0 + ((y1 - y0) * q) / 4, x + 1, y0 + ((y1 - y0) * (q + 1)) / 4) >= 0.75)) return true;
      return false;
    };
    if (!sideAt(x0 - 1, x0 + t + 1) || !sideAt(x1 - t - 2, x1)) return false;
    const c = t + 1;
    if ([share(x0, y0, x0 + c, y0 + c), share(x1 - c, y0, x1, y0 + c), share(x0, y1 - c, x0 + c, y1), share(x1 - c, y1 - c, x1, y1)].some((v) => v < 0.5)) return false;
    // A stroke from side to side (日、目、田), or hanging from the middle of the top side (四、囚);
    // a tick or a cross touches at most one side, and leaves near a corner.
    if (share(x0 + t + 2, y0 + t + 2, x1 - t - 2, y1 - t - 2) < 0.7) {
      for (let y = y0 + t + 2; y < y1 - t - 2; y++) if (share(x0 + t, y, x1 - t, y + 1) >= 0.85) return false;
      for (let x = x0 + t + 2; x < x1 - t - 2; x++) if (share(x, y0 + t, x + 1, y1 - t) >= 0.85) return false;
      if (share(x0 + side * 0.3, y0 + t + 1, x0 + side * 0.7, y0 + t + 3) > 0.15) return false;
    }
    return true;
  };
  const apart = (x0: number, y0: number, x1: number, y1: number) => {
    const side = x1 - x0;
    const [m, near, gap] = [Math.max(3, side * 0.25), Math.max(2, side * 0.12), 2];
    const [midX, midY] = [(x0 + x1) / 2, (y0 + y1) / 2];
    return (
      share(x0 - gap - m, y0, x0 - gap, y1) <= 0.05 &&
      share(x0, y1 + gap, x1, y1 + gap + m) <= 0.05 &&
      share(x0, y0 - gap - m, midX, y0 - gap) <= 0.05 &&
      share(x1 + gap, midY, x1 + gap + near, y1) <= 0.05
    );
  };
  const out: PixelCheckbox[] = [];
  const add = (x0: number, y0: number, x1: number, y1: number, checked: boolean) =>
    out.push({ x0, y0, x1, y1, checked, color: ruleColour(img, { x1: x0, y1: y0 + 1, x2: x1, y2: y0 + 1 }, paper) });
  const taken = (x0: number, y0: number, x1: number, y1: number) => out.some((o) => o.x0 < x1 && x0 < o.x1 && o.y0 < y1 && y0 < o.y1);
  for (const top of edges) {
    for (let left = top.from - 3; left <= top.from + 3; left++) {
      for (const bottom of byLeft.get(left) ?? []) {
        if (bottom.first <= top.last) continue;
        const [short, long] = top.to - top.from <= bottom.to - bottom.from ? [top, bottom] : [bottom, top];
        const [x0, x1] = [Math.max(top.from, bottom.from), short.to];
        const [y0, y1] = [top.first, bottom.last + 1];
        if (long.to < short.to - 3 || x1 - x0 < minSide || x1 - x0 > maxSide) continue;
        if (y1 - y0 < (x1 - x0) * 0.8 || y1 - y0 > (x1 - x0) * 1.25) continue;
        const t = Math.max(top.last - top.first + 1, bottom.last - bottom.first + 1, 2);
        if (taken(x0, y0, x1, y1) || !framed(x0, y0, x1, y1, t) || !apart(x0, y0, x1, y1)) continue;
        add(x0, y0, x1, y1, share(x0 + t + 2, y0 + t + 2, x1 - t - 2, y1 - t - 2) > 0.04);
      }
    }
  }
  // Filled in solid: square corners, unlike a logo's rounded block.
  for (const b of all) {
    const [x0, y0, x1, y1] = [b.from, b.first, b.to, b.last + 1];
    if (x1 - x0 > maxSide || y1 - y0 < (x1 - x0) * 0.8 || y1 - y0 > (x1 - x0) * 1.25 || b.ink < (x1 - x0) * (y1 - y0) * 0.9) continue;
    const c = Math.max(2, (x1 - x0) * 0.1);
    if ([share(x0, y0, x0 + c, y0 + c), share(x1 - c, y0, x1, y0 + c), share(x0, y1 - c, x0 + c, y1), share(x1 - c, y1 - c, x1, y1)].some((v) => v < 0.75)) continue;
    if (!taken(x0, y0, x1, y1) && apart(x0, y0, x1, y1)) add(x0, y0, x1, y1, true);
  }
  return out.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
}

/** Dark pixels of a 4×-reduced copy, for the whole-page geometry below. */
function inkPoints(img: Raster): { xs: Int32Array; ys: Int32Array; w: number; h: number } {
  const step = 4;
  const [w, h] = [Math.floor(img.width / step), Math.floor(img.height / step)];
  const paper = paperTone(img);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (luminance(img.data, (y * step * img.width + x * step) * 4) < paper - 60) {
        xs.push(x);
        ys.push(y);
      }
    }
  }
  return { xs: Int32Array.from(xs), ys: Int32Array.from(ys), w, h };
}

/** How sharply the ink falls into rows at `deg` (text lines make a spiky profile). */
function profileScore(p: { xs: Int32Array; ys: Int32Array; w: number; h: number }, deg: number): number {
  const a = (deg * Math.PI) / 180;
  const [sin, cos] = [Math.sin(a), Math.cos(a)];
  const size = p.h + p.w + 2;
  const hist = new Float64Array(size * 2);
  for (let i = 0; i < p.xs.length; i++) hist[Math.round(p.ys[i] * cos - p.xs[i] * sin) + size]++;
  let s = 0;
  for (const v of hist) s += v * v;
  return s;
}

/**
 * The page's skew in degrees (clockwise positive, as text lines slope down to the right), by the
 * projection-profile method: the angle at which ink falls most sharply into rows. ±`range`°.
 */
export function estimateSkew(img: Raster, range = 10): number {
  const p = inkPoints(img);
  if (p.xs.length < 50) return 0;
  let best = 0;
  let bestScore = -1;
  for (let deg = -range; deg <= range + 1e-9; deg += 0.5) {
    const s = profileScore(p, deg);
    if (s > bestScore) [best, bestScore] = [deg, s];
  }
  const coarse = best;
  for (let deg = coarse - 0.5; deg <= coarse + 0.5 + 1e-9; deg += 0.1) {
    const s = profileScore(p, deg);
    if (s > bestScore) [best, bestScore] = [deg, s];
  }
  return Math.round(best * 10) / 10;
}

/** Whether the text lines run across the page (upright or upside down) or up and down it (turned 90°). */
export function lineOrientation(img: Raster): 'horizontal' | 'vertical' {
  const p = inkPoints(img);
  if (p.xs.length < 50) return 'horizontal';
  // Σcount² × bins ∝ 1 + CV² of the profile: comparable between the two directions.
  const across = profileScore(p, 0) * p.h;
  const down = profileScore({ xs: p.ys, ys: p.xs, w: p.h, h: p.w }, 0) * p.w;
  return down > across * 1.3 ? 'vertical' : 'horizontal';
}
