import type { Pattern } from './types';

/**
 * 學校與特教文件 rules: IEP, 個案會議紀錄, 輔導紀錄. They run before the general rules so a tie
 * (a 學號 that also passes the 統編 checksum, a 診所 that is also a 公司) keeps the school-specific category.
 */

const CJK = '\\u4e00-\\u9fa5';
const NOT_CJK = `[^${CJK}]`;

/** Same-line `標籤：值`, a tab (spreadsheet cell), or the label alone in a table cell with the value in the next. */
function afterLabel(labels: string, colon: 'required' | 'optional' = 'optional'): string {
  const sep = colon === 'required' ? '[:：]' : '[:：]?';
  return (
    `(?<=(?:${labels})[\\x20\\t]*(?:${sep}|\\t)[\\x20\\t]*` +
    `|(?:^|\\n)[\\x20\\t]*(?:${labels})[\\x20\\t]*[:：]?[\\x20\\t]*\\n[\\x20\\t]*)`
  );
}

// ---------- 姓名（依欄位標籤） ----------

const PERSON_LABELS = [
  '學生姓名', '個案姓名', '家長姓名', '姓名', '學生', '個案', '家長', '監護人', '法定代理人', '主要照顧者', '聯絡人',
  '父親', '母親', '祖父', '祖母', '外公', '外婆', '阿公', '阿嬤',
  '班導師', '班導', '導師', '個管老師', '個管教師', '個案管理老師', '個案管理員', '特教老師', '特教教師', '資源班老師',
  '輔導老師', '輔導教師', '專任輔導教師', '職能治療師', '物理治療師', '語言治療師', '治療師', '臨床心理師', '諮商心理師',
  '心理師', '社工師', '社工', '校長', '教務主任', '學務主任', '輔導主任', '總務主任', '特教組長',
  '主席', '記錄人', '紀錄人', '記錄者', '紀錄者', '記錄', '紀錄', '填表人', '撰寫人', '評量者', '施測者', '簽名', '簽章',
].join('|');

/** Labels followed by several names on one line (出席人員：王大明、林小華、陳老師). */
const LIST_LABELS = '出席人員|出席者|與會人員|列席人員|參與人員|會議成員|出席|列席';

const NAME_END = `(?=$|${NOT_CJK}|及|和|與|先生|小姐|女士|同學|老師|醫師|主任|組長|校長)`;
const NAME_VALUE = `[${CJK}]{2,4}?${NAME_END}`;

const LIST_ITEM_START = `(?:[:：、，,；;／/\\x20\\t(（]|及|和|與)`;
const LABEL_NAME_REGEX =
  `${afterLabel(PERSON_LABELS, 'required')}${NAME_VALUE}` +
  `|(?<=(?:${LIST_LABELS})[\\x20\\t]*[:：](?:[^\\n]*?${LIST_ITEM_START})?[\\x20\\t]*` +
  `|(?:^|\\n)[\\x20\\t]*(?:${LIST_LABELS})[\\x20\\t]*[:：]?[\\x20\\t]*\\n(?:[^\\n]*?${LIST_ITEM_START})?)` +
  NAME_VALUE;

/** Values after a person label that are roles or placeholders, not names. */
const NOT_A_NAME = new Set([
  '家長', '導師', '班導', '學生', '老師', '父親', '母親', '校長', '主任', '組長', '本人', '同上', '如上', '簽名', '簽章',
  '出席', '缺席', '請假', '代理', '代表', '班導師', '個管', '科任', '資源班', '普通班', '治療師', '社工師', '心理師',
  '學務主任', '教務主任', '輔導主任', '總務主任', '特教組長', '個管老師', '特教老師', '輔導老師', '科任老師', '全體',
  '相關人員', '如附件', '詳附件', '未填', '不詳',
]);
const NOT_A_NAME_START = /^(?:各|全體|相關|特教|普通|資源|輔導|個管|科任|班級|行政|學校|本校|專業|任課)/u;

