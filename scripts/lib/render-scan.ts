// Renders ScanPage layouts to page images that look scanned (paper tone, grain, slight skew,
// JPEG compression) and wraps them in an image-only PDF: no text layer, like a real scanner output.
// Needs a local Chrome (CHROME_PATH overrides the macOS default).
import { PDFDocument } from 'pdf-lib';
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

/** What a page really says, taken from the same HTML the image is rendered from (the answer key). */
export interface PageTruth {
  /** The page's text as laid out (rows of a table on one line, cells separated by tabs). */
  text: string;
  /** Pictures in PDF points, origin bottom-left (bounding box after the page's tilt). */
  pictures: { x: number; y: number; width: number; height: number }[];
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
      out.addPage([pw, ph]).drawImage(await out.embedJpg(jpg), { x: 0, y: 0, width: pw, height: ph });
      const pt = pw / w;
      const { text, rects } = await tab.evaluate(() => ({
        text: (document.querySelector('.sheet') as HTMLElement).innerText,
        rects: [...document.querySelectorAll('.sheet img')].map((img) => img.getBoundingClientRect().toJSON() as DOMRect),
      }));
      const round = (v: number) => Math.round(v * 10) / 10;
      truth.push({
        text,
        pictures: rects.map((r) => ({ x: round(r.left * pt), y: round(ph - r.bottom * pt), width: round(r.width * pt), height: round(r.height * pt) })),
      });
    }
  } finally {
    await browser.close();
  }
  return { pdf: await out.save(), images, truth };
}
