import type { Pattern } from './types';
import { isValidTaxId, isValidTwId } from './twid';
import { ibanLength, isBirthDate, isCardNumber, isIpv6, isSsn, phoneLength } from './intl';
import { SPED_PATTERNS } from './patterns-sped';

const CJK = '\\u4e00-\\u9fa5';

export const CITIES =
  '(?:[臺台]北市|新北市|桃園市|[臺台]中市|[臺台]南市|高雄市|基隆市|新竹[市縣]|嘉義[市縣]|苗栗縣|彰化縣|南投縣|雲林縣|屏東縣|宜蘭縣|花蓮縣|[臺台]東縣|澎湖縣|金門縣|連江縣)';
const DISTRICT = `(?:[${CJK}]{1,4}[鄉鎮市區])?`;
const ROAD = `(?:[${CJK}\\d]{1,8}(?:路|街|大道))`;
const ADDRESS_TAIL =
  `(?:[${CJK}]{1,4}[村里])?(?:\\d{1,3}鄰)?` +
  `(?:[一二三四五六七八九十\\d]{1,3}段)?(?:\\d{1,4}巷)?(?:\\d{1,4}弄)?` +
  `\\d{1,5}(?:之\\d{1,3})?號(?:[\\d一二三四五六七八九十]{1,3}樓)?(?:之\\d{1,3})?(?:[${CJK}\\d]{1,3}室)?`;

const ADDRESS_REGEX =
  `(?:${CITIES}${DISTRICT}(?:[${CJK}]{1,4}[村里])?(?:\\d{1,3}鄰)?${ROAD}?` +
  `|(?<![${CJK}])${DISTRICT}${ROAD})` +
  ADDRESS_TAIL;

/** +886 numbers: area code with or without its 0 or brackets (mobiles, +886-9, are 手機). */
const TW_LANDLINE_INTL = '\\+886[-\\x20]?\\(?0?(?:826|836|82|89|37|49|[2-8])\\)?[-\\x20]?\\d{3,4}[-\\x20]?\\d{3,4}';

const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
/**
 * A date of birth only counts right after a label saying so, on the same line (a table's next cell
 * counts, a column header above a list of dates does not); other dates are not personal data.
 */
const BIRTH_LABEL = '(?:DOB|D\\.O\\.B\\.?|[Dd]ate [Oo]f [Bb]irth|[Bb]irth ?[Dd]ate|[Bb]irthday|[Bb]orn(?: [Oo]n)?|出生日期|出生年月日|生日)';
const BIRTH_DATE =
  `(?<=${BIRTH_LABEL}[\\x20\\t]*[:：]?[\\x20\\t]*)(?:` +
  '(?:民國\\s*)?\\d{2,4}\\s*年\\s*\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日?' +
  '|\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}' +
  '|\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{4}' +
  `|${MONTH}\\.?\\x20+\\d{1,2}(?:st|nd|rd|th)?,?\\x20+\\d{4}` +
  `|\\d{1,2}(?:st|nd|rd|th)?\\x20+${MONTH}\\.?,?\\x20+\\d{4})`;

/** Organisation suffixes that reliably end a company name; bare 公司 is too ambiguous (本公司, 公司電話). */
const COMPANY_SUFFIX = '(?:股份有限公司|有限公司|無限公司|兩合公司|企業社|工作室|事務所|商行|診所|基金會|協會|合作社|工程行|企業行|實業社|文化事業)';
/** Characters that never start a company name but often precede one in prose. */
const COMPANY_NOT_FIRST = '的與和及於在由向從為對將把讓依據至到給經受同各該本貴我敝此其係即為者以並或如';
const COMPANY_REGEX = `(?:(?![${COMPANY_NOT_FIRST}])[${CJK}A-Za-z0-9&·]){2,14}?${COMPANY_SUFFIX}`;
/** Prose that ran into the name: 外面參加過協會、報名加入協會. */
const COMPANY_PROSE = /參加|加入|參與|報名|加過|去過|到過|外面/u;
function isCompanyName(m: string): boolean {
  return !COMPANY_PROSE.test(m);
}

