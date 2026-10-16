// Produces the annotated screenshots used in README.md (docs/screenshots/*.png).
// Prerequisite: the built site served at BASE_URL (default: `npm run preview` → http://localhost:4173).
// Run: npm run screenshots
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer, { type Page } from 'puppeteer-core';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4173/';
const OUT = 'docs/screenshots';
const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

mkdirSync(OUT, { recursive: true });

const ANNOTATE = `
window.__shot = (targets) => {
  let st = document.getElementById('shot-style');
  if (!st) { st = document.createElement('style'); st.id = 'shot-style'; document.head.append(st); }
  st.textContent = '.shot-box{outline:3px solid #e53935!important;outline-offset:4px;border-radius:4px}' +
    '.shot-num{position:absolute;z-index:99;background:#e53935;color:#fff;font:bold 15px/1 -apple-system,"Noto Sans TC",sans-serif;' +
    'padding:5px 9px;border-radius:14px;pointer-events:none;box-shadow:0 2px 6px rgba(0,0,0,.3)}';
  document.querySelectorAll('.shot-box').forEach((e) => e.classList.remove('shot-box'));
  document.querySelectorAll('.shot-num').forEach((e) => e.remove());
  for (const [sel, n] of targets) {
    const e = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (!e) { console.warn('shot target missing', sel); continue; }
    e.classList.add('shot-box');
    const r = e.getBoundingClientRect();
    const b = document.createElement('div');
    b.className = 'shot-num';
    b.textContent = String(n);
    b.style.left = (r.left + window.scrollX - 30) + 'px';
    b.style.top = (r.top + window.scrollY - 12) + 'px';
    document.body.append(b);
  }
};`;

async function annotate(page: Page, targets: [string, number][]): Promise<void> {
  await page.evaluate(ANNOTATE);
  await page.evaluate((t) => (window as unknown as { __shot: (x: unknown) => void }).__shot(t), targets);
}

async function shot(page: Page, name: string, fullPage = false): Promise<void> {
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  // The sticky header and footer would be painted over the page content in full-page captures.
  const pinned = (position: string) => page.evaluate((p) => document.querySelectorAll<HTMLElement>('.header, .footer').forEach((e) => (e.style.position = p)), position);
  if (fullPage) await pinned('static');
  await new Promise((r) => setTimeout(r, 250));
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  if (fullPage) await pinned('');
  console.log('saved', `${OUT}/${name}.png`);
}

async function upload(page: Page, inputSelector: string, file: string): Promise<void> {
  const input = await page.waitForSelector(inputSelector);
  await input!.uploadFile(resolve(file));
  await new Promise((r) => setTimeout(r, 600));
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
page.on('dialog', (d) => void d.accept());
await page.goto(BASE_URL, { waitUntil: 'networkidle0' });

// 1. Upload screen (file drop zone + paste box + shared-code options)
await page.evaluate(() => ((document.querySelector('.code-options') as HTMLDetailsElement).open = true));
await annotate(page, [['.tabs', 1], ['.dropzone', 2], ['.paste-area', 3], ['.paste-actions .btn', 4], ['.code-options', 5]]);
await shot(page, '01-upload');

// 2. Preview after detection (list collapsed by default)
await upload(page, '.process-view input[type=file]', 'examples/01-核心流程/委外服務契約書.docx');
await annotate(page, [['.output-panel-summary', 1], ['.preview', 2], ['.list-toggle', 3], ['.toolbar-actions', 4]]);
await shot(page, '02-preview');

// 2a. Batch: several files at once, file panel on the left, zip download
await page.evaluate(() => (document.querySelector('.toolbar-actions .btn-ghost') as HTMLButtonElement).click());
await new Promise((r) => setTimeout(r, 300));
{
  const input = await page.waitForSelector('.process-view input[type=file]');
  await input!.uploadFile(
    ...['委外服務契約書.docx', '報價單.pdf', '客戶資料.xlsx', '客服信件.txt', '專案會議紀錄.md'].map((f) => resolve('examples/01-核心流程/' + f)),
  );
  await page.waitForSelector('.file-panel', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 600));
}
await annotate(page, [['.file-panel', 1], ['.file-item.active', 2], ['.file-panel .btn', 3], ['.btn-strong', 4]]);
await shot(page, '02a-batch');
await page.evaluate(() => (document.querySelector('.toolbar-actions .btn-ghost') as HTMLButtonElement).click());
await new Promise((r) => setTimeout(r, 300));
await upload(page, '.process-view input[type=file]', 'examples/01-核心流程/客戶資料.xlsx');
await annotate(page, [['.sheet-tabs', 1], ['.sheet-scroll', 2], ['.preview-head-tools', 3]]);
await shot(page, '02b-preview-xlsx');
// 2c. PDF preview: pages laid out at original coordinates
await page.evaluate(() => (document.querySelector('.toolbar-actions .btn-ghost') as HTMLButtonElement).click());
await new Promise((r) => setTimeout(r, 300));
await upload(page, '.process-view input[type=file]', 'examples/01-核心流程/報價單.pdf');
await annotate(page, [['.pdf-page-label', 1], ['.pdf-page', 2]]);
await shot(page, '02c-preview-pdf');

