import * as pdfjs from 'pdfjs-dist';
import type { PDFPageProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument, PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { LoadedDocument, PdfItemLayout, PdfPicture, TextEdit } from '../core/types';
import { distributeEdits, type Segment } from './segments';
import { sparseSubsetTtf } from './ttf-subset';
import type { OcrOptions } from './ocr';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

const FONT_URL = `${import.meta.env.BASE_URL}fonts/NotoSansTC-Regular.ttf`;

/** One run of text at its position (PDF points, origin bottom-left, y = baseline). */
export interface PdfTextItem {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  width: number;
  /** A line break follows (pdf.js hasEOL); only used while assembling the text. */
  eol?: boolean;
}

export interface PdfPage {
  width: number;
  height: number;
  items: PdfTextItem[];
  /** Scanned pages only: text-free pictures to keep in the output. */
  pictures?: PdfPicture[];
}

export interface PdfHandle {
  pages: PdfPage[];
  /** One segment per non-empty text item, in reading order, mapping into the full text. */
  segments: Segment[];
  /** segments[i] belongs to pages[itemPage[i]].items[itemIndex[i]] */
  itemPage: number[];
  itemIndex: number[];
}

export interface ParsePdfOptions {
  /** Recognise the page images when no page has a text layer (scanned PDF); without it such a PDF is rejected. */
  ocr?: OcrOptions;
}

function fontSizeOf(item: TextItem): number {
  const [, , c, d] = item.transform;
  const size = Math.hypot(c, d);
  return size > 0.5 ? size : item.height || 10;
}

async function textLayer(page: PDFPageProxy): Promise<PdfPage> {
  const [x0, y0, x1, y1] = page.view;
  const content = await page.getTextContent();
  const items: PdfTextItem[] = [];
  for (const raw of content.items) {
    if (!('str' in raw)) continue;
    const it = raw as TextItem;
    items.push({ text: it.str, x: it.transform[4] - x0, y: it.transform[5] - y0, fontSize: fontSizeOf(it), width: it.width, eol: it.hasEOL });
  }
  return { width: x1 - x0, height: y1 - y0, items };
}

const hasText = (pages: PdfPage[]): boolean => pages.some((pg) => pg.items.some((it) => it.text.trim().length > 0));

export async function parsePdf(file: File, opts: ParsePdfOptions = {}): Promise<LoadedDocument> {
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  try {
    const pdf = await task.promise;
    const pages: PdfPage[] = [];
    for (let p = 1; p <= pdf.numPages; p++) pages.push(await textLayer(await pdf.getPage(p)));
    if (hasText(pages)) return assemblePdf(file.name, pages);
    if (!opts.ocr) throw new Error('此 PDF 沒有可擷取的文字層（可能是掃描影像）；還原請使用本工具輸出的去識別化檔案');
    const scanned = await (await import('./ocr')).recognizePdf(pdf, opts.ocr);
    if (!hasText(scanned)) throw new Error('未在此 PDF 的頁面影像中辨識到任何文字');
    return assemblePdf(file.name, scanned, true);
  } finally {
    await task.destroy();
  }
}

/**
 * Joins positioned text items (from the text layer or from OCR) into the document's full text:
 * items on the same baseline share a line, a visible gap becomes a space, pages end with a blank line.
 */
export function assemblePdf(fileName: string, rawPages: PdfPage[], ocr = false): LoadedDocument {
  const pages: PdfPage[] = [];
  const segments: Segment[] = [];
  const itemPage: number[] = [];
  const itemIndex: number[] = [];
  let text = '';

  rawPages.forEach((raw, p) => {
    const items: PdfTextItem[] = [];
    let lastEndX = Number.NaN;
    let lastY = Number.NaN;

    for (const it of raw.items) {
      const { x, y, fontSize: size } = it;
      if (it.text.length > 0) {
        const sameLine = Math.abs(y - lastY) < size * 0.5;
        if (!Number.isNaN(lastY)) {
          if (!sameLine) {
            if (!text.endsWith('\n')) text += '\n';
          } else if (x - lastEndX > size * 0.25 && !text.endsWith(' ')) {
            text += ' ';
          }
        }
        segments.push({ start: text.length, end: text.length + it.text.length, text: it.text });
        itemPage.push(p);
        itemIndex.push(items.length);
        items.push({ text: it.text, x, y, fontSize: size, width: it.width });
        text += it.text;
        lastEndX = x + it.width;
        lastY = y;
      }
      if (it.eol && !text.endsWith('\n')) {
        text += '\n';
        lastY = Number.NaN;
      }
    }
    pages.push({ width: raw.width, height: raw.height, items, pictures: raw.pictures });
    if (!text.endsWith('\n')) text += '\n';
    text += '\n';
  });

  const handle: PdfHandle = { pages, segments, itemPage, itemIndex };
  const layoutPages = pages.map((pg) => ({ width: pg.width, height: pg.height, items: [] as PdfItemLayout[], pictures: pg.pictures }));
  segments.forEach((seg, i) => {
    const it = pages[itemPage[i]].items[itemIndex[i]];
    layoutPages[itemPage[i]].items.push({ start: seg.start, end: seg.end, x: it.x, y: it.y, fontSize: it.fontSize, width: it.width });
  });
  const doc: LoadedDocument = { fileName, format: 'pdf', text, handle, layout: { kind: 'pdf', pages: layoutPages } };
  if (ocr) doc.ocr = true;
  return doc;
}

let fontBytesPromise: Promise<ArrayBuffer> | null = null;
function loadFontBytes(): Promise<ArrayBuffer> {
  if (!fontBytesPromise) {
    fontBytesPromise = fetch(FONT_URL).then((r) => {
      if (!r.ok) throw new Error('無法載入中文字型，PDF 輸出失敗');
      return r.arrayBuffer();
    });
  }
  return fontBytesPromise;
}

function sanitizeForFont(text: string, supported: Set<number>): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    out += supported.has(cp) ? ch : cp < 0x20 ? '' : '?';
  }
  return out;
}

