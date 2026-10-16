import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEY } from '../../src/core/pattern-store';

// What is open on the page (form, rule details) lives in the module: load a fresh copy per test.
let createPatternsView: typeof import('../../src/ui/patterns-view').createPatternsView;

const byLabel = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('.form-actions button')].find((b) => b.textContent === label)!;

beforeEach(async () => {
  vi.resetModules();
  ({ createPatternsView } = await import('../../src/ui/patterns-view'));
  localStorage.clear();
  // Only drop earlier views: wiping <body> would detach the toast host that components.ts keeps a reference to.
  document.querySelectorAll('.patterns-view').forEach((v) => v.remove());
});

/** The page, with the 新增自訂規則 form opened when asked. */
function view(openForm = false): HTMLElement {
  const v = createPatternsView();
  document.body.append(v);
  if (openForm) v.querySelector<HTMLButtonElement>('button.add-rule')!.click();
  return v;
}
const group = (v: HTMLElement, id: string) => v.querySelector<HTMLDetailsElement>(`.rule-group[data-group=${id}]`)!;
const rule = (v: HTMLElement, id: string) => v.querySelector<HTMLElement>(`.rule-row[data-id="${id}"]`)!;
const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');

describe('patterns view rule groups', () => {
  it('groups the rules into 學校與特教文件, 台灣格式, 國際與通用格式 and 自訂規則, one line each with no RegExp in sight', () => {
    const v = view();
    expect([...v.querySelectorAll('.rule-group-title')].map((t) => t.textContent)).toEqual(['學校與特教文件（8）', '台灣格式（7）', '國際與通用格式（8）', '自訂規則（0）']);
    expect([...group(v, 'intl').querySelectorAll('.rule-row')].map((r) => r.getAttribute('data-id'))).toEqual(['us-ssn', 'email', 'intl-phone', 'credit-card', 'iban', 'ipv4', 'ipv6', 'dob']);
    expect(rule(v, 'credit-card').querySelector('.badge-信用卡')!.textContent).toBe('信用卡');
    expect(v.querySelector('code.regex')).toBeNull();
    expect(group(v, 'custom').open).toBe(false);
    expect(group(v, 'custom').textContent).toContain('尚無自訂規則');
  });

  it('shows a rule\'s RegExp, check and default on 查看規則, and folds it again', () => {
    const v = view();
    rule(v, 'tw-id').querySelector<HTMLButtonElement>('.rule-more')!.click();
    const detail = v.querySelector('.rule-detail')!;
    expect(detail.querySelector('code.regex')!.textContent).toBe('(?<![A-Za-z0-9])[A-Z][12]\\d{8}(?!\\d)');
    expect(detail.textContent).toContain('檢核碼');
    expect(detail.textContent).toContain('預設保留');
    rule(v, 'tw-id').querySelector<HTMLButtonElement>('.rule-more')!.click();
    expect(v.querySelector('.rule-detail')).toBeNull();
  });

  it('switches a whole group off and on, showing a partly enabled group as such', () => {
    const v = view();
    const all = group(v, 'intl').querySelector<HTMLInputElement>('.group-toggle')!;
    all.checked = false;
    all.dispatchEvent(new Event('change'));
    expect(stored().disabledBuiltins).toEqual(['us-ssn', 'email', 'intl-phone', 'credit-card', 'iban', 'ipv4', 'ipv6', 'dob']);
    const one = rule(v, 'email').querySelector<HTMLInputElement>('.rule-toggle')!;
    one.checked = true;
    one.dispatchEvent(new Event('change'));
    expect(group(v, 'intl').querySelector<HTMLInputElement>('.group-toggle')!.indeterminate).toBe(true);
    expect(group(v, 'sped').querySelector<HTMLInputElement>('.group-toggle')!.checked).toBe(true);
    // 中文姓名 is off by default, so 台灣格式 starts partly enabled.
    expect(group(v, 'tw').querySelector<HTMLInputElement>('.group-toggle')!.indeterminate).toBe(true);
    document.querySelectorAll('.toast').forEach((t) => t.remove()); // later tests look for their own toast
  });

  it('opens the 新增自訂規則 form only on request, and closes it on 取消', () => {
    const v = view();
    expect(v.querySelector('.form-card')).toBeNull();
    v.querySelector<HTMLButtonElement>('button.add-rule')!.click();
    expect(v.querySelector('.form-card h3')!.textContent).toBe('新增自訂規則');
    expect(v.querySelector('button.add-rule')).toBeNull();
    byLabel(v, '取消').click();
    expect(v.querySelector('.form-card')).toBeNull();
  });
});

