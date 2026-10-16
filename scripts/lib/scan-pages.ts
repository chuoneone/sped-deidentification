// The 5-page scanned sample (all data fictional): HTML layouts that render-scan.ts turns into page
// images. Covers Chinese, English, tables, numbers, handwriting and text-free pictures: a Chinese
// letter with a pen note and a photo, a hand-filled form, a landscape roster table, an English
// invoice with a product photo and a sheet of bilingual business cards.
import { readFileSync } from 'node:fs';
import { Fake } from './fake.ts';
import type { Category } from '../../src/core/types.ts';

export interface ScanPage {
  title: string;
  /** Body markup; laid out on a 794×1123 (portrait) or 1123×794 (landscape) CSS px sheet. */
  html: string;
  landscape?: boolean;
  /** Colour scan; otherwise greyscale. */
  color?: boolean;
  /** Sheet rotation in degrees, as a scanner feeds paper slightly askew. */
  tilt: number;
  /** The whole scan turned by a quarter turn or more (paper fed sideways or upside down). */
  rotate?: 0 | 90 | 180 | 270;
  /** Printed values on the page that the built-in rules should detect. */
  planted: [Category, string][];
  /** Handwritten values: recognition is best effort, so they are counted apart from `planted`. */
  handwritten: [Category, string][];
  /** Text-free pictures on the page (photos, emblems) that the output should keep. */
  images: number;
  /** Sensitive values outside the built-in rules (e.g. romanised names), left for manual adding. */
  manual: string[];
}

interface Person {
  name: string;
  id: string;
  birthday: string;
  mobile: string;
  email: string;
  address: string;
}

// Single quotes inside: these go into style="…" attributes.
const SONG = "'Songti TC', 'Noto Serif TC', serif";
const SANS = "'PingFang TC', 'Noto Sans TC', sans-serif";
const HAND = "'LXGW WenKai TC', 'Kaiti TC', 'Songti TC', serif";
const SERIF_EN = "'Times New Roman', Times, serif";
const SANS_EN = "Helvetica, Arial, sans-serif";
const SCRIPT = "Caveat, 'Snell Roundhand', cursive";

/**
 * Pictures generated with Codex for the sample (no text, no people); the originals live in
 * scripts/assets/scan/ so the sample can be rebuilt.
 */
const picture = (file: string, style: string) => {
  const data = readFileSync(new URL(`../assets/scan/${file}`, import.meta.url)).toString('base64');
  return `<img src="data:image/${file.endsWith('.png') ? 'png' : 'jpeg'};base64,${data}" alt="" style="display:block;object-fit:cover;${style}">`;
};

/** Keeps a value on one printed line so recognition sees it whole. */
const nw = (s: string) => `<span style="white-space:nowrap">${s}</span>`;

/** 2026-03-05 → 民國 115 年 3 月 5 日 */
const roc = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `民國 ${y - 1911} 年 ${m} 月 ${d} 日`;
};

function person(f: Fake): Person {
  const name = f.name();
  return { name, id: f.twId(), birthday: f.birthday(), mobile: f.mobile().replace(/ /g, '-'), email: f.email(name), address: f.address() };
}

/** Romanised name in Taiwanese passport style, e.g. 林美玲 → Lin Mei-Ling. */
function romanName(email: string): string {
  const parts = email.split('@')[0].replace(/\d+$/, '').split('.');
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return `${cap(parts[0])} ${parts.slice(1).map(cap).join('-')}`;
}