function fitSize(font: PDFFont, text: string, size: number, maxWidth: number): number {
  if (maxWidth <= 0 || text.length === 0) return size;
  const w = font.widthOfTextAtSize(text, size);
  if (w <= maxWidth * 1.02) return size;
  return Math.max(4, (size * maxWidth) / w);
}

/**
 * OCR runs: the width up to the next run on the same line (or the right margin), so a table cell's
 * text never runs into the next cell; recognised font sizes are only estimates.
 */
function roomOnLine(pg: PdfPage, it: PdfTextItem): number {
  let room = Math.max(it.width, pg.width - it.x - 36);
  for (const o of pg.items) {
    if (o.x > it.x && Math.abs(o.y - it.y) < Math.min(o.fontSize, it.fontSize) * 0.5) room = Math.min(room, o.x - it.x - 2);
  }
  return room / 1.02; // fitSize tolerates 2% overflow
}

/**
 * Rebuilds the PDF as text-only pages at the original coordinates. Original bytes are never
 * copied, so no redacted text can survive underneath (see research.md R2); the only images are the
 * text-free pictures cut from scanned pages that the user kept.
 */
export async function generatePdf(doc: LoadedDocument, edits: TextEdit[]): Promise<Blob> {
  const handle = doc.handle as PdfHandle;
  const changes = distributeEdits(handle.segments, edits);

  const newTexts: Map<number, Map<number, string>> = new Map();
  for (const [segIdx, newText] of changes) {
    const p = handle.itemPage[segIdx];
    if (!newTexts.has(p)) newTexts.set(p, new Map());
    newTexts.get(p)!.set(handle.itemIndex[segIdx], newText);
  }

  // Embed only the glyphs this document draws (see ttf-subset.ts for why not pdf-lib's subsetter).
  let allText = '?';
  handle.pages.forEach((pg, pIdx) => pg.items.forEach((it, iIdx) => (allText += newTexts.get(pIdx)?.get(iIdx) ?? it.text)));
  const out = await PDFDocument.create();
  out.registerFontkit(fontkit);
  const font = await out.embedFont(sparseSubsetTtf(new Uint8Array(await loadFontBytes()), allText), { subset: false });
  const supported = new Set(font.getCharacterSet());

  const embedded = await Promise.all(handle.pages.map((pg) => Promise.all((pg.pictures ?? []).filter((pic) => pic.keep).map(async (pic) => ({ pic, image: await out.embedJpg(pic.jpeg) })))));

  handle.pages.forEach((pg, pIdx) => {
    const page = out.addPage([pg.width, pg.height]);
    // Only the cut-out pictures are copied; the rest of the scanned page never is.
    for (const { pic, image } of embedded[pIdx]) page.drawImage(image, { x: pic.x, y: pic.y, width: pic.width, height: pic.height });
    const pageChanges = newTexts.get(pIdx);
    pg.items.forEach((it, iIdx) => {
      const changed = pageChanges?.has(iIdx) ?? false;
      const text = sanitizeForFont(changed ? pageChanges!.get(iIdx)! : it.text, supported);
      if (text.length === 0) return;
      // Replacement text may run past the original item; let it use the space up to the right
      // margin before shrinking, so whole-line items keep their size.
      const room = Math.max(it.width, pg.width - it.x - 36);
      const size = doc.ocr ? fitSize(font, text, it.fontSize, roomOnLine(pg, it)) : changed ? fitSize(font, text, it.fontSize, room) : it.fontSize;
      page.drawText(text, { x: it.x, y: it.y, size, font });
    });
  });

  const bytes = await out.save();
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}