// 2f/2g. Scanned (image-only) PDF: the recognition screen, then the preview with the kept pictures
await page.evaluate(() => (document.querySelector('.toolbar-actions .btn-ghost') as HTMLButtonElement).click());
await new Promise((r) => setTimeout(r, 300));
await upload(page, '.process-view input[type=file]', 'examples/01-核心流程/掃描文件.pdf');
await page.waitForFunction(() => !!document.querySelector('.ocr-thumb-img:not([hidden])') && document.querySelector('.ocr-count')!.textContent!.startsWith('第 2'), { timeout: 120000 });
await annotate(page, [['.ocr-thumb', 1], ['.ocr-count', 2], ['.ocr-note', 3], ['.ocr-actions .btn', 4]]);
await shot(page, '02f-ocr-progress');
await page.waitForSelector('.badge-ocr', { timeout: 240000 });
await page.evaluate(() => {
  const photo = document.querySelectorAll('.pdf-picture')[1] as HTMLElement;
  photo.id = 'shot-photo';
  const preview = document.querySelector('.preview') as HTMLElement;
  preview.scrollTop += photo.getBoundingClientRect().top - preview.getBoundingClientRect().top - 260;
});
await annotate(page, [['.badge-ocr', 1], ['.status-info', 2], ['#shot-photo', 3]]);
await shot(page, '02g-scanned-preview');
// 2h. The scanned form: checkboxes, table rules and fills, and the ink colour redrawn
await page.evaluate(() => {
  const first = document.querySelectorAll('.pdf-page')[1].querySelector('[data-checkbox]')!;
  const preview = document.querySelector('.preview') as HTMLElement;
  preview.scrollTop += first.getBoundingClientRect().top - preview.getBoundingClientRect().top - 230;
});
await page.evaluate('globalThis.__name = (f) => f'); // tsx names the helper below
await page.evaluate(() => {
  const form = document.querySelectorAll('.pdf-page')[1];
  // Outlines do not show on SVG shapes: mark each target with a plain box laid over it.
  const mark = (id: string, els: Element[]) => {
    const rs = els.map((e) => e.getBoundingClientRect());
    const [l, t] = [Math.min(...rs.map((r) => r.left)), Math.min(...rs.map((r) => r.top))];
    const d = document.createElement('div');
    d.id = id;
    Object.assign(d.style, { position: 'absolute', pointerEvents: 'none', left: `${l + scrollX}px`, top: `${t + scrollY}px`, width: `${Math.max(...rs.map((r) => r.right)) - l}px`, height: `${Math.max(...rs.map((r) => r.bottom)) - t}px` });
    document.body.append(d);
  };
  const boxes = [...form.querySelectorAll('[data-checkbox]')];
  mark('shot-boxes', boxes.slice(3, 5)); // ☑男 ☐女
  mark('shot-fill', [form.querySelector('[data-fill]')!]);
  const shown = (e: Element) => e.getBoundingClientRect().top > document.querySelector('.preview')!.getBoundingClientRect().top && e.getBoundingClientRect().bottom < innerHeight - 80;
  const ink = [...form.querySelectorAll<HTMLElement>('.pdf-item')].find((s) => shown(s) && !s.querySelector('mark') && /rgb\(\d+, \d+, (\d+)\)/.test(s.style.color) && Number(s.style.color.match(/(\d+)\)$/)![1]) > 120);
  if (ink) mark('shot-ink', [ink]);
});
await annotate(page, [['#shot-boxes', 1], ['#shot-fill', 2], ['#shot-ink', 3]]);
await shot(page, '02h-scanned-form');
await page.evaluate(() => document.querySelectorAll('#shot-boxes, #shot-fill, #shot-ink').forEach((e) => e.remove()));

