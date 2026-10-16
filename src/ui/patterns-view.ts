import type { Category, CustomPatternConfig, Pattern, PatternConfig } from '../core/types';
import { CATEGORIES } from '../core/types';
import { getEffectivePatterns, loadConfig, newCustomId, removeCustom, saveConfig, setBuiltinEnabled, upsertCustom, validateRegex } from '../core/pattern-store';
import { describeRetention } from '../core/retention';
import { compilePattern } from '../core/detector';
import { button, clear, el, toast } from './components';

/** Filled into the "new rule" form by the 填入範例 button so first-time users can see a working rule end to end. */
const SAMPLE_RULE = {
  name: '員工編號',
  category: '識別碼' as Category,
  regex: 'EMP-\\d{6}',
  sample: '承辦人員工編號 EMP-004521，協辦 EMP-000317；舊制編號 EMP-12345 位數不足，不會命中。',
};

/** Prompt users can paste into an AI assistant to get a rule that fits this tool's RegExp constraints. */
const AI_PROMPT = [
  '請幫我寫一個 JavaScript 正規表達式，偵測文件中的：（例如：員工編號，EMP- 開頭接 6 位數字）',
  '',
  "限制：以 new RegExp(規則, 'gu') 搜尋整份文件；不要加斜線、flags、^ 或 $；不可比對空字串；避免誤抓一般文字。",
  '',
  '請只回覆以下四項：',
  '1. 名稱',
  `2. 類別（${CATEGORIES.join('／')} 擇一）`,
  '3. 規則',
  '4. 測試文字：一段 2～3 句的文字，同時包含應命中與不應命中的例子',
].join('\n');

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard) return navigator.clipboard.writeText(text);
  // Plain-http intranet hosting has no navigator.clipboard; fall back to the legacy command.
  const ta = el('textarea', { readonly: true, style: 'position:fixed;opacity:0' });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  if (!ok) throw new Error('copy failed');
}

/** What is open on the page: the form, and the rules whose details are shown. Not stored. */
const ui = { formOpen: false, details: new Set<string>(), closedGroups: new Set<string>() };

const GROUPS = [
  { id: 'sped', title: '學校與特教文件' },
  { id: 'tw', title: '台灣格式' },
  { id: 'intl', title: '國際與通用格式' },
  { id: 'custom', title: '自訂規則' },
] as const;

export function createPatternsView(): HTMLElement {
  const root = el('section', { class: 'view patterns-view' });
  render(root);
  return root;
}

function render(root: HTMLElement, editing: CustomPatternConfig | null = null): void {
  clear(root);
  const config = loadConfig();
  const patterns = getEffectivePatterns(config);
  const form = ui.formOpen || editing ? renderForm(root, config, editing) : null;
  root.append(
    el('div', { class: 'rules-head' },
      el('h2', {}, '偵測規則'),
      form ? null : button('＋ 新增自訂規則', () => {
        ui.formOpen = true;
        render(root);
      }, 'btn btn-primary add-rule'),
    ),
    el('p', { class: 'muted small' }, '內建規則可停用、不可修改；自訂規則可新增、編輯、刪除。點「查看規則」可看完整的比對規則（JavaScript RegExp，flags: gu）、檢核方式與預設保留方式。設定只存在你的瀏覽器。'),
    ...(form ? [form] : []),
    ...GROUPS.map((g) => renderGroup(root, config, g, patterns.filter((p) => (g.id === 'custom' ? p.source === 'custom' : p.group === g.id)))),
  );
  form?.querySelector<HTMLInputElement>('input')?.focus();
}

/** Switches a rule on or off in the stored settings. */
function setEnabled(config: PatternConfig, p: Pattern, enabled: boolean): PatternConfig {
  if (p.source === 'builtin') return setBuiltinEnabled(config, p.id, enabled);
  return upsertCustom(config, { ...config.customPatterns.find((c) => c.id === p.id)!, enabled });
}

