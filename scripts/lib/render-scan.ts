// Renders ScanPage layouts to page images that look scanned (paper tone, grain, slight skew,
// JPEG compression) and wraps them in an image-only PDF: no text layer, like a real scanner output.
// Needs a local Chrome (CHROME_PATH overrides the macOS default).
import { PDFDocument, degrees } from 'pdf-lib';
import puppeteer from 'puppeteer-core';
import { rng } from './fake.ts';
import type { ScanPage } from './scan-pages.ts';

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DPI = 200;
const A4_CSS = { w: 794, h: 1123 }; // 96 DPI
const A4_PT = { w: 595.28, h: 841.89 };
/** Handwriting and fallback fonts; only fetched while generating the sample, never by the site. */
const FONTS = 'https://fonts.googleapis.com/css2?family=LXGW+WenKai+TC&family=Caveat:wght@500&family=Noto+Sans+TC&family=Noto+Serif+TC&display=block';
const GRAIN =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E";

function frame(page: ScanPage, w: number, h: number, seed: number): string {
  const r = rng(seed);
  // A few specks of dust, as on a scanner glass.
  const dust = Array.from({ length: 28 }, () => {
    const size = 1 + r() * 2.2;
    return `<i style="left:${(r() * w).toFixed(1)}px;top:${(r() * h).toFixed(1)}px;width:${size.toFixed(1)}px;height:${size.toFixed(1)}px;opacity:${(0.25 + r() * 0.4).toFixed(2)}"></i>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${FONTS}"><style>
html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:#fff}
.scan{position:absolute;inset:0;background:#f6f3ea;filter:${page.color ? 'saturate(.88) contrast(1.04)' : 'grayscale(1) contrast(1.08)'} blur(.3px)}
.sheet{position:absolute;inset:0;transform:rotate(${page.tilt}deg)}
.grain{position:absolute;inset:0;opacity:.13;mix-blend-mode:multiply;background:url("${GRAIN}")}
.edge{position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.13),transparent 2.5%,transparent 97.5%,rgba(0,0,0,.07)),linear-gradient(180deg,rgba(0,0,0,.05),transparent 3%)}
i{position:absolute;border-radius:50%;background:#333}
</style></head><body><div class="scan"><div class="sheet">${page.html}</div><div class="grain"></div><div class="edge"></div>${dust}</div></body></html>`;
}

type Rgb = [number, number, number];
interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  dashed: boolean;
}

/**
 * What a page really says and how it is laid out, taken from the same HTML the image is rendered
 * from (the answer key). PDF points, origin bottom-left, on the upright page (tilt and rotation undone,
 * which is what recognition straightens the page to).
 */
export interface PageTruth {
  /** The page's text as laid out (rows of a table on one line, cells separated by tabs). */
  text: string;
  pictures: { x: number; y: number; width: number; height: number }[];
  /** Borders, underlines and thin colour bars. */
  rules: Segment[];
  /** Background colours (not white, not the whole page). */
  fills: { x: number; y: number; width: number; height: number; color: Rgb }[];
  checkboxes: { x: number; y: number; size: number; checked: boolean }[];
  rotation?: string;
}

/** Joins collinear pieces of the same line (adjacent table cells each report the shared border). */
function mergeSegments(segs: Segment[]): Segment[] {
  const out: Segment[] = [];
  const horizontal = (s: Segment) => s.y1 === s.y2;
  for (const s of [...segs].sort((a, b) => (horizontal(a) ? a.y1 - b.y1 || a.x1 - b.x1 : a.x1 - b.x1 || a.y1 - b.y1))) {
    const prev = out.find((o) =>
      horizontal(o) === horizontal(s) && o.dashed === s.dashed &&
      (horizontal(s) ? Math.abs(o.y1 - s.y1) <= 1.5 && s.x1 <= o.x2 + 1.5 && s.x2 >= o.x1 - 1.5 : Math.abs(o.x1 - s.x1) <= 1.5 && s.y1 <= o.y2 + 1.5 && s.y2 >= o.y1 - 1.5),
    );
    if (!prev) out.push({ ...s });
    else if (horizontal(s)) [prev.x1, prev.x2] = [Math.min(prev.x1, s.x1), Math.max(prev.x2, s.x2)];
    else [prev.y1, prev.y2] = [Math.min(prev.y1, s.y1), Math.max(prev.y2, s.y2)];
  }
  return out;
}

/** The layout as the browser drew it, in CSS px with the sheet untilted. */
function readLayout() {
  const sheet = document.querySelector('.sheet') as HTMLElement;
  const tilt = sheet.style.transform;
  sheet.style.transform = 'none';
  const rgb = (c: string): [number, number, number, number] => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    const [r, g, b, a = '1'] = m ? m[1].split(',').map((v) => v.trim()) : ['0', '0', '0', '0'];
    return [Number(r), Number(g), Number(b), Number(a)];
  };
  const page = sheet.getBoundingClientRect();
  const rules: { x1: number; y1: number; x2: number; y2: number; dashed: boolean }[] = [];
  const fills: { x: number; y: number; width: number; height: number; color: [number, number, number] }[] = [];
  const checkboxes: { x: number; y: number; size: number; checked: boolean }[] = [];
  for (const el of sheet.querySelectorAll<HTMLElement>('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (el.dataset.checkbox !== undefined) {
      checkboxes.push({ x: r.left, y: r.bottom, size: r.width, checked: el.dataset.checkbox === '1' });
      continue;
    }
    if (el.tagName === 'IMG') continue; // a picture's frame belongs to the picture
    // Only upright rules and fills are redrawn; a tilted card or stamp is not part of the key.
    if (el.closest('[style*="rotate("]')) continue;
    const cs = getComputedStyle(el);
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const w = parseFloat(cs.getPropertyValue(`border-${side}-width`));
      const style = cs.getPropertyValue(`border-${side}-style`);
      if (!(w >= 0.5) || style === 'none' || style === 'hidden' || rgb(cs.getPropertyValue(`border-${side}-color`))[3] === 0) continue;
      const dashed = style === 'dashed' || style === 'dotted';
      if (side === 'top') rules.push({ x1: r.left, y1: r.top + w / 2, x2: r.right, y2: r.top + w / 2, dashed });
      if (side === 'bottom') rules.push({ x1: r.left, y1: r.bottom - w / 2, x2: r.right, y2: r.bottom - w / 2, dashed });
      if (side === 'left') rules.push({ x1: r.left + w / 2, y1: r.top, x2: r.left + w / 2, y2: r.bottom, dashed });
      if (side === 'right') rules.push({ x1: r.right - w / 2, y1: r.top, x2: r.right - w / 2, y2: r.bottom, dashed });
    }
    const [cr, cg, cb, ca] = rgb(cs.backgroundColor);
    if (ca > 0 && Math.min(cr, cg, cb) < 245 && r.width * r.height < page.width * page.height * 0.5) {
      // A thin colour bar reads as a rule; anything thicker is a filled area.
      if (Math.min(r.width, r.height) <= 8) {
        const mid = r.width < r.height ? { x1: (r.left + r.right) / 2, y1: r.top, x2: (r.left + r.right) / 2, y2: r.bottom } : { x1: r.left, y1: (r.top + r.bottom) / 2, x2: r.right, y2: (r.top + r.bottom) / 2 };
        rules.push({ ...mid, dashed: false });
      } else fills.push({ x: r.left, y: r.top, width: r.width, height: r.height, color: [cr, cg, cb] });
    }
  }
  sheet.style.transform = tilt;
  return { rules, fills, checkboxes };
}

