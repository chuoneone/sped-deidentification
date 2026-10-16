# Tasks: 掃描 PDF 輸出的版面還原、勾選框與傾斜文字辨識

**Input**: `specs/005-scan-layout-fidelity/` 的 plan、spec、research、data-model、contracts、quickstart

**Tests**: 版面偵測以合成像素寫單元測試；round-trip 與輸出結構寫整合測試（constitution 要求）；效果以 `npm run eval:ocr` 量測。

## Phase 1: Setup

- [X] T001 先跑一次 `npm run eval:ocr` 記下基準（字元、個資、圖片、時間），寫入 research.md 的量測紀錄

## Phase 2: Foundational

- [X] T002 src/core/types.ts：新增 `PdfRule`、`PdfFill`、`PdfCheckbox`，`PdfItemLayout.color?`，pdf 版面頁面帶 `rules?`／`fills?`／`checkboxes?`
- [X] T003 src/formats/pdf.ts：`PdfTextItem.color?`、`PdfPage` 結構欄位；`assemblePdf` 傳遞到 handle 與 layout

## Phase 3: 原稿與評分（US4，先做才能量測其他 story）

- [X] T004 [P] [US4] scripts/lib/scan-pages.ts：勾選框加 `data-checkbox`
- [X] T005 [P] [US4] scripts/lib/render-scan.ts：
  - 取消傾斜後，從 DOM 擷取線段（邊框、細色條、虛線）、底色、勾選框，寫入 PageTruth；
  - 支援以 pdf-lib 旋轉頁面影像（90°／180°）。
- [X] T006 [US4] scripts/make-examples.ts：
  - 原稿增列結構；
  - 產生角度樣本 tests/fixtures/scan-angles.pdf 與 scan-angles.answer.json；
  - 重產後還原與本功能無關的範例檔。
- [X] T007 [US4] scripts/eval-ocr.ts：`--sample main|angles|all`；新增線段召回／精確、底色命中、勾選框找到／狀態，以及角度樣本各頁字元召回
- [X] T008 [US4] src/ui/preview.ts：PDF 頁面的 `svg.pdf-structure` 帶 `data-rule`／`data-fill`／`data-checkbox` 屬性（供評分讀取）

## Phase 4: User Story 1 — 線條、底色、文字顏色（P1）

- [X] T009 [P] [US1] tests/unit/layout-scan.test.ts：`findRules`（實線合併粗細、虛線、不誤判字筆畫）、`findFills`（表頭灰底、排除整頁底色與文字干擾）、`textColour`
- [X] T010 [US1] src/formats/layout-scan.ts：實作 `findRules`、`findFills`、`textColour`
- [X] T011 [US1] src/formats/ocr.ts：每頁擷取線段、底色與文字顏色；`removeRules` 改為依 `findRules` 的結果抹除
- [X] T012 [US1] src/formats/pdf.ts `generatePdf`：依序畫底色、圖片、線條（含虛線）、勾選框、彩色文字
- [X] T013 [US1] src/ui/preview.ts：SVG 呈現底色、線條，文字 span 套色

## Phase 5: User Story 2 — 勾選框（P1）

- [X] T014 [P] [US2] tests/unit/layout-scan.test.ts：`findCheckboxes`（空框、打勾、勾號超出框外、打叉、與「口」字區分）
- [X] T015 [US2] src/formats/layout-scan.ts：`findCheckboxes`
- [X] T016 [US2] src/formats/ocr.ts：擷取勾選框，以周圍留白過濾，移除框內雜字
- [X] T017 [US2] pdf.ts／preview.ts：繪製方框與勾號

## Phase 6: User Story 3 — 傾斜與轉向（P2）

- [X] T018 [P] [US3] tests/unit/layout-scan.test.ts：`estimateSkew`（合成傾斜文字行）、`lineOrientation`（橫向與直向文字）
- [X] T019 [US3] src/formats/layout-scan.ts：`estimateSkew`、`lineOrientation`
- [X] T020 [US3] src/formats/ocr.ts：
  - 渲染後判斷方向、轉正傾斜；
  - 平均信心值過低時試 180°；
  - 頁面寬高依轉向調整。
- [X] T021 [US3] src/formats/ocr.ts：低信心中文行以小角度放大重讀——實作並量測後移除（無明顯改善、增加 10%–18% 時間，見 research R7；spec FR-009 同步修訂）
- [X] T022 [US3] src/ui/ocr-overlay.ts＋ocr.ts：辨識畫面的階段文字（判斷方向／轉正、辨識文字、分析版面）

## Phase 7: Polish

- [X] T023 tests/integration/roundtrip-ocr.test.ts：結構寫入輸出 PDF（無點陣影像、有線條與底色）、文字 round-trip 不變
- [X] T024 依 eval 結果調整參數，直到 SC-001～SC-005 達標或記錄原因；結果寫入 research.md
- [X] T025 `npm test`、`npm run build`，以及瀏覽器端對端驗證（預覽、下載、還原）
- [X] T026 README、index.html、llms.txt、截圖（02g 等）更新
- [X] T027 依端對端檢查補強（src/formats/ocr.ts、pdf.ts）：
  - 被併進框裡的選項字（☑男 →「Ms」）只重讀框外部分並保留；
  - 勾選框與表格直線作為文字分段界線，輸出時文字寬度不越過它們；
  - 輕微傾斜（< 1°）照原樣辨識，版面在轉正副本上擷取後轉回（research R5）。

## Dependencies

- Phase 2 → Phase 3（評分）→ US1、US2、US3（可依序進行，每一步都以 eval 驗證）→ Polish。
- 所有 story 都會修改 ocr.ts 與 pdf.ts，因此依序進行；layout-scan.ts 的純函式與測試可以平行撰寫。

## Implementation Strategy

先完成評分（Phase 3），讓每一步都有數字可比；接著做 US1 與 US2，最能看出版面差異；再做 US3；最後依 eval 調參並更新文件。