function renderGroup(root: HTMLElement, config: PatternConfig, group: (typeof GROUPS)[number], patterns: Pattern[]): HTMLElement {
  const on = patterns.filter((p) => p.enabled).length;
  const all = el('input', { type: 'checkbox', class: 'group-toggle', 'aria-label': `${group.title}全部啟用` }) as HTMLInputElement;
  all.checked = patterns.length > 0 && on === patterns.length;
  all.indeterminate = on > 0 && on < patterns.length;
  all.disabled = patterns.length === 0;
  // Inside the summary: a click on the box must not also fold the group.
  all.addEventListener('click', (e) => e.stopPropagation());
  all.addEventListener('change', () => {
    let next = config;
    for (const p of patterns) next = setEnabled(next, p, all.checked);
    saveConfig(next);
    toast(`${group.title}已全部${all.checked ? '啟用' : '停用'}`, 'success', 1500);
    render(root);
  });
  const box = el('details', { class: 'rule-group', 'data-group': group.id, open: !ui.closedGroups.has(group.id) && (group.id !== 'custom' || patterns.length > 0) }) as HTMLDetailsElement;
  box.addEventListener('toggle', () => (box.open ? ui.closedGroups.delete(group.id) : ui.closedGroups.add(group.id)));
  box.append(
    el('summary', { class: 'rule-group-head' },
      el('span', { class: 'rule-group-title' }, `${group.title}（${patterns.length}）`),
      el('label', { class: 'group-toggle-label muted small' }, all, ' 全部啟用'),
    ),
    patterns.length === 0
      ? el('p', { class: 'muted small rule-empty' }, '尚無自訂規則。按「＋ 新增自訂規則」可以用正規表達式新增，例如員工編號、病歷號碼。')
      : el('div', { class: 'rule-list' }, ...patterns.flatMap((p) => renderRule(root, config, p))),
  );
  return box;
}

function renderRule(root: HTMLElement, config: PatternConfig, p: Pattern): HTMLElement[] {
  const toggle = el('input', { type: 'checkbox', class: 'rule-toggle', 'aria-label': `啟用 ${p.name}` }) as HTMLInputElement;
  toggle.checked = p.enabled;
  toggle.addEventListener('change', () => {
    saveConfig(setEnabled(config, p, toggle.checked));
    toast(`${p.name} 已${toggle.checked ? '啟用' : '停用'}`, 'success', 1500);
    render(root);
  });
  const open = ui.details.has(p.id);
  const more = button(open ? '收合' : '查看規則', () => {
    if (open) ui.details.delete(p.id);
    else ui.details.add(p.id);
    render(root);
  }, 'btn btn-small btn-ghost rule-more');
  more.setAttribute('aria-expanded', String(open));
  const row = el('div', { class: `rule-row${p.enabled ? '' : ' row-disabled'}`, 'data-id': p.id },
    el('label', { class: 'switch' }, toggle),
    el('span', { class: 'rule-name' }, p.name),
    el('span', { class: `badge badge-${p.category}` }, p.category),
    el('span', { class: 'rule-example muted small', title: p.example }, p.example),
    more,
  );
  if (!open) return [row];
  const custom = config.customPatterns.find((c) => c.id === p.id);
  const kept = p.retention && p.retention.mode !== 'none';
  const detail = el('dl', { class: 'rule-detail' },
    el('dt', {}, '比對規則'), el('dd', {}, el('code', { class: 'regex' }, p.regex)),
    p.note ? el('dt', {}, '檢核') : null, p.note ? el('dd', {}, p.note) : null,
    el('dt', {}, '預設保留'), el('dd', {}, el('span', { class: kept ? 'tag tag-kept' : '' }, describeRetention(p.retention)), el('span', { class: 'muted small' }, '（輸出設定選「自訂」時套用；要調整請到「去識別化」頁按「設為預設」）')),
    el('dt', {}, '來源'), el('dd', {}, p.source === 'builtin' ? '內建' : '自訂'),
    custom
      ? el('dd', { class: 'rule-actions' },
          button('編輯', () => render(root, custom), 'btn btn-small'),
          button('刪除', () => {
            if (!confirm(`刪除自訂規則「${p.name}」？`)) return;
            saveConfig(removeCustom(config, p.id));
            render(root);
          }, 'btn btn-small btn-danger'),
        )
      : null,
  );
  return [row, detail];
}

