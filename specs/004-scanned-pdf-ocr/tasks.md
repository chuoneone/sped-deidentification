# Tasks: 圖片型（掃描）PDF 的文字辨識與去識別化

**Input**: `specs/004-scanned-pdf-ocr/` 下的 plan.md、spec.md、research.md、data-model.md、contracts/、quickstart.md

**Tests**: constitution 要求 round-trip 必須有自動化測試，因此包含 OCR 版面轉換的單元測試與 round-trip 整合測試。

## Phase 1: Setup

- [X] T001 安裝 `tesseract.js@7`、`@tesseract.js-data/chi_tra`、`@tesseract.js-data/eng` 為 dependencies（package.json、package-lock.json）
- [X] T002 在 vite.config.ts 新增 `ocrAssets()` plugin：
  - 依 contracts/ocr-assets.md 的檔案表，建置時以 `emitFile` 用固定檔名輸出到 `ocr/`；
  - 開發時以 middleware 從 node_modules 提供相同路徑；
  - 驗證：`npm run build` 後 `dist/ocr/` 有 6 個檔案。

## Phase 2: Foundational（所有 user story 的前置）

- [X] T003 在 src/core/types.ts 的 `LoadedDocument` 加上 `ocr?: boolean`
- [X] T004 重構 src/formats/pdf.ts：
  - 拆出 `RawItem`／`RawPage` 與匯出的 `assemblePdf(fileName, rawPages, ocr)`，內容就是現在的組字迴圈；
  - `parsePdf` 先把文字層轉成 RawPage，再呼叫 `assemblePdf`；
  - 驗證：既有的 tests/integration/roundtrip-pdf.test.ts 不修改即通過。

## Phase 3: User Story 1 — 掃描檔也能去識別化（P1）🎯 MVP

**Goal**: 圖片型 PDF 能辨識成文字段，並走完既有的偵測、預覽、輸出流程。

**Independent Test**: 用 fixture 的辨識行資料組成文件，可偵測到姓名、身分證、手機、Email、統編；文字層 PDF 行為不變。

- [X] T005 [P] [US1] ~~擷取辨識輸出存成 fixture JSON~~ 改為整合測試直接以 Node 版 Tesseract（與網站相同模型）辨識 public/samples/scanned.pdf（約 10 秒），單元測試則以仿照真實輸出的手寫行資料涵蓋邊界情況，不另存 fixture
- [X] T006 [P] [US1] 撰寫 tests/unit/ocr-items.test.ts，涵蓋 `ocrLinesToItems` 的：
  - 間距大於 1.5 倍行高時切段；
  - 中文字之間不加空白；
  - 英文單字之間保留空白；
  - 丟棄 `|`、`=` 等框線字元並去除頭尾的 `|`；
  - x／y／字級／寬度的座標換算。
- [X] T007 [US1] 新增 src/formats/ocr.ts：
  - 實作純函式 `ocrLinesToItems(lines, scale, pageHeight)`，規則見 research R6；
  - 實作 `recognizePdf(pdf, { signal, onProgress })`：Tesseract worker 使用本站路徑、`cacheMethod: 'none'`、PSM 3；逐頁 render 成 canvas 後辨識；`finally` 時 terminate；
  - 讓 T006 通過。
- [X] T008 [US1] 在 src/formats/pdf.ts 的 `parsePdf(file, opts)` 中：
  - 全無文字且有 `opts.ocr` 時，動態 import ocr.ts 進行辨識，並以 `assemblePdf(..., true)` 產生文件（`ocr: true`）；
  - 辨識後仍無文字時，丟出「未辨識到任何文字」；
  - 未帶 `opts.ocr` 時，維持拒絕並更新錯誤訊息（FR-014）。
- [X] T009 [US1] 在 src/formats/index.ts 中：
  - `parseDocument(file, opts?)` 把 `ocr` 選項傳給 PDF；
  - `formatLimitations(format, ocr?)` 回傳 OCR 版說明（FR-011）。
- [X] T010 [US1] 修改 src/ui/process-view.ts：
  - `importFiles` 對每個檔案傳入 OCR 選項；
  - 工具列格式徽章旁顯示「文字辨識」標籤；ⓘ 改用 OCR 說明；
  - 上傳頁說明改為「支援 PDF（含掃描檔，會在瀏覽器內辨識文字）」。

## Phase 4: User Story 2 — 辨識畫面、進度與取消（P1）

**Goal**: 辨識時出現專屬畫面，可看到頁數、進度、縮圖，並可取消。