const COMPOUND_SURNAMES = '歐陽|司馬|諸葛|上官|張簡|范姜|司徒|東方|令狐|南宮|端木|皇甫|尉遲|夏侯';
export const SINGLE_SURNAMES =
  '陳林黃張李王吳劉蔡楊許鄭謝郭洪邱曾廖賴徐周葉蘇莊呂江何蕭羅高潘簡朱鍾游彭詹胡施沈余盧梁趙顏柯翁魏孫戴范方宋鄧杜傅侯曹薛丁卓阮馬董溫唐藍蔣石古紀姚連馮歐程湯田康姜白汪鄒尤巫鐘黎塗龔嚴韓袁金童陸夏柳邵錢伍倪甘秦官辛戚易祝樊喬向殷凌闕舒包鮑冉牛管毛涂';

/** Contexts that commonly follow a person's name; keeps 2-vs-3 char names from over-capturing. */
const NAME_FOLLOW =
  '(?=$|[\\s\\d\\p{P}A-Za-z]|先生|小姐|女士|同學|醫師|醫生|護理師|老師|律師|經理|主任|董事|總監|組長|課長|科長|處長|局長|部長|教授|博士|君|兄|姐|哥|等|表示|說|指出|認為|於|在|與|和|及|為|所|之|的|已|將|曾|因|向|由|係|即|亦|並|或' +
  '|另|也|則|更|未|不|有|無|是|非|對|從|自|以|被|經|卻|還|又|再|但|而|才|都|皆|均|便|就|會|能|可|應|須|要|想|願|正|到|來|去|至|提|收|付|持|稱|同意|聲明|陳述|申請|提供|前往|出席|簽|辦理|負責|擔任|購買|支付|領取|遞交|回覆|聯絡|通知|告知)';

/** Characters that essentially never appear inside a given name; used by the fallback branch below. */
const NAME_STOP_CHARS =
  '的了是在有和與及於為等所之已將因向由係即亦並或另也則未不無非對從自以被經卻還又再但而才都皆均便就會能可應須要想願到來去至收付持稱接提說表指認出簽辦負擔購支領遞回聯通告這那該此其每各們呢嗎吧啊麼什怎很太最曾先女士請讓使給把被令將於當若如則個';

/**
 * Branch 1: 1–2 name chars followed by a known context word (precise for 2-vs-3 char names).
 * Branch 2: exactly 2 name chars that are not function words (recall when the next word is unknown).
 */
const NAME_REGEX =
  `(?:${COMPOUND_SURNAMES}|[${SINGLE_SURNAMES}])` +
  `(?:[${CJK}]{1,2}${NAME_FOLLOW}|(?:(?![${NAME_STOP_CHARS}])[${CJK}]){2})`;