// ---------------------------------------------------------------------------------------
// 1. 中文信函
// ---------------------------------------------------------------------------------------
function letter(f: Fake): ScanPage {
  const company = f.company();
  const taxId = f.taxId();
  const address = f.address();
  const phone = f.landline();
  const rep = f.name();
  const r = person(f);
  const s = person(f);
  const bank = f.bankAccount();
  const aide = person(f);
  const p = (t: string) => `<p style="margin:0 0 9px;text-indent:-2em;padding-left:2em">${t}</p>`;
  return {
    title: '服務費用調整通知函',
    tilt: 0.35,
    handwritten: [['姓名', aide.name], ['手機', aide.mobile]],
    images: 2,
    planted: [
      ['公司', company], ['統編', taxId], ['地址', address], ['市話', phone], ['姓名', rep],
      ['姓名', r.name], ['身分證', r.id], ['地址', r.address], ['手機', r.mobile],
      ['姓名', s.name], ['手機', s.mobile], ['電子郵件', s.email],
    ],
    manual: [],
    html: `
<div style="padding:62px 70px 50px;font-family:${SONG};color:#1b1b1b;font-size:15px;line-height:1.75">
  <div style="display:flex;align-items:center;gap:14px;border-bottom:2.5px double #333;padding-bottom:10px">
    ${picture('logo-mark.png', 'width:58px;height:58px;object-fit:contain;mix-blend-mode:multiply')}
    <div>
      <div style="font-size:24px;font-weight:700;letter-spacing:.12em">${company}</div>
      <div style="font-size:12.5px;color:#444">${nw(address)}　電話 ${nw(phone)}　統一編號 ${taxId}</div>
    </div>
  </div>
  <div style="display:flex;justify-content:space-between;margin:14px 0 4px;font-size:14px">
    <div>受文者：${r.name} 君</div>
    <div style="text-align:right">發文日期：中華民國 115 年 10 月 6 日<br>發文字號：資服字第 1151006021 號</div>
  </div>
  <h1 style="font-size:23px;text-align:center;letter-spacing:.3em;margin:18px 0 16px">通　知　函</h1>
  ${p(`主旨：有關貴我雙方「資訊系統維運服務契約」（契約編號 SC-2026-0917）服務費用調整及匯款帳戶變更事宜，詳如說明，請　查照。`)}
  <p style="margin:0 0 6px">說明：</p>
  ${p(`一、依據雙方於 2025 年 10 月 1 日簽訂之服務契約第三條約定，本公司得於每年度屆滿前 30 日通知調整服務費用。`)}
  ${p(`二、自 2026 年 11 月 1 日起，每月服務費用由新臺幣 85,000 元調整為新臺幣 92,500 元（含稅），調幅 8.8%；年度總額為新臺幣 1,110,000 元。`)}
  ${p(`三、契約當事人資料：${r.name}，身分證字號 ${r.id}，通訊地址 ${nw(r.address)}，聯絡手機 ${nw(r.mobile)}。如有異動，請於 2026 年 10 月 31 日前以書面通知本公司。`)}
  ${p(`四、自即日起本公司收款帳戶變更為：臺灣銀行大安分行，帳號 ${nw(bank)}，戶名 ${company}；原帳戶將於 2026 年 12 月 31 日停止使用。`)}
  ${p(`五、本案承辦人：業務部 ${s.name} 經理，電話 ${nw(phone)} 分機 215，手機 ${nw(s.mobile)}，電子郵件 ${s.email}。`)}
  ${p(`六、附件：機房現場照片乙張（2026 年 10 月 3 日拍攝）。`)}
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-top:14px">
    <div style="font-size:14px">正本：${r.name} 君<br>副本：本公司財務部、法務室</div>
    <div style="margin-right:20px;transform:rotate(-3deg);font:21px/1.4 ${HAND};color:#1d3f9a">10/8 已致電，改寄助理 ${aide.name}<br>手機 ${aide.mobile}</div>
  </div>
  <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:26px;margin-top:18px">
    ${picture('server-room.jpg', 'width:270px;height:190px;border:1px solid #777')}
    <div style="font-size:19px;letter-spacing:.2em;margin-left:auto;align-self:center">董事長　${rep}</div>
    <div style="width:84px;height:84px;border:4px solid #555;display:grid;grid-template-columns:1fr 1fr;align-items:center;justify-items:center;font:700 20px ${SONG};color:#555;transform:rotate(-4deg)">
      ${[2, 0, 3, 1].map((k) => `<span>${company[k]}</span>`).join('')}
    </div>
  </div>
  <div style="position:absolute;bottom:40px;left:0;right:0;text-align:center;font-size:11px;color:#666">第 1 頁，共 1 頁</div>
</div>`,
  };
}

