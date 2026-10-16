import { MAX_FILE_BYTES } from '../core/types';

type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | ((e: Event) => void)> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') node.addEventListener(k.replace(/^on/, '').toLowerCase(), v);
    else if (typeof v === 'boolean') {
      if (v) node.setAttribute(k, '');
    } else if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let toastHost: HTMLElement | null = null;
export function toast(message: string, kind: 'info' | 'error' | 'success' = 'info', ms = 4000): void {
  if (!toastHost) {
    toastHost = el('div', { class: 'toast-host' });
    document.body.append(toastHost);
  }
  const t = el('div', { class: `toast toast-${kind}` }, message);
  toastHost.append(t);
  setTimeout(() => t.remove(), ms);
}

let busyDepth = 0;
let busyTimer: ReturnType<typeof setTimeout> | undefined;
let busyEl: HTMLElement | null = null;

/**
 * Runs `fn` with the app made inert (no clicks, no focus) and, once it has taken more than a
 * blink, a full-screen "working" overlay so the user can see something is happening.
 * Nested calls share one overlay; the outermost label is the one shown.
 */
export async function withBusy<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const app = document.getElementById('app');
  if (busyDepth++ === 0) {
    app?.setAttribute('inert', '');
    busyTimer = setTimeout(() => {
      if (!busyEl) {
        busyEl = el('div', { class: 'busy-overlay', role: 'status', 'aria-live': 'polite' },
          el('div', { class: 'busy-box' }, el('span', { class: 'spinner' }), el('span', { class: 'busy-label' })));
        document.body.append(busyEl);
      }
      busyEl.querySelector('.busy-label')!.textContent = label;
      busyEl.hidden = false;
    }, 150);
  }
  try {
    return await fn();
  } finally {
    if (--busyDepth === 0) {
      clearTimeout(busyTimer);
      if (busyEl) busyEl.hidden = true;
      app?.removeAttribute('inert');
    }
  }
}

/** A notice the user must acknowledge before going on (native modal <dialog>, above the busy overlay). */
export function alertDialog(title: string, ...body: Child[]): Promise<void> {
  return new Promise((resolve) => {
    const dialog = el('dialog', { class: 'alert-dialog', role: 'alertdialog', 'aria-labelledby': 'alert-dialog-title' });
    const ok = button('我知道了', () => dialog.close(), 'btn btn-primary');
    dialog.append(el('h2', { id: 'alert-dialog-title' }, title), ...body.filter((c): c is Node | string => !!c), el('div', { class: 'alert-dialog-actions' }, ok));
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve();
    });
    document.body.append(dialog);
    dialog.showModal();
    ok.focus();
  });
}

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Files over the size limit are not loaded; a blocking warning lists them first. Returns the rest. */
export async function rejectOversized(files: File[]): Promise<File[]> {
  const tooBig = files.filter((f) => f.size > MAX_FILE_BYTES);
  if (tooBig.length > 0) {
    await alertDialog(
      `檔案超過 ${MAX_FILE_BYTES / 1024 / 1024} MB 上限`,
      el('p', {}, tooBig.length === files.length ? '以下檔案太大，無法載入：' : '以下檔案太大，不會載入；其他檔案會照常處理：'),
      el('ul', { class: 'alert-dialog-list' }, ...tooBig.map((f) => el('li', {}, `${f.name}（${megabytes(f.size)}）`))),
      el('p', { class: 'muted small' }, '所有處理都在瀏覽器記憶體內進行，過大的檔案可能讓分頁當掉。請先分割檔案（例如依章節、工作表或頁數拆開）再上傳。'),
    );
  }
  return files.filter((f) => f.size <= MAX_FILE_BYTES);
}

export interface DropZoneOptions {
  accept: string;
  label: string;
  hint?: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
}

export function dropZone(opts: DropZoneOptions): HTMLElement {
  const input = el('input', { type: 'file', accept: opts.accept, hidden: true, multiple: !!opts.multiple });
  input.addEventListener('change', () => {
    if (input.files?.length) opts.onFiles(Array.from(input.files));
    input.value = '';
  });
  const zone = el(
    'div',
    { class: 'dropzone', tabindex: '0', role: 'button' },
    el('div', { class: 'dropzone-label' }, opts.label),
    opts.hint ? el('div', { class: 'dropzone-hint' }, opts.hint) : null,
    input,
  );
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') input.click();
  });
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('dragover');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) opts.onFiles(files);
  });
  return zone;
}

export function button(label: string, onClick: () => void, cls = 'btn'): HTMLButtonElement {
  return el('button', { class: cls, type: 'button', onClick: () => onClick() }, label);
}

let tipEl: HTMLElement | null = null;
/** One global tooltip for every element carrying `data-tip`; lives on <body> so scroll containers cannot clip it. */
export function installTooltips(): void {
  const show = (target: HTMLElement) => {
    if (!tipEl) {
      tipEl = el('div', { class: 'tooltip', role: 'tooltip' });
      document.body.append(tipEl);
    }
    tipEl.textContent = target.dataset.tip ?? '';
    tipEl.hidden = false;
    const r = target.getBoundingClientRect();
    const tw = tipEl.offsetWidth;
    const th = tipEl.offsetHeight;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - tw - 8));
    const top = r.bottom + 6 + th > window.innerHeight ? r.top - th - 6 : r.bottom + 6;
    tipEl.style.left = `${left}px`;
    tipEl.style.top = `${top}px`;
  };
  const hide = () => {
    if (tipEl) tipEl.hidden = true;
  };
  document.addEventListener('mouseover', (e) => {
    const t = (e.target as Element | null)?.closest<HTMLElement>('[data-tip]');
    if (t) show(t);
    else hide();
  });
  document.addEventListener('scroll', hide, true);
}