function isLabelledName(m: string): boolean {
  return !NOT_A_NAME.has(m) && !NOT_A_NAME_START.test(m);
}

// ---------- 學校 ----------

/** Characters that never start a school or hospital name but often stand right before one in prose. */
const PLACE_STOP =
  '的了是在有和與及於為等所之已將因向由係即亦並或另也則未不無非對從自以被經卻還又再但而才都皆均便就會能可應須要想願到來去至往' +
  '收付持稱接提說表指認出簽辦負擔購支領遞回聯通告這那該此其每各們呢嗎吧啊麼什怎很太最曾先請讓使給把令當若如個' +
  '升上讀念考轉介診進入學生班級年我你他她看送般';

export const SCHOOL_SUFFIX =
  '國民中學|國民小學|高級中等學校|高級中學|完全中學|實驗中學|實驗小學|實驗教育機構|實驗學校|特殊教育學校|啟智學校|啟聰學校|啟明學校' +
  '|高級商業職業學校|高級工業職業學校|高級農工職業學校|高級家事商業職業學校|科技大學|大學' +
  '|非營利幼兒園|幼兒園|幼稚園|高商|高工|高農|家商|女中|國中|國小|高中|高職|附中|附小|中學|小學';
const PLACE_PREFIX = `(?:(?![${PLACE_STOP}])[${CJK}]){2,14}?`;
const SCHOOL_REGEX = `${PLACE_PREFIX}(?:${SCHOOL_SUFFIX})`;
export const SCHOOL_SUFFIX_RE = new RegExp(`(?:${SCHOOL_SUFFIX})$`, 'u');

/** Generic words that look like a school name's first half (一般國中、鄰近國小、原國小). */
const GENERIC_PLACE_PREFIX = new Set(['原', '舊', '前', '鄰近', '附近', '一般', '普通', '其他', '相關', '公立', '私立', '各級', '台灣', '臺灣', '國內', '國外', '外國', '美國', '中國']);

function isSchoolName(m: string): boolean {
  return !GENERIC_PLACE_PREFIX.has(m.replace(SCHOOL_SUFFIX_RE, ''));
}

// ---------- 班級、學號 ----------

const GRADE = '(?:[一二三四五六七八九]|[1-9])';
const CLASS_NO = '(?:[一二三四五六七八九十]{1,3}|\\d{1,2}|[甲乙丙丁戊己庚辛忠孝仁愛信義和平])';
const CLASS_REGEX =
  `${GRADE}年級?${CLASS_NO}班` +
  `|(?<![\\d])[1-9]\\d{2}班` +
  `|${afterLabel('班級')}[1-9]\\d{2}(?!\\d)`;

const STUDENT_NO_REGEX =
  `${afterLabel('學號|學生編號|個案編號')}[A-Za-z]?\\d{4,10}(?!\\d)` +
  // Folder or file names such as 70123_王小明.
  `|(?<![\\dA-Za-z])\\d{5,6}(?=_[${CJK}]{2,4})`;

// ---------- 醫院、診斷 ----------

const HOSPITAL_SUFFIX =
  '醫學中心|紀念醫院|醫院|分院|診所|早期療育中心|早療中心|兒童發展中心|復健中心|心理治療所|語言治療所|職能治療所|衛生所';
export const HOSPITAL_SUFFIX_RE = new RegExp(`(?:${HOSPITAL_SUFFIX})$`, 'u');
const HOSPITAL_REGEX = `${PLACE_PREFIX}(?:${HOSPITAL_SUFFIX})`;

