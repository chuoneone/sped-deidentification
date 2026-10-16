# Implementation Plan: 圖片型（掃描）PDF 的文字辨識與去識別化

**Branch**: `004-scanned-pdf-ocr` | **Date**: 2026-10-15 | **Spec**: [spec.md](spec.md)

## Summary

PDF 整份都沒有文字層時，改用瀏覽器內的文字辨識：
1. pdf.js 把每頁畫成 canvas。
2. Tesseract.js（`chi_tra+eng`）辨識文字。
3. 把每一行依字距切成文字段，轉成與文字層 PDF 相同的版面資料（文字、座標、字級、寬度）。

之後的偵測、預覽、輸出（文字版面重建）與還原都沿用現有流程。

辨識期間顯示專屬的辨識畫面，內容包括頁數、進度、目前頁縮圖與取消按鈕。辨識程式與模型由本站一同部署，不呼叫任何第三方網址。

另外新增 5 頁的模擬掃描範例，範例區改為單排 5 格。

## Technical Context

**Language/Version**: TypeScript（既有，`tsc --noEmit` + Vite 8）

**Primary Dependencies**:
- 既有：pdfjs-dist 4.10、pdf-lib。
- 新增：`tesseract.js@7`（連帶 `tesseract.js-core`）、`@tesseract.js-data/chi_tra`、`@tesseract.js-data/eng`。理由見 research R1–R3。

**Storage**: 無；辨識模型只使用 HTTP 快取（research R4）。

**Testing**:
- Vitest（jsdom）：單元測試與整合測試。
- 瀏覽器端對端：依 quickstart 手動或用 Playwright 驗證。

**Target Platform**: 現代瀏覽器（需支援 WebAssembly 與 Web Worker），純靜態部署（GitHub Pages）。

**Project Type**: 單一前端專案（`src/` + `tests/` + `scripts/`）。

**Performance Goals**:
- 5 頁範例在一般筆電 60 秒內辨識完成（實測 Node 約 1.2 秒／頁）。
- 首次下載不超過 10 MB（實際約 8.6 MB）。

**Constraints**:
- 零第三方請求。
- 非 OCR 檔案不得載入辨識程式（以動態 import 隔離）。
- 單一頁面 canvas 長邊不超過 4000 px。

**Scale/Scope**: 沿用既有上限，單檔 20 MB、一次 10 個檔案；不設頁數上限，但可取消。

## Constitution Check

| 原則 | 結果 |
|---|---|
| I 純前端、零資料外傳 | ✅ 辨識在瀏覽器的 Web Worker 內完成。worker、core、模型都由本站提供（R3），不連任何 CDN。文件內容不會送出。 |
| II 可逆與無損還原 | ✅ 輸出是「辨識文字依原位置重繪」的 PDF，編碼表可把文字還原成辨識結果（忽略空白，與現有 PDF round-trip 定義相同）。原頁面影像不在還原範圍內，使用者已確認。 |
| III 使用者最終決定權 | ✅ 辨識結果走相同的預覽、取消、手動新增流程。狀態列明確提醒辨識可能有誤、需逐頁核對。 |
| IV 規則透明 | ✅ 偵測規則不變；辨識只負責產生文字，不新增隱藏規則。 |
| V 簡單優先 | ⚠️ 新增 tesseract.js 依賴，理由見 Complexity Tracking。其餘沿用既有的 PDF 版面資料、預覽與輸出，不另建新格式。 |
| 安全：瀏覽器儲存只放 pattern | ✅ `cacheMethod: 'none'`，模型不寫入 IndexedDB。 |
| 安全：輸出不殘留敏感資訊 | ✅ 輸出只重繪文字，原頁面影像一律不複製。 |

**Post-design re-check**：設計完成後再檢查一次，以上各項維持不變。

## Project Structure

### Documentation (this feature)

```text
specs/004-scanned-pdf-ocr/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── ocr-assets.md      # 部署在 ocr/ 的檔案與執行期設定
│   └── ocr-progress-ui.md # 辨識畫面的內容與行為
└── tasks.md
```

