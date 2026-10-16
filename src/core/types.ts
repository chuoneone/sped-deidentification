export type DocFormat = 'txt' | 'md' | 'docx' | 'xlsx' | 'pdf';

export const CATEGORIES = ['姓名', '身分證', '手機', '市話', '地址', '電子郵件', '公司', '統編', '識別碼', '國際電話', '信用卡', 'SSN', 'IBAN', 'IP', '生日', '學校', '班級', '學號', '醫院', '診斷'] as const;
export type Category = (typeof CATEGORIES)[number];

/** How much of a detected value stays visible outside the marker (see core/retention.ts). */
export type Retention =
  | { mode: 'none' }
  | { mode: 'ends'; head: number; tail: number }
  | { mode: 'delim'; delimiter: string; side: 'before' | 'after' }
  | { mode: 'surname' }
  | { mode: 'city' }
  | { mode: 'district' }
  /** The standard 部分保留 per category (see core/retention.ts standardSplit), e.g. A1[身分證], 0912-[手機]. */
  | { mode: 'preview' };

export interface Pattern {
  id: string;
  name: string;
  category: Category;
  source: 'builtin' | 'custom';
  regex: string;
  example: string;
  enabled: boolean;
  retention?: Retention;
  /** Builtin-only: off until switched on in the rules page (see PatternConfig.enabledBuiltins). */
  defaultOff?: boolean;
  /** Builtin-only: the rules page group (學校與特教文件／台灣格式／國際與通用格式); custom rules form their own group. */
  group?: 'sped' | 'tw' | 'intl';
  /** Builtin-only: how matches are checked beyond the RegExp (checksum, valid ranges), shown with the rule. */
  note?: string;
  /**
   * Builtin-only second-pass filter (e.g. checksum). `before` is the text right before the match.
   * A number accepts only that many leading characters (a phone number that ran on into the next one).
   */
  validate?: (match: string, before: string) => boolean | number;
}

export interface RedactionItem {
  id: string;
  category: Category;
  original: string;
  start: number;
  end: number;
  code: string;
  origin: 'auto' | 'manual';
  active: boolean;
  /** Retention from the rule that detected it, or the one chosen when adding it manually. */
  retention?: Retention;
  /** Characters of `original` kept visible before / after the marker; absent means 0. */
  head?: number;
  tail?: number;
}

export interface MappingEntry {
  code: string;
  category: string;
  /** The hidden part only; the full value is prefix + original + suffix. */
  original: string;
  prefix?: string;
  suffix?: string;
}

/** A single replacement in the document's full text, expressed in text offsets. */
export interface TextEdit {
  start: number;
  end: number;
  replacement: string;
}

/** Structure of the document expressed in full-text offsets, used only to render a format-aware preview. */
export interface DocxParagraphLayout {
  start: number;
  end: number;
  style: 'title' | 'heading' | 'normal';
  part: 'body' | 'header' | 'footer';
  table?: { id: number; row: number; col: number };
}
export interface XlsxCellLayout {
  start: number;
  end: number;
  row: number;
  col: number;
}
export interface PdfItemLayout {
  start: number;
  end: number;
  x: number;
  y: number;
  fontSize: number;
  width: number;
  /** Scanned pages: the text's colour as recognised. */
  color?: Rgb;
}
/**
 * A text-free picture cut from a scanned page and kept in the output (PDF points, origin bottom-left).
 * `keep` is switched off from the preview to leave it out.
 */
export interface PdfPicture {
  x: number;
  y: number;
  width: number;
  height: number;
  jpeg: Uint8Array;
  keep: boolean;
}
/** 0–255 per channel. */
export type Rgb = [number, number, number];
/**
 * Layout redrawn from a scanned page as plain vector shapes (never pixels, so they cannot carry text).
 * PDF points, origin bottom-left, on the straightened page.
 */
export interface PdfRule {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  color: Rgb;
  dashed?: boolean;
}
export interface PdfFill {
  x: number;
  y: number;
  width: number;
  height: number;
  color: Rgb;
}
export interface PdfCheckbox {
  /** Bottom-left corner. */
  x: number;
  y: number;
  size: number;
  checked: boolean;
  color: Rgb;
}
/** Structure of a scanned page (all optional; text-layer PDFs have none). */
export interface PdfScanLayout {
  pictures?: PdfPicture[];
  rules?: PdfRule[];
  fills?: PdfFill[];
  checkboxes?: PdfCheckbox[];
}
export type DocLayout =
  | { kind: 'docx'; paragraphs: DocxParagraphLayout[] }
  | { kind: 'xlsx'; sheets: { name: string; cells: XlsxCellLayout[] }[] }
  | { kind: 'pdf'; pages: ({ width: number; height: number; items: PdfItemLayout[] } & PdfScanLayout)[] };

export interface LoadedDocument {
  fileName: string;
  format: DocFormat;
  text: string;
  /** Format-specific data needed to regenerate the file with edits applied. */
  handle: unknown;
  /** Present for docx/xlsx/pdf; plain text formats have none. */
  layout?: DocLayout;
  /** The text was recognised from page images (scanned PDF), not read from a text layer. */
  ocr?: boolean;
}

export interface CustomPatternConfig {
  id: string;
  name: string;
  category: Category;
  regex: string;
  example: string;
  enabled: boolean;
}

export interface PatternConfig {
  version: 1;
  disabledBuiltins: string[];
  /** Builtins that are off by default (defaultOff) and were switched on; absent when none. */
  enabledBuiltins?: string[];
  customPatterns: CustomPatternConfig[];
  /** Retention per pattern id (builtin or custom); missing means hide everything. */
  retention?: Record<string, Retention>;
}

export const MAX_FILE_BYTES = 100 * 1024 * 1024;