/** Common words that start with a surname character but are not names. */
const NAME_STOPLIST = new Set([
  '王國', '王子', '王牌', '李子', '張開', '張貼', '張力', '陳述', '陳列', '陳舊', '林口', '林業', '林地',
  '高雄', '高速', '高中', '高級', '高度', '高溫', '高血', '黃金', '黃色', '黃昏', '吳郭', '何時', '何況',
  '何人', '何處', '何等', '何種', '何者', '何以', '何不', '何在', '何其', '何去',
  '何謂', '馬上', '馬路', '周年', '周末', '周邊', '周圍', '方法', '方面', '方向', '方式', '方案', '許多',
  '許可', '江山', '江湖', '白色', '白天', '白血', '黑色', '金門', '金額', '金融', '金屬', '金錢', '長期',
  '文件', '文化', '石頭', '程式', '程度', '康復', '常見', '章節', '施工', '施行', '萬一', '羅列', '夏天',
  '夏季', '史上', '田地', '余額', '毛病', '任何', '任務', '古代', '古蹟', '紀錄', '紀念', '連結', '連續',
  '連接', '連線', '溫度', '溫暖', '唐朝', '藍色', '石油', '康健', '姜母', '白天', '汪洋', '童年', '陸地',
  '柳樹', '錢包', '甘心', '秦朝', '官方', '官員', '易於', '祝福', '喬木', '向來', '凌晨', '舒服', '包含',
  '包括', '包裝', '鮑魚', '牛肉', '牛奶', '管理', '毛巾', '柯南', '翁婿', '魏晉', '孫子', '戴上', '范圍',
  '宋朝', '杜絕', '侯爵', '曹操', '丁點', '卓越', '馬克', '董事', '藍圖', '蔣公', '石膏', '鄧小', '傅立',
  '梁柱', '趙錢', '顏色', '簡單', '簡介', '簡稱', '朱紅', '鍾情', '游泳', '游戲', '詹姆', '胡說', '胡椒',
  '沈默', '盧比', '呂宋', '江西', '何必', '蕭條', '羅馬', '羅列', '高雄', '潘朵', '莊園', '蘇打', '葉子',
  '徐徐', '廖化', '賴床', '曾經', '洪水', '郭台', '謝謝', '鄭重', '許願', '蔡英', '劉海', '吳哥', '楊桃',
  '張三', '李四', '王五', '謝絕', '謝意', '許久', '賴以', '曾任', '洪流', '邱比', '徐步', '廖若', '莊嚴',
  '管轄', '管制', '管線', '管道', '管控', '溫濕', '溫馨', '溫室', '何疑', '易雙', '謝您', '謝函', '謝禮', '高層', '高額',
  '方為', '牛市', '包商', '向下', '向上', '任一', '安全', '安裝', '安排',
  '程師', // 工程師
  '簡訊', '向本', // 手機簡訊、向本會／本公司申請
  // IEP、輔導與會議紀錄常用詞
  '施測', '施以', '施打', '施予', '魏氏', '管教', '溫和', '溫柔', '溫習', '溫順', '易怒', '易分', '易受', '易被', '易有',
  '易哭', '易生', '易因', '易與', '易出', '簡化', '簡易', '簡短', '嚴重', '嚴格', '嚴厲', '嚴肅', '嚴謹', '陸續', '尤其',
  '尤為', '塗鴉', '塗改', '塗抹', '紀律', '童話', '童心', '童軍', '童謠', '童書', '童趣', '安靜', '安心', '安撫', '安置',
  '安親', '安定', '方便', '方能', '方可', '方才', '包容', '向學', '向心', '向前', '連絡', '連帶', '連貫', '高興', '高年',
  '高低', '高分', '高頻', '高風', '周遭', '周全', '周到', '曾有', '曾於', '曾在', '曾被', '曾接', '曾因', '曾經', '戴眼',
  '戴口', '馬虎', '毛筆', '田徑', '舒適', '舒緩', '舒壓', '凌亂', '洪亮', '莊重', '甘願', '游移', '古怪', '殷切', '鍾愛',
  '湯匙', '石頭', '康樂', '程度', '黎明', '蘇醒', '江湖', '包班', '冉冉', '金庸', '金剛', '白板', '戴牙', '戴帽', '戴手', '戴耳', '戴安',
]);

/**
 * Characters before a surname that make it the end of an everyday word, not a name:
 * 過程、課程、一張、緊張、提高、感謝、容易、方向、分鐘、明白、兒童、健康…
 */