**Independent Test**: 在瀏覽器載入掃描範例時出現辨識畫面且進度前進；取消後畫面恢復，檔案沒有加入；載入 Word 範例時仍是原本的畫面。

- [X] T011 [P] [US2] 新增 src/ui/ocr-overlay.ts：`ocrOverlay(fileName, onCancel)` 回傳 `{ update(progress), close() }`，內容與行為依 contracts/ocr-progress-ui.md
- [X] T012 [P] [US2] 在 src/styles.css 加入辨識畫面樣式：卡片、縮圖、掃描線動畫（含 reduced-motion）、進度條，以及 375px 版面
- [X] T013 [US2] 在 src/formats/ocr.ts 回報進度：`engine` 階段、每頁的縮圖（寬 160px 的 JPEG data URL），以及由 Tesseract logger 換算的整體進度；收到 abort 時以 race 立即丟出 `AbortError` 並 terminate
- [X] T014 [US2] 修改 src/ui/process-view.ts 的 `importFiles`：
  - 每個檔案各建一個 `AbortController`；
  - 第一次收到 progress 時才開啟辨識畫面，結束時關閉；
  - 遇到 `AbortError` 時提示「已取消辨識「檔名」」，並繼續處理下一個檔案。

## Phase 5: User Story 3 — 下載與還原只處理文字（P2）

**Goal**: OCR 文件的輸出不含影像、相鄰段不重疊，且可完整還原。

**Independent Test**: fixture → 去識別化 → `generatePdf` → `parsePdf` → 還原，文字一致；輸出中沒有影像。

- [X] T015 [P] [US3] 撰寫 tests/integration/roundtrip-ocr.test.ts：
  - 範例掃描檔的真實辨識結果經 `ocrLinesToItems` 與 `assemblePdf` 組成文件 → 偵測（姓名、身分證、手機、Email、統編都要命中）→ `generatePdf` → `parsePdf` → `restore`；
  - 比對文字（忽略空白）；
  - 輸出不含 `/Image`、不含原文；
  - 同一行相鄰段的繪製範圍不重疊。
- [X] T016 [US3] 在 src/formats/pdf.ts 的 `generatePdf` 中，`doc.ocr` 為 true 時，每段縮放到「同一行右側下一段的 x − 2pt」或右邊界以內（research R7），讓 T015 通過

## Phase 6: User Story 4 — 掃描範例與範例區單排（P2）

**Goal**: 提供擬真的 5 頁掃描範例（中文、英文、表格、數字），範例區單排 5 格。

**Independent Test**: `npm run examples` 產生 public/samples/scanned.pdf（5 頁、只有影像），首頁範例區在 1280px 寬度下排成一排。

- [X] T017 [P] [US4] 新增 scripts/lib/scan-pages.ts：用 `Fake` 以固定種子產生 5 頁 HTML，並匯出各頁植入的敏感值清單：
  1. 中文信函：宋體，含日期、契約編號、金額、帳號；
  2. 手寫申請表單：格線、勾選框、楷體填寫；
  3. 名冊表格：12 列 × 6 欄；
  4. 英文 Invoice：品項、數量、單價、金額、小計、稅額、總計，並含中文公司名、統編、+886 電話、Email；
  5. 中英雙語名片：彩色，2 × 3 張。
- [X] T018 [P] [US4] 新增 scripts/lib/render-scan.ts：
  - 用 puppeteer-core 與本機 Chrome 以 200 DPI 截圖成 JPEG；
  - 模擬掃描：灰階或彩色、旋轉 0.2–0.4°、紙張底色、雜訊；
  - 用 pdf-lib 把影像鋪滿 A4，不加任何文字層。
- [X] T019 [US4] 修改 scripts/make-examples.ts：
  - 輸出 public/samples/scanned.pdf 與 examples/01-核心流程/掃描文件.pdf；
  - 把 examples/06-格式與邊界/掃描型無文字層.pdf 改名為 空白頁無文字.pdf；
  - 執行 `npm run examples`。
- [X] T020 [US4] 修改 src/ui/samples.ts 與 src/styles.css：
  - 新增掃描範例卡片，順序為 Word、PDF、掃描 PDF、Excel、Markdown；
  - 桌機 5 欄單排，卡片改為上下排；
  - 900px 以下 2 欄、最後一張落單時跨兩欄；560px 以下 1 欄。
- [X] T021 [US4] 用 Node 版 Tesseract 對 5 頁範例影像辨識，再跑內建偵測，計算植入值的命中率（SC-002 ≥ 90%）；未達標時調整版面或字體（結果：140/153 = 91.5%，已納入 roundtrip-ocr 測試；名冊改用蘋方與淺色框線，未命中者集中在手寫欄位）

