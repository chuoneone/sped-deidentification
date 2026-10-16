import type { DocLayout, DocxParagraphLayout, LoadedDocument, PdfPicture, Rgb } from '../core/types';
import { clear, el } from './components';

/** A highlighted span of the full text: an active redaction, a cancelled one, or a restored value. */
export interface Decoration {
  start: number;
  end: number;
  id?: string;
  kind: 'mark' | 'cancelled' | 'restored';
  /** Text shown in place of the original for 'mark' and 'restored'. */
  label: string;
  className: string;
  tip: string;
}

export interface PreviewOptions {
  /** Ignore the document layout and show plain text. */
  plain?: boolean;
  /** Scanned PDFs: switch a kept picture on or off; without it pictures are shown read-only. */
  onTogglePicture?: (picture: PdfPicture) => void;
}

const pictureUrls = new WeakMap<PdfPicture, string>();
const pictureUrl = (p: PdfPicture): string => {
  let url = pictureUrls.get(p);
  if (!url) pictureUrls.set(p, (url = URL.createObjectURL(new Blob([p.jpeg as BlobPart], { type: 'image/jpeg' }))));
  return url;
};

/**
 * Renders `doc.text[start, end)` into `parent` as plain text spans (data-start/data-plain) and
 * decoration elements (data-id/data-start/data-end/data-tip). A decoration that crosses the
 * range boundary is clipped; its label appears only in the piece where it starts.
 */
function renderRange(parent: Node, text: string, start: number, end: number, decos: Decoration[]): void {
  let cursor = start;
  for (const d of decos) {
    if (d.end <= start) continue;
    if (d.start >= end) break;
    const dStart = Math.max(d.start, start);
    const dEnd = Math.min(d.end, end);
    if (dStart > cursor) parent.appendChild(textSpan(text.slice(cursor, dStart), cursor));
    const attrs: Record<string, string> = { 'data-start': String(d.start), 'data-end': String(d.end), 'data-tip': d.tip };
    if (d.id) attrs['data-id'] = d.id;
    const first = d.start >= start;
    if (d.kind === 'cancelled') {
      parent.appendChild(el('span', { ...attrs, class: `cancelled has-tip ${d.className}` }, text.slice(dStart, dEnd)));
    } else {
      parent.appendChild(el('mark', { ...attrs, class: `mark has-tip ${d.className}${first ? '' : ' mark-cont'}` }, first ? d.label : ''));
    }
    cursor = dEnd;
  }
  if (cursor < end) parent.appendChild(textSpan(text.slice(cursor, end), cursor));
}

function textSpan(text: string, start: number): HTMLElement {
  return el('span', { 'data-start': String(start), 'data-plain': 'true' }, text);
}

function renderPlain(container: HTMLElement, doc: LoadedDocument, decos: Decoration[]): void {
  const box = el('div', { class: 'preview-plain' });
  renderRange(box, doc.text, 0, doc.text.length, decos);
  container.append(box);
}