const WORD_BEFORE_SURNAME: Record<string, string> = {
  程: '過課工流行進療全規章日議單專啟起航路射里前', 張: '一兩幾每整緊主擴誇開伸囂慌聲', 高: '身提最較偏過太很升崇增拔清',
  謝: '感多道代凋答致銘', 金: '現黃資基獎租押定合學罰稅形', 賴: '信依仰無耍抵', 王: '國帝霸親大', 李: '行', 林: '森樹叢竹園山雨', 黃: '金蛋枯焦',
  許: '也或允些期默讚稱特准少多', 周: '一每上下本四圓', 葉: '樹茶落綠枝中末', 莊: '村農山錢', 江: '長', 羅: '張網包',
  簡: '精書竹', 游: '上下中', 施: '實措設布', 沈: '深消低下', 梁: '橋棟脊', 顏: '容笑紅', 翁: '漁老富', 孫: '子兒曾外王長',
  戴: '擁愛穿配佩', 傅: '師', 丁: '園人', 馬: '人兵斑木騎賽河', 董: '古', 溫: '體氣水常低保升高', 唐: '荒', 藍: '蔚天深淺湛',
  石: '岩化寶鑽礦隕磁基碎', 古: '復懷千考自上遠', 紀: '世年風違綱軍', 連: '相串牽關接', 湯: '喝熱雞煲菜清米', 田: '稻農油梯心種耕',
  康: '健小安', 白: '明空坦蛋黑雪灰表告獨對旁潔小', 鐘: '時鬧分', 塗: '糊', 嚴: '莊威尊戒森', 童: '兒學孩幼孤神頑', 陸: '大登著內',
  夏: '盛初華立消', 錢: '金價零有賺花存本付給賠省用車工掙', 伍: '隊入落退行', 倪: '端', 甘: '不', 秦: '先',
  官: '器法警軍長五考外教做當', 辛: '艱酸', 戚: '親休哀', 易: '容簡交貿輕平不難變', 祝: '慶預恭',
  向: '方傾意志走導動轉面偏趨內外性取指朝去一雙反正', 凌: '欺霸', 包: '書錢麵背紅打承皮荷外草菜', 牛: '吹蝸黃水犀鬥',
  管: '控主保監列儘看水血吸接托不', 毛: '羽眉皮睫一汗體', 安: '平不公晚治',
};

/** Characters that essentially never stand in a given name: 過程有反應、課程需要、感謝的. */
const NOT_IN_GIVEN_NAME = /[的了是在與及於所已將因由係即並或也則不無非對被卻還又但而都就須要到來去這那該此每們呢嗎吧啊麼什怎很最個需讓使給把當有]/u;

/** "X方" in contracts/legal text (甲方、乙方、雙方、他方…) is a party, not a person surnamed 方. */
const PARTY_PREFIX = /[甲乙丙丁雙各買賣我他貴對本該多官軍校院廠資勞前後男女一二三四五六七八九十任另每]$/u;

function isPlausibleName(m: string, before = ''): boolean {
  if (NAME_STOPLIST.has(m.slice(0, 2))) return false;
  if (/(.)\1/.test(m) && m.length === 2) return false;
  if (m.startsWith('方') && PARTY_PREFIX.test(before)) return false;
  if (m.startsWith('何') && /[任如為幾若奈無]$/u.test(before)) return false; // 任何、如何、幾何…
  const prev = before.slice(-1);
  if (prev && WORD_BEFORE_SURNAME[m[0]]?.includes(prev)) return false;
  const surnameLen = COMPOUND_SURNAMES.split('|').some((c) => m.startsWith(c)) ? 2 : 1;
  if (NOT_IN_GIVEN_NAME.test(m.slice(surnameLen))) return false;
  return true;
}