## Phase 7: Polish & Cross-Cutting

- [X] T022 [P] 更新說明文件：README.md（支援格式、範例下載表、掃描檔說明）、index.html 的靜態說明與 FAQ、public/llms.txt
- [X] T023 執行 `npm test` 與 `npm run build`，全部通過
- [X] T024 依 quickstart.md 進行瀏覽器端對端驗證：
  - 辨識畫面與 5 頁進度、60 秒內完成；
  - 取消；
  - 所有網路請求同源；
  - 下載後還原；
  - 還原頁拒絕影像檔；
  - Word 範例不載入 `ocr/`；
  - 375／768／1280 三種寬度的版面。
- [X] T025 重拍 README 中受影響的截圖（上傳頁範例區），並新增辨識畫面截圖（docs/screenshots/）

## Dependencies & Execution Order

- Phase 1 → Phase 2 → 其餘各 phase。
- US1（T005–T010）是 MVP，US2、US3 都建立在 US1 的 ocr.ts／pdf.ts 之上。
- US4 的範例產生（T017–T019）不依賴 src，可與 US1 平行；T020 需要 T019 產出的檔案，T021 需要 T019。
- T005 需要範例影像，或研究時產生的測試頁，才能擷取真實辨識輸出。
- Polish 在所有 story 完成後進行。

## Parallel Opportunities

- T005、T006 可平行；T011、T012 可平行；T017、T018 可平行。
- US4 的腳本工作（T017–T019）可與 US1 的 src 工作平行。

## Implementation Strategy

1. **MVP**：Phase 1–3（掃描 PDF 可辨識並去識別化，暫時沿用原本的讀檔畫面）。
2. 加上 US2（辨識畫面與取消），完成兩個 P1 story。
3. 加上 US3（輸出不重疊、round-trip 測試）與 US4（範例、範例區）。
4. Polish：文件、截圖、端對端驗證。

## Phase 8: 修訂 2026-10-16（100 MB、手寫、保留圖片）

- [X] T026 [P] 單檔上限改為 100 MB；超過時以阻擋式 `<dialog>` 列出超限檔案（src/core/types.ts、src/ui/components.ts `rejectOversized`、process-view／restore-view），並補 tests/unit/size-limit.test.ts；更新 scripts/make-examples.ts 的超大檔案說明
- [X] T027 [P] 以 Codex 生成 3 張不含文字的圖片（機房照片、SSD 產品照、標誌圖形），保存到 scripts/assets/scan/
- [X] T028 範例加入手寫批註與圖片（scripts/lib/scan-pages.ts、render-scan.ts）；名冊改為只有橫線的表格；重新產生 public/samples/scanned.pdf 與 examples/01-核心流程/掃描文件.pdf
- [X] T029 實測 Tesseract 版面分析能否標出圖片區塊，決定偵測方式；在 src/formats/ocr.ts 裁切「不含文字的圖片區塊」，存入 PdfPage.images
- [X] T030 輸出：src/formats/pdf.ts `generatePdf` 依原位置嵌入保留的圖片；預覽：src/ui/preview.ts 顯示保留圖片與「保留圖片／取消保留」切換，切換時 markDirty（src/ui/process-view.ts）
- [X] T031 測試：單元測試圖片區塊判定；roundtrip-ocr 整合測試驗證範例 3 張圖片都被保留、取消保留後輸出不含該圖；以瀏覽器流程重現腳本量測命中率
- [X] T032 演算法優化（FR-025）：`removeRules`、`deepenColour`、`fixConfusables`、低信心英數字詞的純中文第二意見（原倍率＋2 倍）；以網站實際流程逐項量測並記錄於 research R11、spec 修訂（二）；補 tests/unit/ocr-image.test.ts
- [X] T033 漏字補辨識 `uncoveredText`（含單元測試）與號碼斷開重接；量測後覆蓋門檻取 30（research R13）
- [X] T034 偵測器：「工程師」不再誤判為姓名「程師」，被拒的比對只跳過兩個字後續掃（src/core/patterns.ts、src/core/detector.ts、tests/unit/patterns.test.ts）
- [X] T035 對答案用的原稿：產生掃描範例時輸出 tests/fixtures/scanned-sample.answer.json（各頁文字、印刷／手寫值、圖片位置）；整合測試改讀原稿並加上字元召回率檢查
- [X] T036 `npm run eval:ocr`（scripts/eval-ocr.ts）：逐頁字元召回／精確、個資命中、讀錯仍遮蔽、誤判、圖片保留；姓名停用詞補「簡訊」「向本」