### Source Code

```text
src/
├── core/types.ts            # LoadedDocument 加上 ocr?: boolean
├── formats/
│   ├── index.ts             # parseDocument(file, opts) 把 OCR 選項傳給 PDF；formatLimitations 加入 OCR 說明
│   ├── pdf.ts               # 拆出 assemblePdf()，讓文字層與 OCR 共用；無文字層時改走 OCR；generatePdf 對 OCR 文件縮放到同一行下一段為止
│   └── ocr.ts               # 新增：recognizePdf()（canvas + Tesseract、進度、取消）與純函式 ocrLinesToItems()
├── ui/
│   ├── ocr-overlay.ts       # 新增：辨識畫面（縮圖、進度、取消）
│   ├── process-view.ts      # importFiles 依檔建立 AbortController 與辨識畫面；工具列加註「文字辨識」；上傳說明更新
│   ├── restore-view.ts      # 不變（parseDocument 不帶 OCR 選項，維持既有錯誤）
│   └── samples.ts           # 新增掃描範例卡片
└── styles.css               # 辨識畫面、範例單排 5 格

vite.config.ts               # ocrAssets() plugin（R3）
scripts/
├── lib/render-scan.ts       # 新增：HTML → 模擬掃描 JPEG → 影像型 PDF
├── lib/scan-pages.ts        # 新增：5 頁版面（信函、表單、名冊、Invoice、名片），使用 Fake 產生資料
└── make-examples.ts         # 輸出掃描範例到 public/samples 與 examples/；06 的空白 PDF 改名

tests/
├── unit/ocr-items.test.ts            # ocrLinesToItems
├── integration/roundtrip-ocr.test.ts # OCR 版面 → 去識別化 → 輸出 → 還原
└── fixtures/ocr-lines.json           # 擷取自真實辨識輸出的行／字資料
```

**Structure Decision**: 沿用既有單一前端專案結構。OCR 程式放在 `formats/ocr.ts`，由 `pdf.ts` 動態 import，確保非 OCR 檔案不會載入。

## Design

### 解析流程（`parsePdf(file, opts)`）

1. 用 pdf.js 讀出每頁的文字層，轉成 `RawItem { text, x, y, fontSize, width, eol }`。
2. 判斷是否有文字：
   - 有任何非空白文字 → 交給 `assemblePdf(fileName, rawPages, false)`，結果與現在完全相同。
   - 沒有文字，也沒有 `opts.ocr`（例如還原頁）→ 丟出既有錯誤，訊息改為「此 PDF 沒有可擷取的文字層（可能是掃描影像）；還原請使用本工具輸出的去識別化檔案」。
   - 沒有文字、有 `opts.ocr` → 執行 `(await import('./ocr')).recognizePdf(pdf, opts.ocr)`，取得 `RawPage[]` 後呼叫 `assemblePdf(..., true)`。
3. 辨識完仍然沒有文字時，丟出「未辨識到任何文字」。

`assemblePdf` 就是現在 `parsePdf` 裡的組字迴圈（判斷同一行、補空白、補換行），抽出來成為獨立函式，供兩種來源共用。

### OCR（`formats/ocr.ts`）

- **`recognizePdf(pdf, { signal, onProgress })`**：
  1. 回報 `stage: 'engine'`。
  2. 建立 Tesseract worker（本站路徑、`cacheMethod: 'none'`、PSM 3）。
  3. 逐頁處理：render 成 canvas → 產生縮圖並回報 → `recognize(canvas, {}, { blocks: true, text: false })` → `ocrLinesToItems`。
  4. 結束時（`finally`）一律 terminate worker。
- **`ocrLinesToItems(lines, scale, pageHeight)`**：純函式，規則見 research R6。
- **進度**：Tesseract 的 logger 會回報 `recognizing text` 的進度 p。整體進度為 `(頁序 + p) / 總頁數`。

### 輸出（`generatePdf`）