// ---------------------------------------------------------------------------------------
// 2. 手寫申請表單
// ---------------------------------------------------------------------------------------
function form(f: Fake): ScanPage {
  const a = person(f);
  const phone = f.landline();
  const ec = person(f);
  const employer = f.company();
  const employerTax = f.taxId();
  const jitter = [-1.2, 0.8, -0.5, 1.1, -0.9, 0.6, -1.4, 0.4, 1.3, -0.7, 0.9, -1.1];
  let j = 0;
  /** A hand-filled value in blue ballpoint, each slightly askew. */
  const hand = (v: string, size = 22) =>
    `<span style="font-family:${HAND};font-size:${size}px;color:#1d3f9a;display:inline-block;transform:rotate(${jitter[j++ % jitter.length]}deg) translateY(1px)">${v}</span>`;
  const box = (checked: boolean, label: string) =>
    `<span style="white-space:nowrap;margin-right:14px"><span data-checkbox="${checked ? 1 : 0}" style="display:inline-block;width:13px;height:13px;border:1.4px solid #222;vertical-align:-1px;position:relative">${
      checked ? `<span style="position:absolute;left:-1px;top:-9px;font:700 19px ${HAND};color:#1d3f9a">✓</span>` : ''
    }</span> ${label}</span>`;
  const th = 'style="background:#ececec;border:1.3px solid #222;padding:7px 8px;font-weight:600;white-space:nowrap;width:94px"';
  const td = 'style="border:1.3px solid #222;padding:5px 16px;height:34px"';
  return {
    title: '會員入會申請書',
    color: true,
    tilt: -0.3,
    planted: [],
    handwritten: [
      ['姓名', a.name], ['身分證', a.id], ['市話', phone], ['手機', a.mobile], ['電子郵件', a.email], ['地址', a.address],
      ['姓名', ec.name], ['手機', ec.mobile], ['公司', employer], ['統編', employerTax], ['生日', roc(a.birthday)],
    ],
    images: 0,
    manual: [],
    html: `
<div style="padding:54px 58px;font-family:${SANS};color:#111;font-size:14px">
  <div style="display:flex;justify-content:space-between;align-items:flex-end">
    <div style="font-size:12px;color:#333">表單編號：MBR-F01（2026.07 版）</div>
    <div style="font-size:12px;color:#333">受理編號：${hand('M115-00872', 16)}</div>
  </div>
  <h1 style="text-align:center;font-size:26px;letter-spacing:.25em;margin:10px 0 4px">會員入會申請書</h1>
  <div style="text-align:center;font-size:12.5px;color:#333;margin-bottom:12px">（請以正楷填寫，並於 □ 內打勾）</div>
  <div style="margin-bottom:8px">申請項目：${box(true, '新申辦')}${box(false, '資料變更')}${box(false, '終止會籍')}</div>
  <table style="border-collapse:collapse;width:100%">
    <tr><th ${th}>姓　　名</th><td ${td}>${hand(a.name, 21)}</td><th ${th}>性　　別</th><td ${td}>${box(true, '男')}${box(false, '女')}</td></tr>
    <tr><th ${th}>身分證字號</th><td ${td}>${hand(a.id)}</td><th ${th}>出生日期</th><td ${td}>${hand(roc(a.birthday), 17)}</td></tr>
    <tr><th ${th}>電話（日）</th><td ${td}>${hand(phone)}</td><th ${th}>行動電話</th><td ${td}>${hand(a.mobile)}</td></tr>
    <tr><th ${th}>電子郵件</th><td ${td} colspan="3">${hand(a.email)}</td></tr>
    <tr><th ${th}>戶籍地址</th><td ${td} colspan="3">${hand(a.address)}</td></tr>
    <tr><th ${th}>通訊地址</th><td ${td} colspan="3">${box(true, '同戶籍地址')}${box(false, '其他：')}</td></tr>
    <tr><th ${th}>服務單位</th><td ${td}>${hand(employer, 17)}</td><th ${th}>統一編號</th><td ${td}>${hand(employerTax)}</td></tr>
    <tr><th ${th}>緊急聯絡人</th><td ${td}>${hand(ec.name)}　關係：${hand('配偶', 17)}</td><th ${th}>聯絡電話</th><td ${td}>${hand(ec.mobile)}</td></tr>
  </table>
  <div style="margin:12px 0 6px">通知方式：${box(true, '電子郵件')}${box(false, '手機簡訊')}${box(false, '郵寄')}</div>
  <div style="font-size:12px;line-height:1.7;color:#222;border:1px dashed #555;padding:8px 10px;margin-top:8px">
    個人資料蒐集告知：本會依個人資料保護法第 8 條規定，於會員服務、活動通知及統計分析之目的範圍內，蒐集、處理及利用您所提供之個人資料，
    保存期間至會籍終止後 5 年止。您得隨時向本會請求查詢、閱覽、補充、更正或刪除。
  </div>
  <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:26px">
    <div>申請人簽章：${hand(a.name, 30)}</div>
    <div>填表日期：${hand('115 / 10 / 06')}</div>
  </div>
  <div style="margin-top:28px;border-top:1.5px dashed #444;padding-top:8px;font-size:12px;color:#333">以下由本會填寫</div>
  <table style="border-collapse:collapse;width:100%;font-size:13px;margin-top:6px">
    <tr><th ${th}>受理日期</th><td ${td}>${hand('2026-10-07', 16)}</td><th ${th}>會員編號</th><td ${td}>${hand('A-115-0457', 16)}</td><th ${th}>審核</th><td ${td}></td></tr>
  </table>
</div>`,
  };
}