describe('patterns view helpers', () => {
  it('「填入範例」fills every field with a working rule and shows its hits without saving anything', () => {
    const view = createPatternsView();
    document.body.append(view);
    view.querySelector<HTMLButtonElement>('button.add-rule')!.click();
    byLabel(view, '填入範例').click();

    expect(view.querySelector<HTMLInputElement>('input[placeholder="例如：員工編號"]')!.value).toBe('員工編號');
    expect(view.querySelector<HTMLSelectElement>('select')!.value).toBe('識別碼');
    expect(view.querySelector<HTMLInputElement>('input.mono')!.value).toBe('EMP-\\d{6}');
    expect(view.querySelector('input[placeholder="例如：EMP-004521"]')).toBeNull();
    expect(view.querySelector<HTMLTextAreaElement>('textarea')!.value).toContain('EMP-004521');

    const marks = [...view.querySelectorAll('.hits mark')].map((m) => m.textContent);
    expect(marks).toEqual(['EMP-004521', 'EMP-000317']);
    expect(view.querySelector('.hits')!.textContent).toContain('命中 2 筆');
    expect(view.querySelector('.field-error')!.textContent).toBe('');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('「複製 AI 提示詞」previews the prompt on hover and copies it on click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const view = createPatternsView();
    document.body.append(view);
    view.querySelector<HTMLButtonElement>('button.add-rule')!.click();
    const btn = byLabel(view, '複製 AI 提示詞');

    const tip = btn.dataset.tip!;
    expect(tip).toContain('JavaScript 正規表達式');
    expect(tip).toContain("'gu'");
    expect(tip).toContain('識別碼');
    expect(tip).toContain('測試文字');

    btn.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(tip));
    await vi.waitFor(() => expect(document.querySelector('.toast-success')?.textContent).toContain('已複製提示詞'));
  });

  it('hides 「填入範例」while editing an existing rule so it cannot clobber it', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      disabledBuiltins: [],
      customPatterns: [{ id: 'c-1', name: '案號', category: '識別碼', regex: 'CASE-\\d+', example: 'CASE-1', enabled: true }],
    }));
    const view = createPatternsView();
    document.body.append(view);
    view.querySelector<HTMLButtonElement>('.rule-row[data-id="c-1"] .rule-more')!.click();
    [...view.querySelectorAll<HTMLButtonElement>('.rule-actions button')].find((b) => b.textContent === '編輯')!.click();
    expect(view.querySelector('.form-card h3')!.textContent).toBe('編輯自訂規則：案號');
    expect(byLabel(view, '填入範例')).toBeUndefined();
    expect(byLabel(view, '複製 AI 提示詞')).toBeDefined();
  });

  it('saves the first hit in the test text as the rule\'s example', () => {
    const view = createPatternsView();
    document.body.append(view);
    view.querySelector<HTMLButtonElement>('button.add-rule')!.click();
    byLabel(view, '填入範例').click();
    byLabel(view, '新增規則').click();
    expect(view.querySelector('.form-card')).toBeNull(); // closed after saving
    expect(view.querySelector('.rule-group[data-group=custom] .rule-row')).not.toBeNull();
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(saved.customPatterns[0].example).toBe('EMP-004521');
  });
});