// back to the contract for the remaining steps
await page.evaluate(() => (document.querySelector('.toolbar-actions .btn-ghost') as HTMLButtonElement).click());
await new Promise((r) => setTimeout(r, 300));
await upload(page, '.process-view input[type=file]', 'examples/01-核心流程/委外服務契約書.docx');

// 2d/2e. Output settings panel: 部分保留 (the default), then 自訂 per category (preview shows the output, codes as [類別])
const setPanel = (open: boolean) => page.evaluate((v) => ((document.querySelector('.output-panel') as HTMLDetailsElement).open = v), open);
await setPanel(true);
await page.click('input[name=output-mode][value=preview]');
await new Promise((r) => setTimeout(r, 300));
await setPanel(true);
await annotate(page, [['.output-rows', 1], ['.output-notice', 2], ['details.by-category > summary', 3], ['details.code-advanced > summary', 4]]);
await shot(page, '02d-output-preview');
await page.click('input[name=output-mode][value=custom]');
await new Promise((r) => setTimeout(r, 300));
await setPanel(true);
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.output-table tr')].find((tr) => tr.textContent!.includes('身分證'))!;
  const sel = row.querySelector('select') as HTMLSelectElement;
  sel.value = 'ends';
  sel.dispatchEvent(new Event('change'));
});
await new Promise((r) => setTimeout(r, 300));
await setPanel(true);
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.output-table tr')].find((tr) => tr.textContent!.includes('身分證'))!;
  const head = row.querySelector('input[type=number]') as HTMLInputElement;
  head.value = '2';
  head.dispatchEvent(new Event('change'));
});
await new Promise((r) => setTimeout(r, 300));
await setPanel(true);
await page.evaluate(() => [...document.querySelectorAll('.output-table tr')].find((tr) => tr.textContent!.includes('身分證'))!.classList.add('shot-row'));
await annotate(page, [['.output-table .shot-row', 1], ['.output-panel .form-actions', 2], ['.status-line .notice', 3]]);
// a taller viewport so the 設為預設 button under the category table stays in the shot with the toolbar
await page.setViewport({ width: 1440, height: 1010, deviceScaleFactor: 2 });
await shot(page, '02e-output-custom');
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
// back to the default 部分保留 with the panel collapsed for the remaining steps
await page.click('input[name=output-mode][value=preview]');
await new Promise((r) => setTimeout(r, 300));
// 2i/2j. Marker style 空白佔位 (no restoring): the options, then the preview and toolbar it leads to
await setPanel(true);
await page.click('input[name=marker-style][value=blank]');
await new Promise((r) => setTimeout(r, 300));
await setPanel(true);
await annotate(page, [['.output-row[data-row=marker] .segmented', 1], ['.output-notice', 2], ['.status-mode', 3]]);
await shot(page, '02i-marker-style');
await setPanel(false);
await page.evaluate(() => window.scrollTo(0, 0));
await new Promise((r) => setTimeout(r, 300));
await annotate(page, [['.mode-pill-final', 1], ['.preview .mark', 2], ['.btn-strong', 3], ['.status-mode', 4]]);
await shot(page, '02j-marker-preview');
await setPanel(true);
await page.click('input[name=marker-style][value=code]');
await new Promise((r) => setTimeout(r, 300));
await setPanel(false);

// 3. Tooltip on hover
await page.evaluate(() => {
  const m = document.querySelectorAll('.preview .mark')[2] as HTMLElement;
  m.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
});
await annotate(page, [['.tooltip', 1]]);
await shot(page, '03-tooltip');
await page.evaluate(() => (document.querySelector<HTMLElement>('.tooltip')!.hidden = true));

// 4. Click a mark → confirmation popup, then cancel it
await page.evaluate(() => {
  const m = document.querySelectorAll('.preview .mark')[2] as HTMLElement;
  m.classList.add('shot-target');
  m.click();
});
await new Promise((r) => setTimeout(r, 200));
await annotate(page, [['.preview .shot-target', 1], ['.add-popup', 2]]);
await shot(page, '04-click-cancel');
await page.evaluate(() => ([...document.querySelectorAll<HTMLButtonElement>('.add-popup .btn')].find((b) => b.textContent === '取消去識別化')!).click());
await new Promise((r) => setTimeout(r, 200));