// ---------------------------------------------------------------------------------------
// 3. 名冊表格（橫式）
// ---------------------------------------------------------------------------------------
function roster(f: Fake): ScanPage {
  const org = f.company();
  const owner = f.name();
  const phone = f.landline();
  const rows = Array.from({ length: 16 }, () => person(f));
  // Horizontal rules only, like most printed lists; vertical cell borders get read as「|」.
  const cell = 'border-bottom:1px solid #9a9a9a;padding:5px 10px;white-space:nowrap';
  return {
    title: '志工服務名冊',
    landscape: true,
    tilt: 0.25,
    handwritten: [],
    images: 0,
    planted: [
      ['公司', org], ['姓名', owner], ['市話', phone],
      ...rows.flatMap((r): [Category, string][] => [['姓名', r.name], ['身分證', r.id], ['手機', r.mobile], ['電子郵件', r.email], ['地址', r.address]]),
    ],
    manual: [],
    html: `
<div style="padding:36px 44px;font-family:${SANS};color:#111;font-size:13px">
  <h1 style="text-align:center;font-size:21px;margin:0 0 6px;letter-spacing:.08em">115 年度第二季 志工服務名冊</h1>
  <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:8px">
    <span>填表單位：${org}</span><span>承辦人：${owner}　聯絡電話：${phone}</span><span>製表日期：2026-10-06</span>
  </div>
  <table style="border-collapse:collapse;width:100%">
    <tr style="background:#e4e4e4;border-top:2px solid #444">${['編號', '姓名', '身分證字號', '出生日期', '手機', '電子郵件', '通訊地址', '時數'].map((h) => `<th style="${cell};font-weight:700">${h}</th>`).join('')}</tr>
    ${rows
      .map(
        (r, i) =>
          `<tr><td style="${cell};text-align:center">${String(i + 1).padStart(3, '0')}</td><td style="${cell}">${r.name}</td><td style="${cell}">${r.id}</td><td style="${cell}">${r.birthday}</td><td style="${cell}">${r.mobile}</td><td style="${cell}">${r.email}</td><td style="${cell}">${r.address}</td><td style="${cell};text-align:right">${(f.int(8, 96) / 2).toFixed(1)}</td></tr>`,
      )
      .join('')}
  </table>
  <div style="display:flex;justify-content:space-between;margin-top:10px;font-size:12px">
    <span>合計 ${rows.length} 人；服務時數以四捨五入計至 0.5 小時。</span><span>第 3 頁</span>
  </div>
</div>`,
  };
}