/** 特教障礙類別（含簡稱）、常見診斷與 ADHD 用藥。Longer terms first so 自閉症類群障礙 wins over 自閉症. */
const DIAGNOSES = [
  '情緒行為障礙', '自閉症類群障礙', '自閉症譜系障礙', '自閉症光譜', '自閉症', '注意力不足過動症', '注意力缺陷過動症',
  '注意力不足', '過動症', '亞斯伯格症', '亞斯伯格', '發展性協調障礙', '發展遲緩', '智能障礙', '視覺障礙', '聽覺障礙',
  '語言障礙', '肢體障礙', '腦性麻痺', '身體病弱', '學習障礙', '多重障礙', '讀寫障礙', '閱讀障礙', '書寫障礙', '數學障礙',
  '妥瑞氏症', '妥瑞症', '唐氏症', '癲癇', '憂鬱症', '焦慮症', '躁鬱症', '雙極性疾患', '思覺失調症', '強迫症', '對立反抗症',
  '選擇性緘默症', '罕見疾病', '學障', '情障', '智障', '聽障', '視障', '肢障', '語障', '多障', '腦麻',
  'ADHD', 'ASD', '利他能', '專思達', '思銳', 'Ritalin', 'Concerta', 'Strattera',
];
const DIAGNOSIS_REGEX = `(?<![A-Za-z])(?:${DIAGNOSES.join('|')})(?![A-Za-z])`;

export const SPED_PATTERNS: Pattern[] = [
  {
    id: 'sped-label-name',
    name: '欄位後的姓名',
    group: 'sped',
    note: '「學生：」「家長：」「導師：」「出席人員：」等欄位後的 2–4 字（表格裡標籤格的下一格也算），不需要是常見姓氏；排除「同上」「家長」等職稱或空白字樣',
    category: '姓名',
    source: 'builtin',
    regex: LABEL_NAME_REGEX,
    example: '學生：鄔小華、出席人員：王大明、林小華',
    enabled: true,
    validate: isLabelledName,
  },
  {
    id: 'sped-name-link',
    name: '名字簡稱連動',
    group: 'sped',
    note: '偵測到「王小明」後，文件中其他地方單寫的「小明」與完整姓名也一起遮蔽（名字須 2 字以上）。這條不用比對規則，停用即關閉連動',
    category: '姓名',
    source: 'builtin',
    regex: '(?!)',
    example: '王小明……小明今天',
    enabled: true,
  },
  {
    id: 'sped-school',
    name: '學校名稱',
    group: 'sped',
    note: '以國中、國小、高中、國民中學、幼兒園、大學等結尾；排除「升上國中」「一般國小」這類泛稱',
    category: '學校',
    source: 'builtin',
    regex: SCHOOL_REGEX,
    example: '凱旋國中、宜蘭縣立凱旋國民中學',
    enabled: true,
    validate: isSchoolName,
  },
  {
    id: 'sped-class',
    name: '班級',
    group: 'sped',
    note: '七年三班、7年3班、八年級忠班、701班；「班級：」欄位後的 3 位數',
    category: '班級',
    source: 'builtin',
    regex: CLASS_REGEX,
    example: '七年三班、701班、班級：802',
    enabled: true,
  },
  {
    id: 'sped-student-no',
    name: '學號',
    group: 'sped',
    note: '「學號：」「個案編號：」欄位後的 4–10 位數；檔名或資料夾名稱「70123_王小明」的編號',
    category: '學號',
    source: 'builtin',
    regex: STUDENT_NO_REGEX,
    example: '學號：70123、70123_王小明',
    enabled: true,
  },
  {
    id: 'sped-hospital',
    name: '醫院／診所／早療機構',
    group: 'sped',
    note: '以醫院、醫學中心、診所、早療中心、復健中心、治療所等結尾',
    category: '醫院',
    source: 'builtin',
    regex: HOSPITAL_REGEX,
    example: '羅東博愛醫院、陽明大學附設醫院',
    enabled: true,
  },
  {
    id: 'sped-diagnosis',
    name: '障礙類別／診斷／用藥',
    group: 'sped',
    note: '特教 13 類障礙類別與簡稱（學障、情障…）、自閉症、ADHD、妥瑞症等常見診斷與 ADHD 用藥。IEP 內容需要保留障礙類別時，停用這條',
    category: '診斷',
    source: 'builtin',
    regex: DIAGNOSIS_REGEX,
    example: '學習障礙、自閉症、ADHD、利他能',
    enabled: true,
  },
];