// 4b. Category switched off in the output panel (市話) + expanded list showing cancelled items
await setPanel(true);
await page.evaluate(() => ((document.querySelector('details.by-category') as HTMLDetailsElement).open = true));
await new Promise((r) => setTimeout(r, 200));
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.output-table tr')].find((tr) => tr.textContent!.includes('市話'))!;
  (row.querySelector('input[type=checkbox]') as HTMLInputElement).click();
});
await new Promise((r) => setTimeout(r, 300));
await setPanel(true);
await page.evaluate(() => (document.querySelector('.list-toggle') as HTMLButtonElement).click());
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => [...document.querySelectorAll('.output-table tr')].find((tr) => tr.textContent!.includes('市話'))!.classList.add('shot-row'));
await annotate(page, [['.output-table .shot-row', 1], ['.cancelled', 2], ['.item-list', 3], ['.item-cancelled .btn', 4]]);
await shot(page, '04b-category-list');
await page.evaluate(() => (document.querySelector('.list-toggle') as HTMLButtonElement).click());
await new Promise((r) => setTimeout(r, 300));
await setPanel(false);

// 4c. Add manually via selection popup
await page.evaluate(() => {
  const plain = [...document.querySelectorAll<HTMLElement>('.preview [data-plain]')].find((s) => s.textContent!.includes('SC-2026-0917'))!;
  const idx = plain.textContent!.indexOf('SC-2026-0917');
  const range = document.createRange();
  range.setStart(plain.firstChild!, idx);
  range.setEnd(plain.firstChild!, idx + 'SC-2026-0917'.length);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  document.querySelector('.preview')!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 200));
await page.select('.add-popup select', '識別碼'); // first select = category (retention choice only shows in 自訂)
await annotate(page, [['.add-popup', 1]]);
await shot(page, '04c-add');
await page.evaluate(() => {
  document.querySelector('.add-popup')?.remove();
  window.getSelection()!.removeAllRanges();
});

// 5. Download bar
await page.evaluate(() => window.scrollTo(0, 0));
await page.evaluate(() => ((document.querySelector('.menu') as HTMLDetailsElement).open = true));
await annotate(page, [['.toolbar-actions .btn-primary', 1], ['.menu-list', 2], ['.status-line', 3]]);
await shot(page, '05-download');
await page.evaluate(() => ((document.querySelector('.menu') as HTMLDetailsElement).open = false));

// 6. Patterns page with a custom rule being tested
await page.click('[data-tab="patterns"]');
await new Promise((r) => setTimeout(r, 300));
await page.click('.rule-row[data-id="tw-id"] .rule-more');
await new Promise((r) => setTimeout(r, 200));
await page.click('button.add-rule');
await new Promise((r) => setTimeout(r, 200));
await page.type('.form-card input[placeholder="例如：員工編號"]', '員工編號');
await page.type('.form-card input.mono', 'EMP-\\d{6}');
await page.type('.form-card textarea', '承辦 EMP-004521 與 EMP-000001');
await annotate(page, [['.form-card', 1], ['.hits', 2], ['.rule-group[data-group=tw] > summary', 3], ['.rule-row .switch', 4], ['.rule-detail', 5]]);
await shot(page, '06-patterns', true);


// 7. Restore page with a missing-code warning
await page.click('[data-tab="restore"]');
await new Promise((r) => setTimeout(r, 300));
const inputs = await page.$$('.restore-view input[type=file]');
await inputs[0].uploadFile(resolve('examples/03-還原/委外服務契約書.deid.docx'));
await new Promise((r) => setTimeout(r, 500));
const csvInput = (await page.$$('.restore-view input[type=file]')).at(-1)!;
await csvInput.uploadFile(resolve('examples/03-還原/委外服務契約書.mapping.缺一列.csv'));
await new Promise((r) => setTimeout(r, 800));
await annotate(page, [['.restore-inputs', 1], ['.restore-result .toolbar', 2], ['.notice-warn', 3], ['.restore-result .preview', 4]]);
await shot(page, '07-restore');

await browser.close();
