import type { OcrProgress } from '../formats/ocr';
import { button, el } from './components';

/** First-time download: one engine variant (3.9 MB), the two language models (4.6 MB) and the worker. */
const DOWNLOAD_MB = 9;

export interface OcrOverlay {
  update(p: OcrProgress): void;
  close(): void;
}

/**
 * The recognition screen for an image-only PDF (specs/004-scanned-pdf-ocr/contracts/ocr-progress-ui.md).
 * Nothing is shown until the first update, so ordinary files never see it. It lives on <body>, so the
 * cancel button stays usable while #app is inert.
 */
export function ocrOverlay(fileName: string, onCancel: () => void): OcrOverlay {
  const thumb = el('img', { class: 'ocr-thumb-img', alt: '', hidden: true });
  const count = el('span', { class: 'ocr-count' }, '準備中');
  const fill = el('div', { class: 'ocr-bar-fill' });
  const bar = el('div', { class: 'ocr-bar is-indeterminate', role: 'progressbar', 'aria-label': '辨識進度', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, fill);
  const stage = el('div', { class: 'muted small' });
  const cancel = button('取消辨識', onCancel, 'btn');
  const box = el(
    'div',
    { class: 'ocr-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ocr-title' },
    el('div', { class: 'ocr-card' },
      el('div', { class: 'ocr-main' },
        el('div', { class: 'ocr-thumb' }, thumb, el('div', { class: 'ocr-scanline' })),
        el('div', { class: 'ocr-info' },
          el('h2', { id: 'ocr-title' }, '正在辨識圖片文字'),
          el('div', { class: 'ocr-file', title: fileName }, fileName),
          count,
          bar,
          stage,
        ),
      ),
      el('p', { class: 'ocr-note muted small' }, `這是圖片型（掃描）PDF，需在瀏覽器內辨識文字。首次使用會從本站下載約 ${DOWNLOAD_MB} MB 的辨識模型；文件只在本機處理，不會上傳。`),
      el('div', { class: 'ocr-actions' }, cancel),
    ),
  );
  return {
    update(p) {
      if (!box.isConnected) {
        document.body.append(box);
        cancel.focus();
      }
      const engine = p.stage === 'engine';
      const pct = Math.round(p.progress * 100);
      count.textContent = engine ? '準備中' : `第 ${p.page} / ${p.pages} 頁・${pct}%`;
      stage.textContent = engine
        ? '準備辨識引擎（首次需下載模型）…'
        : p.step === 'orient'
          ? `判斷第 ${p.page} 頁方向並轉正…`
          : p.step === 'layout'
            ? `分析第 ${p.page} 頁的表格、勾選框與圖片…`
            : `辨識第 ${p.page} 頁文字…`;
      bar.classList.toggle('is-indeterminate', engine);
      bar.setAttribute('aria-valuenow', String(pct));
      fill.style.width = engine ? '' : `${pct}%`;
      if (p.thumbnail && thumb.src !== p.thumbnail) {
        thumb.src = p.thumbnail;
        thumb.hidden = false;
      }
    },
    close: () => box.remove(),
  };
}