// ---------------------------------------------------------------------------------------
// Word: paragraphs, headings and tables inside a page-like sheet; header/footer parts boxed.
// ---------------------------------------------------------------------------------------
function renderDocx(container: HTMLElement, doc: LoadedDocument, decos: Decoration[], paragraphs: DocxParagraphLayout[]): void {
  const page = el('div', { class: 'doc-page' });
  const parts: DocxParagraphLayout['part'][] = ['header', 'body', 'footer'];
  for (const part of parts) {
    const list = paragraphs.filter((p) => p.part === part);
    if (list.length === 0) continue;
    const host = part === 'body' ? page : el('div', { class: `doc-part doc-part-${part}` }, el('div', { class: 'doc-part-label' }, part === 'header' ? '頁首' : '頁尾'));
    let i = 0;
    while (i < list.length) {
      const p = list[i];
      if (!p.table) {
        host.append(paragraphEl(p, doc.text, decos));
        i++;
        continue;
      }
      const id = p.table.id;
      const cells = new Map<string, DocxParagraphLayout[]>();
      let rows = 0;
      let cols = 0;
      while (i < list.length && list[i].table?.id === id) {
        const q = list[i];
        const key = `${q.table!.row},${q.table!.col}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key)!.push(q);
        rows = Math.max(rows, q.table!.row + 1);
        cols = Math.max(cols, q.table!.col + 1);
        i++;
      }
      const table = el('table', { class: 'doc-table' });
      for (let r = 0; r < rows; r++) {
        const tr = el('tr', {});
        for (let c = 0; c < cols; c++) {
          const td = el('td', {});
          for (const q of cells.get(`${r},${c}`) ?? []) td.append(paragraphEl(q, doc.text, decos));
          tr.append(td);
        }
        table.append(tr);
      }
      host.append(table);
    }
    if (part !== 'body') page.append(host);
  }
  container.append(page);
}

function paragraphEl(p: DocxParagraphLayout, text: string, decos: Decoration[]): HTMLElement {
  const node = el('p', { class: `doc-p doc-${p.style}` });
  if (p.end > p.start) renderRange(node, text, p.start, p.end, decos);
  else node.append(el('br', {}));
  return node;
}

// ---------------------------------------------------------------------------------------
// Excel: sheet tabs plus a grid with column letters and row numbers.
// ---------------------------------------------------------------------------------------
const MAX_ROWS = 1000;

/** Which sheet the grid shows and how far it is scrolled, carried over when the preview is re-rendered. */
interface GridView {
  sheet: number;
  top: number;
  left: number;
}

function colName(i: number): string {
  let s = '';
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

function renderXlsx(container: HTMLElement, doc: LoadedDocument, decos: Decoration[], sheets: { name: string; cells: { start: number; end: number; row: number; col: number }[] }[], view?: GridView): void {
  const state = { active: view?.sheet ?? 0 };
  const tabs = el('div', { class: 'sheet-tabs' });
  const host = el('div', { class: 'sheet-host' });
  const draw = () => {
    clear(host);
    for (const [i, t] of Array.from(tabs.children).entries()) t.classList.toggle('active', i === state.active);
    const sheet = sheets[state.active];
    const byCell = new Map<string, { start: number; end: number }>();
    let maxRow = 0;
    let maxCol = 0;
    for (const c of sheet.cells) {
      byCell.set(`${c.row},${c.col}`, c);
      maxRow = Math.max(maxRow, c.row);
      maxCol = Math.max(maxCol, c.col);
    }
    const table = el('table', { class: 'sheet-table' });
    const head = el('tr', {}, el('th', {}, ''));
    for (let c = 1; c <= maxCol; c++) head.append(el('th', {}, colName(c)));
    table.append(head);
    const rows = Math.min(maxRow, MAX_ROWS);
    for (let r = 1; r <= rows; r++) {
      const tr = el('tr', {}, el('th', {}, String(r)));
      for (let c = 1; c <= maxCol; c++) {
        const td = el('td', {});
        const cell = byCell.get(`${r},${c}`);
        if (cell) renderRange(td, doc.text, cell.start, cell.end, decos);
        tr.append(td);
      }
      table.append(tr);
    }
    host.append(el('div', { class: 'sheet-scroll', 'data-sheet': String(state.active) }, table));
    if (maxRow > MAX_ROWS) host.append(el('p', { class: 'muted small' }, `僅顯示前 ${MAX_ROWS} 列（共 ${maxRow} 列）；未顯示的列仍會被處理。`));
  };
  sheets.forEach((s, i) => {
    tabs.append(el('button', { class: 'sheet-tab', type: 'button', onClick: () => { state.active = i; draw(); } }, `${s.name}（${s.cells.length}）`));
  });
  container.append(tabs, host);
  draw();
  if (view) {
    const grid = host.querySelector<HTMLElement>('.sheet-scroll')!;
    grid.scrollTop = view.top;
    grid.scrollLeft = view.left;
  }
}

// ---------------------------------------------------------------------------------------
// PDF: each page as a box with text items at their original positions, scaled to fit.
// ---------------------------------------------------------------------------------------
type PdfLayoutPage = Extract<DocLayout, { kind: 'pdf' }>['pages'][number];

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}
const css = ([r, g, b]: Rgb) => `rgb(${r},${g},${b})`;
const pts = (...vs: number[]) => vs.map((v) => Math.round(v * 10) / 10).join(',');

/**
 * A scanned page's fills, rules and checkboxes, drawn in PDF points under the text as in the output.
 * The data-* attributes carry the same shapes in points for `npm run eval:ocr`.
 */
function structureLayer(pg: PdfLayoutPage): SVGElement | null {
  if (!pg.fills?.length && !pg.rules?.length && !pg.checkboxes?.length) return null;
  const layer = svg('svg', { class: 'pdf-structure', viewBox: `0 0 ${pg.width} ${pg.height}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  const flip = (y: number) => pg.height - y;
  for (const f of pg.fills ?? []) {
    layer.append(svg('rect', { x: f.x, y: flip(f.y + f.height), width: f.width, height: f.height, fill: css(f.color), 'data-fill': pts(f.x, f.y, f.width, f.height, ...f.color) }));
  }
  for (const r of pg.rules ?? []) {
    layer.append(svg('line', {
      x1: r.x1, y1: flip(r.y1), x2: r.x2, y2: flip(r.y2), stroke: css(r.color), 'stroke-width': r.width,
      ...(r.dashed && { 'stroke-dasharray': `${r.width * 3} ${r.width * 2}` }),
      'data-rule': pts(r.x1, r.y1, r.x2, r.y2),
    }));
  }
  for (const b of pg.checkboxes ?? []) {
    const line = Math.max(0.5, b.size * 0.09);
    const g = svg('g', { stroke: css(b.color), fill: 'none', 'stroke-width': line, 'data-checkbox': pts(b.x, b.y, b.size, b.checked ? 1 : 0) });
    g.append(svg('rect', { x: b.x, y: flip(b.y + b.size), width: b.size, height: b.size }));
    if (b.checked) {
      const p = (u: number, v: number) => `${b.x + b.size * u},${flip(b.y + b.size * v)}`;
      g.append(svg('polyline', { points: `${p(0.2, 0.5)} ${p(0.42, 0.25)} ${p(0.82, 0.8)}`, 'stroke-width': line * 1.4 }));
    }
    layer.append(g);
  }
  return layer;
}

function renderPdf(container: HTMLElement, doc: LoadedDocument, decos: Decoration[], pages: PdfLayoutPage[], onToggle?: (p: PdfPicture) => void): void {
  const host = el('div', { class: 'pdf-pages' });
  pages.forEach((pg, i) => {
    const page = el('div', { class: 'pdf-page' });
    page.style.setProperty('--w', String(pg.width));
    page.style.setProperty('--h', String(pg.height));
    // Height from the aspect ratio rather than from --s, so the page is already full-size when fit()
    // first measures; an empty-looking scroll container would snap its (and the window's) scroll to 0.
    page.style.aspectRatio = `${pg.width} / ${pg.height}`;
    const structure = structureLayer(pg);
    if (structure) page.append(structure);
    for (const pic of pg.pictures ?? []) {
      const tip = pic.keep ? '不含文字的圖片，會以原影像保留在輸出中；點擊可取消保留' : '已取消保留，輸出不含這張圖片；點擊可改回保留';
      const fig = el('figure', { class: `pdf-picture${pic.keep ? '' : ' is-dropped'}` },
        el('img', { src: pictureUrl(pic), alt: pic.keep ? '保留的圖片' : '已取消保留的圖片' }),
        onToggle
          ? el('button', { type: 'button', class: 'pdf-picture-toggle', 'data-tip': tip, 'aria-pressed': String(pic.keep), onClick: () => onToggle(pic) }, pic.keep ? '✓ 保留' : '✕ 不保留')
          : null,
      );
      fig.style.left = `calc(var(--s) * ${pic.x}px)`;
      fig.style.top = `calc(var(--s) * ${pg.height - pic.y - pic.height}px)`;
      fig.style.width = `calc(var(--s) * ${pic.width}px)`;
      fig.style.height = `calc(var(--s) * ${pic.height}px)`;
      page.append(fig);
    }
    for (const it of pg.items) {
      const span = el('span', { class: 'pdf-item', 'data-w': String(it.width) });
      span.style.left = `calc(var(--s) * ${it.x}px)`;
      span.style.top = `calc(var(--s) * ${pg.height - it.y - it.fontSize * 0.8}px)`;
      span.style.fontSize = `calc(var(--s) * ${it.fontSize}px)`;
      if (it.color) span.style.color = css(it.color);
      renderRange(span, doc.text, it.start, it.end, decos);
      page.append(span);
    }
    host.append(el('div', { class: 'pdf-page-label' }, `第 ${i + 1} 頁 / 共 ${pages.length} 頁`), page);
  });
  container.append(host);
  const fit = () => {
    const width = host.clientWidth || 700;
    for (const page of host.querySelectorAll<HTMLElement>('.pdf-page')) {
      const s = width / Number(page.style.getPropertyValue('--w'));
      page.style.setProperty('--s', String(s));
      // Browser font metrics differ from the PDF's; stretch each item to its original width
      // (the same trick pdf.js uses for its text layer) so items line up instead of overlapping.
      for (const item of page.querySelectorAll<HTMLElement>('.pdf-item')) {
        item.style.transform = '';
        const target = Number(item.dataset.w) * s;
        const actual = item.getBoundingClientRect().width;
        if (target > 0 && actual > 0) item.style.transform = `scaleX(${target / actual})`;
      }
    }
  };
  fit();
  new ResizeObserver(fit).observe(host);
}

export function renderDocumentPreview(container: HTMLElement, doc: LoadedDocument, decorations: Decoration[], opts: PreviewOptions = {}): void {
  // A re-render (after adding or cancelling an item) rebuilds the Excel grid; keep the user's sheet and scroll position.
  const grid = container.querySelector<HTMLElement>('.sheet-scroll');
  const view: GridView | undefined = grid ? { sheet: Number(grid.dataset.sheet), top: grid.scrollTop, left: grid.scrollLeft } : undefined;
  clear(container);
  const decos = [...decorations].sort((a, b) => a.start - b.start);
  const layout = opts.plain ? undefined : doc.layout;
  container.classList.toggle('preview-structured', !!layout);
  if (!layout) return renderPlain(container, doc, decos);
  switch (layout.kind) {
    case 'docx':
      return renderDocx(container, doc, decos, layout.paragraphs);
    case 'xlsx':
      return renderXlsx(container, doc, decos, layout.sheets, view);
    case 'pdf':
      return renderPdf(container, doc, decos, layout.pages, opts.onTogglePicture);
  }
}