export const BUILTIN_PATTERNS: Pattern[] = [
  ...SPED_PATTERNS,
  {
    id: 'zh-name',
    name: '中文姓名',
    group: 'tw',
    note: '常見姓氏（含複姓）加 1–2 字名，以前後文判斷名字長度；排除常見詞（高雄、方法…）與「甲方／雙方」',
    category: '姓名',
    source: 'builtin',
    regex: NAME_REGEX,
    example: '王小明、歐陽志遠',
    enabled: true,
    validate: isPlausibleName,
  },
  {
    id: 'tw-id',
    name: '台灣身分證字號',
    group: 'tw',
    note: '身分證檢核碼驗證，錯誤的號碼不命中',
    category: '身分證',
    source: 'builtin',
    regex: '(?<![A-Za-z0-9])[A-Z][12]\\d{8}(?!\\d)',
    example: 'A123456789',
    enabled: true,
    validate: isValidTwId,
  },
  // Before 市話: a labelled SSN of 9 bare digits starting with 0 also reads as a Kaohsiung number.
  // Unlabelled it needs 3-2-4 separators, which no Taiwanese format uses.
  {
    id: 'us-ssn',
    name: '美國社會安全碼（SSN）',
    group: 'intl',
    note: '排除 000、666、9xx 區碼與 00 組碼、0000 序號；「SSN:」標籤後的 9 位數也算',
    category: 'SSN',
    source: 'builtin',
    regex:
      '(?<![\\d-])(?:\\d{3}-\\d{2}-\\d{4}|\\d{3}\\x20\\d{2}\\x20\\d{4})(?![\\d-])' +
      '|(?<=(?:SSN|Social Security (?:Number|No\\.?))\\s*[:#：]?\\s*)\\d{9}(?!\\d)',
    example: '123-45-6789、SSN: 123456789',
    enabled: true,
    validate: isSsn,
  },
  {
    id: 'tw-mobile',
    name: '手機號碼',
    group: 'tw',
    note: '09 開頭或 +886 9 開頭，前後不得緊鄰數字',
    category: '手機',
    source: 'builtin',
    regex: '(?<![\\d+])(?:\\+886[-\\x20]?9|09)\\d{2}[-\\x20]?\\d{3}[-\\x20]?\\d{3}(?!\\d)',
    example: '0912-345-678、0912345678、+886-912-345-678',
    enabled: true,
  },
  {
    id: 'tw-landline',
    name: '市話號碼',
    group: 'tw',
    note: '依區碼要求位數，8 位數統編不會被當成市話；含 +886 寫法',
    category: '市話',
    source: 'builtin',
    // Separated/parenthesised forms, or unseparated forms with the exact digit count per area
    // code (02/04: 10 digits, 03–08: 9, 082/089: 9, 0826/0836: 9) so an 8-digit 統編 is never a 市話.
    regex:
      '(?<![\\d(])(?:\\(0(?:826|836|82|89|37|49|[2-8])\\)[-\\x20]?\\d{3,4}[-\\x20]?\\d{3,4}' +
      '|0(?:826|836|82|89|37|49|[2-8])[-\\x20]\\d{3,4}[-\\x20]?\\d{3,4}' +
      '|0[24]\\d{8}|0[3-8]\\d{7}|08[29]\\d{6}|08[23]6\\d{5}|' + TW_LANDLINE_INTL + ')(?!\\d)',
    example: '(02)2712-3456、02-27123456、0227123456、037-123456、+886-2-2712-3456',
    enabled: true,
  },
  {
    id: 'tw-address',
    name: '台灣地址',
    group: 'tw',
    note: '以縣市名為錨點，含鄉鎮市區、路街段巷弄號樓',
    category: '地址',
    source: 'builtin',
    regex: ADDRESS_REGEX,
    example: '台北市信義區市府路45號8樓',
    enabled: true,
  },
  {
    id: 'tw-company',
    name: '公司／組織名稱',
    group: 'tw',
    note: '以股份有限公司、有限公司、事務所、診所、基金會等結尾；排除「本／該／貴公司」',
    category: '公司',
    source: 'builtin',
    regex: COMPANY_REGEX,
    example: '築夢實業股份有限公司、大安聯合診所',
    enabled: true,
    validate: isCompanyName,
  },
  {
    id: 'tw-tax-id',
    name: '統一編號',
    group: 'tw',
    note: '統一編號檢核碼驗證（含 2023 年新制）',
    category: '統編',
    source: 'builtin',
    regex: '(?<![\\d-])\\d{8}(?![\\d-])',
    example: '統一編號 04595257',
    enabled: true,
    validate: isValidTaxId,
  },
  {
    id: 'email',
    name: '電子郵件',
    group: 'intl',
    category: '電子郵件',
    source: 'builtin',
    regex: '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}',
    example: 'someone@example.com',
    enabled: true,
  },
  // International formats (specs/007-intl-pii-patterns). After the Taiwanese rules, so a +886 number
  // they both match stays 手機 or 市話.
  {
    id: 'intl-phone',
    name: '國際電話',
    group: 'intl',
    note: '含國碼的各國號碼或北美格式，以 libphonenumber 驗證號碼有效性；+886 號碼歸手機／市話',
    category: '國際電話',
    source: 'builtin',
    regex:
      '(?<![\\w+])(?:\\+[1-9]\\d{0,2}(?:[\\x20.-]?(?:\\(\\d{1,4}\\)|\\d{1,5})){1,6}' +
      '|(?:\\(\\d{3}\\)\\x20?|\\d{3}[-.\\x20])\\d{3}[-.\\x20]\\d{4})(?!\\w)',
    example: '+1 (415) 867-5309、+44 20 7946 0958、(416) 967-1111',
    enabled: true,
    validate: phoneLength,
  },
  {
    id: 'credit-card',
    name: '信用卡號',
    group: 'intl',
    note: 'Luhn 檢核＋發卡機構號段（Visa、Mastercard、AmEx、Discover、JCB、UnionPay、Diners）＋常見分組格式',
    category: '信用卡',
    source: 'builtin',
    regex: '(?<![\\d-])\\d(?:[\\x20-]?\\d){12,18}(?![\\d-])',
    example: '4242 4242 4242 4242、3782 822463 10005',
    enabled: true,
    validate: isCardNumber,
  },
  {
    id: 'iban',
    name: 'IBAN 國際銀行帳號',
    group: 'intl',
    note: 'mod-97 檢核碼＋各國固定長度',
    category: 'IBAN',
    source: 'builtin',
    regex: '(?<![A-Za-z0-9])[A-Z]{2}\\d{2}(?:\\x20?[A-Z0-9]{4}){2,7}(?:\\x20?[A-Z0-9]{1,3})?(?![A-Za-z0-9])',
    example: 'GB82 WEST 1234 5698 7654 32、DE89370400440532013000',
    enabled: true,
    validate: ibanLength,
  },
  {
    id: 'ipv4',
    name: 'IPv4 位址',
    group: 'intl',
    note: '各段 0–255，排除版本號',
    category: 'IP',
    source: 'builtin',
    regex: '(?<![\\d.])(?:(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)(?!\\.?\\d)',
    example: '192.168.1.10',
    enabled: true,
  },
  {
    id: 'ipv6',
    name: 'IPv6 位址',
    group: 'intl',
    note: '以瀏覽器內建的網址解析驗證，排除時間與 MAC 位址',
    category: 'IP',
    source: 'builtin',
    regex: '(?<![\\w:.])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{1,4}(?![\\w:])',
    example: '2001:db8::1',
    enabled: true,
    validate: isIpv6,
  },
  {
    id: 'dob',
    name: '出生日期',
    group: 'intl',
    note: '只偵測「DOB／Date of Birth／Birthday／Born／出生日期／生日」等標籤後、同一行的日期；驗證月日',
    category: '生日',
    source: 'builtin',
    regex: BIRTH_DATE,
    example: 'DOB: 1985-03-14、Date of Birth: March 14, 1985、出生日期：民國 80 年 5 月 1 日',
    enabled: true,
    validate: isBirthDate,
  },
];