function renderForm(root: HTMLElement, config: PatternConfig, editing: CustomPatternConfig | null): HTMLElement {
  const name = el('input', { class: 'input', placeholder: '例如：員工編號', value: editing?.name ?? '' }) as HTMLInputElement;
  const category = el('select', { class: 'select' }, ...CATEGORIES.map((c) => el('option', { value: c }, c))) as HTMLSelectElement;
  category.value = editing?.category ?? '識別碼';
  const regex = el('input', { class: 'input mono', placeholder: '例如：EMP-\\d{6}', value: editing?.regex ?? '' }) as HTMLInputElement;
  const sample = el('textarea', { class: 'input', rows: '3', placeholder: '貼上測試文字，即時檢視命中結果；第一筆命中會作為規則列表的範例' }) as HTMLTextAreaElement;
  sample.value = editing?.example ?? '';
  const regexError = el('div', { class: 'field-error' });
  const hits = el('div', { class: 'hits' });

  /** Matches of the current rule in the test text (empty when the rule is invalid). */
  const matches = (): string[] => {
    if (validateRegex(regex.value) || !sample.value) return [];
    const re = compilePattern({ regex: regex.value } as Pattern);
    return re ? [...sample.value.matchAll(re)].map((m) => m[0]) : [];
  };

  const preview = () => {
    const err = validateRegex(regex.value);
    regexError.textContent = err ?? '';
    clear(hits);
    if (err || !sample.value) return;
    const found = matches();
    hits.append(found.length === 0 ? el('span', { class: 'muted' }, '無命中') : el('span', {}, `命中 ${found.length} 筆：`), ...found.map((f) => el('mark', { class: 'mark mark-識別碼' }, f)));
  };
  regex.addEventListener('input', preview);
  sample.addEventListener('input', preview);
  if (editing) preview();

  const save = () => {
    const err = validateRegex(regex.value);
    if (err) {
      regexError.textContent = err;
      return;
    }
    if (!name.value.trim()) {
      toast('請輸入規則名稱', 'error');
      return;
    }
    try {
      const next = upsertCustom(config, {
        id: editing?.id ?? newCustomId(),
        name: name.value.trim(),
        category: category.value as Category,
        regex: regex.value,
        example: matches()[0] ?? editing?.example ?? '',
        enabled: editing?.enabled ?? true,
      });
      saveConfig(next);
      toast(editing ? '規則已更新' : '規則已新增', 'success');
      ui.formOpen = false;
      render(root);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const fillSample = () => {
    name.value = SAMPLE_RULE.name;
    category.value = SAMPLE_RULE.category;
    regex.value = SAMPLE_RULE.regex;
    sample.value = SAMPLE_RULE.sample;
    preview();
    toast('已填入範例規則，可直接修改，再按「新增規則」儲存', 'info', 3000);
  };
  const copyPrompt = async () => {
    try {
      await copyToClipboard(AI_PROMPT);
      toast('已複製提示詞，貼給 ChatGPT、Claude 或 Gemini 並改寫第一行要偵測的內容；回覆的測試文字可貼到「測試文字」驗證', 'success', 6000);
    } catch {
      toast('無法存取剪貼簿，請改用支援的瀏覽器', 'error');
    }
  };

  return el(
    'div',
    { class: 'form-card' },
    el('h3', {}, editing ? `編輯自訂規則：${editing.name}` : '新增自訂規則'),
    el('div', { class: 'form-grid' },
      el('label', {}, '名稱', name),
      el('label', {}, '類別', category),
      el('label', { class: 'span-2' }, '比對規則（RegExp）', regex, regexError),
      el('label', { class: 'span-2' }, '測試文字', sample, hits),
      el('p', { class: 'muted small span-2' }, '要保留部分字元（例如員工證保留第 1 碼＝部門代碼），請在「去識別化」頁的輸出設定把「保留」選「自訂」調整，再按「設為預設」。'),
    ),
    el('div', { class: 'form-actions' },
      button(editing ? '儲存變更' : '新增規則', save, 'btn btn-primary'),
      button(editing ? '取消編輯' : '取消', () => {
        ui.formOpen = false;
        render(root);
      }, 'btn btn-ghost'),
      editing ? null : button('填入範例', fillSample, 'btn'),
      el('button', { class: 'btn', type: 'button', 'data-tip': AI_PROMPT, onClick: () => void copyPrompt() }, '複製 AI 提示詞'),
    ),
  );
}

