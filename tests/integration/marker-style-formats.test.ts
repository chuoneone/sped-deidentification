// Every format written with the marker styles that need no restoring (類別, 空白佔位): the output
// carries no code and no hidden value, and reads back with exactly the expected markers.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import * as pdfjs from 'pdfjs-dist';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CodeBook, parseMarkers } from '../../src/core/codes';
import { detect, resplitItems } from '../../src/core/detector';
import { BUILTIN_PATTERNS } from '../../src/core/patterns';
import { applyRedactions, type MarkerStyle } from '../../src/core/redactor';
import type { LoadedDocument } from '../../src/core/types';
import { generateDocument, parseDocument } from '../../src/formats';
import { contract, customers } from '../../scripts/lib/documents.ts';
import { renderDocx } from '../../scripts/lib/render-docx.ts';
import { renderPdf } from '../../scripts/lib/render-pdf.ts';
import { buildXlsx } from '../helpers/xlsx-builder.ts';

const FONT = new Uint8Array(readFileSync('public/fonts/NotoSansTC-Regular.ttf'));

beforeAll(async () => {
  vi.stubGlobal('fetch', async () => new Response(FONT));
  await import('../../src/formats/pdf'); // loaded lazily by parseDocument; it sets the browser's worker path
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL('node_modules/pdfjs-dist/build/pdf.worker.min.mjs').href;
});

const TYPES: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  txt: 'text/plain',
};
const file = (bytes: Uint8Array | string, name: string) => new File([bytes as BlobPart], name, { type: TYPES[name.split('.').pop()!] });

async function sources(): Promise<LoadedDocument[]> {
  return Promise.all([
    parseDocument(file(await renderDocx(contract()), 'contract.docx')),
    parseDocument(file(await buildXlsx(customers()), 'customers.xlsx')),
    parseDocument(file(await renderPdf(contract(), FONT), 'contract.pdf')),
    parseDocument(file('客戶王小明，手機 0912-345-678，信箱 amy.chen@gmail.com。', 'note.txt')),
  ]);
}

describe('output that needs no restoring', () => {
  it.each(['label', 'blank'] as MarkerStyle[])('writes %s markers in every format, with no code and no hidden value', async (style) => {
    for (const doc of await sources()) {
      const book = new CodeBook();
      const items = detect(doc.text, BUILTIN_PATTERNS, book);
      resplitItems(items, book, () => ({ mode: 'preview' })); // 部分保留, the default output mode
      const { edits, mapping } = applyRedactions(doc.text, items, style);
      expect(mapping).toEqual([]);
      const ext = doc.fileName.split('.').pop()!;
      const out = await parseDocument(file(new Uint8Array(await (await generateDocument(doc, edits)).arrayBuffer()), `out.${ext}`));
      expect(parseMarkers(out.text), doc.fileName).toEqual([]);
      for (const it of items.filter((i) => i.active && i.original.length >= 6)) {
        const hidden = it.original.slice(it.head ?? 0, it.original.length - (it.tail ?? 0));
        if (hidden.length >= 4) expect(out.text, `${doc.fileName}: ${it.original}`).not.toContain(hidden);
      }
      if (style === 'label') expect(out.text).toMatch(/\[(姓名|手機|電子郵件)\]/);
      else expect(out.text).toContain('○○');
    }
  });
});