// ---------------------------------------------------------------------------------------
// 4. 英文商業發票
// ---------------------------------------------------------------------------------------
function invoice(f: Fake): ScanPage {
  const seller = '嘉宏資訊股份有限公司';
  const sellerTax = f.taxId();
  const buyer = f.company();
  const buyerTax = f.taxId();
  const buyerAddress = f.address();
  const b = person(f);
  const s = person(f);
  const phone = f.landline();
  const items: [string, number, number][] = [
    ['Cloud server maintenance (Oct. 2026)', 1, 2850],
    ['Security audit & penetration test', 1, 4200],
    ['SSD storage expansion, 2 TB', 4, 186.5],
    ['On-site support (hours)', 12, 85],
    ['SSL certificate, wildcard, 1 year', 1, 129.99],
  ];
  const usd = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const subtotal = items.reduce((t, [, q, p]) => t + q * p, 0);
  const tax = Math.round(subtotal * 5) / 100;
  const cell = 'border-bottom:1px solid #999;padding:7px 8px';
  return {
    title: 'Commercial Invoice',
    color: true,
    tilt: -0.2,
    handwritten: [],
    images: 2,
    planted: [
      ['公司', seller], ['統編', sellerTax], ['市話', phone], ['電子郵件', s.email],
      ['公司', buyer], ['統編', buyerTax], ['姓名', b.name], ['地址', buyerAddress], ['手機', `+886-${b.mobile.slice(1)}`], ['電子郵件', b.email],
    ],
    manual: [romanName(b.email), romanName(s.email)],
    html: `
<div style="padding:56px 60px;font-family:${SANS_EN};color:#111;font-size:13.5px;line-height:1.5">
  <div style="display:flex;justify-content:space-between;align-items:flex-start">
    <div style="display:flex;gap:14px;align-items:flex-start">
    ${picture('logo-mark.png', 'width:62px;height:62px;object-fit:contain;mix-blend-mode:multiply')}
    <div>
      <div style="font:700 21px ${SERIF_EN}">JIAHONG INFORMATION CO., LTD.</div>
      <div style="font-family:${SANS};font-size:14px">${seller}</div>
      <div>5F., No. 390, Sec. 1, Fuxing S. Rd., Taipei City 106, Taiwan</div>
      <div>Tel: ${phone}　VAT No.: ${sellerTax}</div>
    </div>
    </div>
    <div style="text-align:right;white-space:nowrap">
      <div style="font:700 28px ${SERIF_EN};letter-spacing:.06em">INVOICE</div>
      <div>Invoice No.: INV-2026-10-0457</div>
      <div>Date: Oct. 6, 2026</div>
      <div>Due Date: Nov. 5, 2026</div>
    </div>
  </div>
  <div style="display:flex;gap:28px;margin:22px 0 16px">
    <div style="flex:1;border:1px solid #777;padding:8px 12px">
      <div style="font-weight:700;margin-bottom:2px">BILL TO</div>
      <div>Attn: Ms. ${romanName(b.email)} (<span style="font-family:${SANS}">${b.name}</span>), Purchasing Manager</div>
      <div style="font-family:${SANS}">${buyer}（統一編號 ${buyerTax}）</div>
      <div style="font-family:${SANS}">${buyerAddress}</div>
      <div>Mobile: +886-${b.mobile.slice(1)}</div>
      <div>Email: ${b.email}</div>
    </div>
    <div style="width:210px;border:1px solid #777;padding:8px 12px">
      <div style="font-weight:700;margin-bottom:2px">PAYMENT TERMS</div>
      <div>Net 30 days</div>
      <div>Currency: USD</div>
      <div>PO No.: PO-115-0398</div>
    </div>
  </div>
  <table style="border-collapse:collapse;width:100%">
    <tr style="background:#e6e6e6">${['No.', 'Description', 'Qty', 'Unit Price', 'Amount'].map((h, i) => `<th style="${cell};text-align:${i > 1 ? 'right' : 'left'}">${h}</th>`).join('')}</tr>
    ${items
      .map(([d, q, p], i) => `<tr><td style="${cell}">${i + 1}</td><td style="${cell}">${d}</td><td style="${cell};text-align:right">${q}</td><td style="${cell};text-align:right">${usd(p)}</td><td style="${cell};text-align:right">${usd(q * p)}</td></tr>`)
      .join('')}
  </table>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-top:12px">
  <div style="width:230px">
    ${picture('ssd-product.jpg', 'width:230px;height:160px;border:1px solid #bbb')}
    <div style="font-size:11.5px;color:#444;margin-top:4px">Item 3 — reference photo</div>
  </div>
  <table style="border-collapse:collapse;min-width:260px">
    <tr><td style="padding:3px 8px">Subtotal</td><td style="padding:3px 8px;text-align:right">${usd(subtotal)}</td></tr>
    <tr><td style="padding:3px 8px">Tax (5%)</td><td style="padding:3px 8px;text-align:right">${usd(tax)}</td></tr>
    <tr><td style="padding:3px 8px">Shipping</td><td style="padding:3px 8px;text-align:right">0.00</td></tr>
    <tr style="font-weight:700;border-top:2px solid #222"><td style="padding:5px 8px">TOTAL (USD)</td><td style="padding:5px 8px;text-align:right">${usd(subtotal + tax)}</td></tr>
  </table>
  </div>
  <div style="margin-top:18px;border-top:1px solid #777;padding-top:8px">
    <div style="font-weight:700">Remittance Information</div>
    <div>Bank: Bank of Taiwan, Da'an Branch　SWIFT: BKTWTWTP　Account No.: 004-1234-567890-12</div>
    <div>Please quote the invoice number with your payment. For billing questions, contact Mr. ${romanName(s.email)} at ${s.email}.</div>
  </div>
  <div style="display:flex;justify-content:flex-end;margin-top:24px">
    <div style="text-align:center;width:230px">
      <div style="font:500 30px ${SCRIPT};color:#20306f;transform:rotate(-3deg)">${romanName(s.email)}</div>
      <div style="border-top:1px solid #222;padding-top:3px">Authorized Signature</div>
    </div>
  </div>
  <div style="position:absolute;bottom:40px;left:0;right:0;text-align:center;font-size:11px;color:#555">Page 4 of 5 — Thank you for your business.</div>
</div>`,
  };
}