當 `doc.ocr` 為 true 時，每個項目的可用寬度是「同一行（y 差小於半個字級）中、右側最近一段的 x」減去 2pt；右側沒有其他段時，算到右邊界（頁寬 − 36）。字級用 `fitSize` 縮到這個寬度以內，避免互相重疊。文字層 PDF 的行為不變。

### UI

- **辨識畫面**（`ui/ocr-overlay.ts`）：
  - 疊在 `withBusy` 畫面之上（z-index 較高）。
  - 掛在 `<body>` 下，所以 `#app` 處於 inert 時，取消按鈕仍可點擊。
  - 內容見 contracts/ocr-progress-ui.md。
- **`importFiles`**：每個檔案各建一個 `AbortController`。
  - 第一次收到 `onProgress` 時才建立辨識畫面，所以一般檔案不會出現。
  - parse 結束時關閉畫面。
  - 遇到 `AbortError` 時提示「已取消辨識」，繼續處理下一個檔案。
- **工具列**：格式徽章旁加一個「文字辨識」標籤；格式限制 ⓘ 的內容改用 OCR 版說明（FR-011）。
- **上傳頁說明**：「支援 PDF（含文字層）」改為「支援 PDF（含掃描檔，會在瀏覽器內辨識文字）」。
- **範例區**：
  - 5 張卡片依序為 Word、PDF、掃描 PDF、Excel、Markdown。
  - `.sample-row` 在桌機為 5 欄。卡片改為上下排：名稱與描述在上，「載入／下載」按鈕橫排在下，避免 5 欄時太擠。
  - 900px 以下改為 2 欄，最後一張若落單則跨兩欄；560px 以下改為 1 欄。

### 範例

`scripts/lib/scan-pages.ts` 以固定種子產生 5 頁 HTML：

1. **中文信函**：宋體，信頭加段落，夾帶日期、契約編號、金額、帳號。
2. **申請表單**：格線欄位與勾選框，欄位值用楷體模擬手寫。
3. **名冊表格**：12 列 × 6 欄。
4. **英文 Invoice**：英文欄位、品項表、小計、稅額、總計，並帶中文公司名、統編、+886 電話、Email。
5. **雙語名片**：彩色，2 × 3 張。

`scripts/lib/render-scan.ts` 用 Chrome 以 200 DPI 截圖成 JPEG（第 1–4 頁灰階、第 5 頁彩色，各頁旋轉 0.2–0.4°，加上紙張底色與雜訊），再用 pdf-lib 包成 PDF。輸出位置：
- `public/samples/scanned.pdf`
- `examples/01-核心流程/掃描文件.pdf`

`examples/06-格式與邊界/掃描型無文字層.pdf` 改名為 `空白頁無文字.pdf`，預期結果為「未辨識到任何文字」。

## Testing

- 單元：`ocrLinesToItems` 的切段、中文併字、英文保留空白、框線過濾、座標與字級換算。
- 整合：
  - fixture → `assemblePdf` → 偵測（命中姓名、身分證、手機、Email、統編）→ `generatePdf` → `parsePdf` → 還原，比對文字（忽略空白）。
  - 輸出 PDF 不含 `/Image`。
  - 同一行相鄰段的繪製範圍不重疊。
- 既有測試全數通過，包含「無文字層 PDF（未帶 OCR 選項）會被拒絕」。
- 端對端（quickstart）：
  - 在瀏覽器載入掃描範例，確認辨識畫面、5 頁進度、取消，以及網路請求全部同源。
  - 統計偵測命中率（SC-002）。
  - 下載後到還原頁驗證還原結果。
  - 檢查 375／768／1280 三種寬度的版面。

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| 新增 tesseract.js 與兩個語言模型套件 | 瀏覽器內辨識繁中＋英文的唯一成熟選項（R1） | 雲端 OCR 違反原則 I；自行實作 OCR 不切實際 |
| vite.config.ts 新增約 30 行的 asset plugin | 要讓 worker／core／模型以固定檔名由本站提供（R3） | 提交 17 MB 二進位檔到 `public/`，或另寫 prebuild 複製腳本，都更難維護 |
