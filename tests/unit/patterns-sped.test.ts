import { describe, it, expect } from 'vitest';
import { BUILTIN_PATTERNS } from '../../src/core/patterns';
import { detect } from '../../src/core/detector';
import { standardSplit } from '../../src/core/retention';
import type { Pattern } from '../../src/core/types';

function getPattern(id: string): Pattern {
  const p = BUILTIN_PATTERNS.find((p) => p.id === id);
  if (!p) throw new Error(`pattern not found: ${id}`);
  return p;
}

function matches(id: string, text: string): string[] {
  return detect(text, [getPattern(id)]).map((i) => i.original);
}

function all(text: string): string[] {
  return detect(text, BUILTIN_PATTERNS).map((i) => `${i.category}:${i.original}`);
}

describe('sped-label-name', () => {
  it('takes the name after a person label, whatever the surname', () => {
    expect(matches('sped-label-name', '學生姓名：鄔小華\n家長：酆大同先生')).toEqual(['鄔小華', '酆大同']);
  });

  it('takes the next table cell when the label stands alone', () => {
    expect(matches('sped-label-name', '導師\n闞志強\n')).toEqual(['闞志強']);
  });

  it('takes every name in an attendance list, skipping roles', () => {
    expect(matches('sped-label-name', '出席人員：王大明（家長）、林小華、陳老師')).toEqual(['王大明', '林小華', '陳老師']);
  });

  it('skips roles, placeholders and running text after a label', () => {
    expect(matches('sped-label-name', '家長：同上\n記錄：本週學生上課專心度提升')).toEqual([]);
  });

  it('needs a colon on the same line, so 學生學習 is not a name', () => {
    expect(matches('sped-label-name', '學生學習動機低落')).toEqual([]);
  });
});

describe('sped-name-link', () => {
  it('also hides the given name alone and repeats of a labelled name', () => {
    const text = '學生：鄔小華\n小華今天情緒穩定，鄔小華完成作業。';
    expect(all(text).filter((x) => x.startsWith('姓名'))).toEqual(['姓名:鄔小華', '姓名:小華', '姓名:鄔小華']);
  });

  it('does not spread the given name of a name guessed from running text', () => {
    // 兒「童教育」is no name; its「教育」must not be hidden everywhere else.
    const text = '王小明接受兒童教育。小明喜歡畫畫。發展、醫療與教育史';
    expect(all(text).filter((x) => x.startsWith('姓名'))).toEqual(['姓名:王小明']);
  });

  it('can be switched off', () => {
    const patterns = BUILTIN_PATTERNS.map((p) => (p.id === 'sped-name-link' ? { ...p, enabled: false } : p));
    const names = detect('學生：鄔小華\n小華今天情緒穩定', patterns).map((i) => i.original);
    expect(names).toEqual(['鄔小華']);
  });
});

describe('sped-school', () => {
  it('matches full and short school names', () => {
    expect(matches('sped-school', '就讀宜蘭縣立凱旋國民中學，前一階段為羅東國小。')).toEqual(['宜蘭縣立凱旋國民中學', '羅東國小']);
  });

  it('skips generic mentions', () => {
    expect(matches('sped-school', '升上國中後，在一般國小的經驗')).toEqual([]);
  });
});

describe('sped-class and sped-student-no', () => {
  it('matches class forms', () => {
    expect(matches('sped-class', '七年三班、8年12班、九年級忠班、701班，班級：802')).toEqual(['七年三班', '8年12班', '九年級忠班', '701班', '802']);
  });

  it('matches labelled student numbers and folder names', () => {
    expect(matches('sped-student-no', '學號：70123\n70456_王小明')).toEqual(['70123', '70456']);
  });

  it('prefers 學號 over a number that also passes the 統編 checksum', () => {
    expect(all('學號：04595257')).toEqual(['學號:04595257']);
  });
});

describe('sped-hospital and sped-diagnosis', () => {
  it('matches hospitals and early-intervention centres', () => {
    expect(matches('sped-hospital', '經羅東博愛醫院評估，轉介宜蘭早療中心')).toEqual(['羅東博愛醫院', '宜蘭早療中心']);
  });

  it('matches disability categories, diagnoses and medication', () => {
    expect(matches('sped-diagnosis', '學習障礙，伴隨ADHD，服用利他能')).toEqual(['學習障礙', 'ADHD', '利他能']);
  });
});

describe('standard partial retention', () => {
  it('keeps the school and hospital type, the grade, and nothing of a given name', () => {
    expect(standardSplit('學校', '凱旋國中')).toEqual({ head: 0, tail: 2 });
    expect(standardSplit('醫院', '羅東博愛醫院')).toEqual({ head: 0, tail: 2 });
    expect(standardSplit('班級', '七年三班')).toEqual({ head: 2, tail: 0 });
    expect(standardSplit('班級', '701班')).toEqual({ head: 1, tail: 0 });
    expect(standardSplit('姓名', '小華')).toEqual({ head: 0, tail: 0 });
    expect(standardSplit('姓名', '王小明')).toEqual({ head: 1, tail: 0 });
  });
});

describe('zh-name in IEP wording', () => {
  it('skips everyday IEP words that start with a surname character', () => {
    const text =
      '懷孕過程無特殊狀況，與同齡兒童無異，幼童時期接受兒童教育。施測結果顯示魏氏兒童智力量表偏低。' +
      '管教方式民主，溫和有禮，易分心。健康狀況：身高體重正常。簡化作業。';
    expect(matches('zh-name', text)).toEqual([]);
  });

  it('still finds real names next to those words', () => {
    expect(matches('zh-name', '童小芬同學與高志明老師')).toEqual(['童小芬', '高志明']);
  });

  it('does not read 完成國中 as a school', () => {
    expect(matches('sped-school', '能完成國中一年級程度數學運算')).toEqual([]);
  });
});