// ---------------------------------------------------------------------------------------
// 5. 中英雙語名片（彩色）
// ---------------------------------------------------------------------------------------
function cards(f: Fake): ScanPage {
  const titles: [string, string][] = [
    ['業務經理', 'Sales Manager'], ['專案經理', 'Project Manager'], ['財務長', 'Chief Financial Officer'],
    ['資深工程師', 'Senior Engineer'], ['行銷總監', 'Marketing Director'], ['客戶服務專員', 'Customer Service Specialist'],
  ];
  const accents = ['#1e5aa8', '#b3261e', '#2e7d32', '#6a1b9a', '#ef6c00', '#00838f'];
  const tilts = [-1.1, 0.7, 0.9, -0.6, -0.8, 1.2];
  const planted: [Category, string][] = [];
  const manual: string[] = [];
  const list = titles.map(([zh, en], i) => {
    const p = person(f);
    const company = f.company();
    const tel = f.landline();
    const tax = f.taxId();
    const accent = accents[i];
    const roman = romanName(p.email);
    planted.push(['姓名', p.name], ['公司', company], ['市話', tel], ['手機', p.mobile], ['電子郵件', p.email], ['地址', p.address]);
    if (i % 2 === 0) planted.push(['統編', tax]);
    manual.push(roman);
    const body =
      i % 2 === 0
        ? `<div style="display:flex;justify-content:space-between;align-items:flex-start">
             <div style="font:700 13px ${SANS};color:${accent}">${company}</div>
             <div style="width:26px;height:26px;border-radius:6px;background:${accent}"></div>
           </div>
           <div style="margin-top:10px;font:700 24px ${SANS};letter-spacing:.12em">${p.name}</div>
           <div style="font:12px ${SANS_EN};color:#444">${roman}｜${zh} ${en}</div>
           <div style="margin-top:10px;font:11.5px/1.55 ${SANS}">
             <div>電話 ${tel}　手機 ${p.mobile}</div>
             <div>${p.email}</div>
             <div>${p.address}</div>
             <div>統一編號 ${tax}</div>
           </div>`
        : `<div style="height:6px;background:${accent};margin:-14px -16px 10px"></div>
           <div style="font:700 20px ${SERIF_EN}">${roman}</div>
           <div style="font:12px ${SANS_EN};color:#444">${en}</div>
           <div style="margin-top:4px;font:15px ${SONG}">${p.name}　<span style="font-size:12px">${zh}</span></div>
           <div style="margin-top:8px;font:11.5px/1.55 ${SANS_EN}">
             <div>T: ${tel}　M: ${p.mobile}</div>
             <div>E: ${p.email}</div>
             <div style="font-family:${SANS}">${company}</div>
             <div style="font-family:${SANS}">${p.address}</div>
           </div>`;
    return `<div style="width:340px;height:204px;box-sizing:border-box;padding:14px 16px;background:#fff;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,.35);transform:rotate(${tilts[i]}deg);overflow:hidden">${body}</div>`;
  });
  return {
    title: '名片掃描',
    color: true,
    tilt: 0.2,
    handwritten: [],
    images: 0,
    planted,
    manual,
    html: `
<div style="position:absolute;inset:0;background:#d9d7d2"></div>
<div style="position:relative;padding:70px 44px;display:grid;grid-template-columns:340px 340px;justify-content:space-between;row-gap:64px;color:#1a1a1a">
  ${list.join('\n')}
</div>`,
  };
}

/** The five pages in order; one seed so the sample is identical on every run. */
export function scanPages(seed = 404): ScanPage[] {
  const f = new Fake(seed);
  return [letter(f), form(f), roster(f), invoice(f), cards(f)];
}