/** Returns the PDF, each page image (JPEG) and each page's answer key. */
export async function renderScanPdf(pages: ScanPage[]): Promise<{ pdf: Uint8Array; images: Uint8Array[]; truth: PageTruth[] }> {
  const browser = await puppeteer.launch({ executablePath: CHROME });
  const out = await PDFDocument.create();
  const images: Uint8Array[] = [];
  const truth: PageTruth[] = [];
  try {
    const tab = await browser.newPage();
    for (const [i, page] of pages.entries()) {
      const [w, h] = page.landscape ? [A4_CSS.h, A4_CSS.w] : [A4_CSS.w, A4_CSS.h];
      await tab.setViewport({ width: w, height: h, deviceScaleFactor: DPI / 96 });
      await tab.setContent(frame(page, w, h, 900 + i), { waitUntil: 'load', timeout: 120000 });
      await tab.evaluate(() => document.fonts.ready);
      const jpg = new Uint8Array(await tab.screenshot({ type: 'jpeg', quality: 72 }));
      images.push(jpg);
      const [pw, ph] = page.landscape ? [A4_PT.h, A4_PT.w] : [A4_PT.w, A4_PT.h];
      const image = await out.embedJpg(jpg);
      // A sideways or upside-down scan: the page is the turned image (as a scanner would store it).
      const turn = page.rotate ?? 0;
      const sideways = turn === 90 || turn === 270;
      const pdfPage = out.addPage(sideways ? [ph, pw] : [pw, ph]);
      const at = { 0: { x: 0, y: 0 }, 90: { x: ph, y: 0 }, 180: { x: pw, y: ph }, 270: { x: 0, y: pw } }[turn];
      pdfPage.drawImage(image, { ...at, width: pw, height: ph, rotate: degrees(turn) });
      const pt = pw / w;
      const { text, rects } = await tab.evaluate(() => ({
        text: (document.querySelector('.sheet') as HTMLElement).innerText,
        rects: [...document.querySelectorAll('.sheet img')].map((img) => img.getBoundingClientRect().toJSON() as DOMRect),
      }));
      await tab.evaluate('globalThis.__name = (f) => f'); // tsx's helper for named functions, absent in the page
      const layout = await tab.evaluate(readLayout);
      const round = (v: number) => Math.round(v * 10) / 10;
      const X = (v: number) => round(v * pt);
      const Y = (v: number) => round(ph - v * pt);
      // Greyscale scans lose the colour of fills too.
      const tone = (c: Rgb): Rgb => (page.color ? c : (Array(3).fill(Math.round(c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114)) as Rgb));
      truth.push({
        text,
        pictures: rects.map((r) => ({ x: X(r.left), y: Y(r.bottom), width: X(r.width), height: X(r.height) })),
        rules: mergeSegments(layout.rules).map((s) => ({ x1: X(s.x1), y1: Y(s.y1), x2: X(s.x2), y2: Y(s.y2), dashed: s.dashed })),
        fills: layout.fills.map((f) => ({ x: X(f.x), y: Y(f.y + f.height), width: X(f.width), height: X(f.height), color: tone(f.color) })),
        checkboxes: layout.checkboxes.map((c) => ({ x: X(c.x), y: Y(c.y), size: X(c.size), checked: c.checked })),
        ...((page.tilt >= 1 || turn) && { rotation: turn ? `轉向 ${turn}°` : `傾斜 ${page.tilt}°` }),
      });
    }
  } finally {
    await browser.close();
  }
  return { pdf: await out.save(), images, truth };
}
