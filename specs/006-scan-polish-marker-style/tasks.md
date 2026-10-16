# Tasks: 掃描辨識補強、名片排版不重疊與「不需還原」的標記方式

**Input**: `specs/006-scan-polish-marker-style/` 的 plan、spec、research、data-model、contracts、quickstart

**Tests**: 憲章要求 round-trip 自動化測試；標記方式與字級規則寫單元測試；辨識效果以 `npm run eval:ocr` 量測。

## Phase 1: Setup

- [X] T001 記錄基準：`npm run eval:ocr -- --sample all --verbose`（第 1 頁少讀的字、手寫值、名片頁、時間），寫入 specs/006-scan-polish-marker-style/research.md 的量測紀錄
- [X] T002 scripts/eval-ocr.ts：由預覽文字段（left、top、font-size、data-w）計算每頁重疊的文字段數，列入報表與 `--json`

## Phase 2: Foundational

- [X] T003 src/core/redactor.ts：新增 `MarkerStyle`（code／label／blank）與 `blankOut`；`outputFor`、`previewLabel`、`buildEdits`、`applyRedactions` 加上標記方式參數（預設 code），不需還原時 mapping 為空

## Phase 3: User Story 1 — 不需還原的標記方式（P1）

- [X] T004 [P] [US1] tests/unit/marker-style.test.ts：三種標記方式 × 部分保留／全部隱藏的輸出（王小明、0912-345-678、Email、地址）；分隔符號保留、○ 數量等於隱藏的文字數字數；label／blank 的 mapping 為空、輸出不含編碼
- [X] T005 [US1] src/formats/batch.ts：`buildArchive` 加上標記方式參數；不需還原時不寫入編碼表、清單不含編碼表欄；tests/integration/batch-archive.test.ts 補案例
- [X] T006 [US1] src/ui/process-view.ts：
  - `state.marker` 與標記方式選項（面板內，附範例與說明）；
  - 摘要顯示兩個膠囊與組合範例；
  - 不需還原時隱藏編碼範圍區塊。
- [X] T007 [US1] src/ui/process-view.ts：
  - 工具列主按鈕、更多選單、狀態列依標記方式切換；
  - 下載、打包、複製改用目前的標記方式；
  - `isDownloaded` 與移除確認在不需還原時只看文件。
- [X] T008 [US1] src/ui/restore-view.ts：上傳的文件找不到任何編碼標記時提示可能是不需還原的輸出
- [X] T009 [US1] tests/integration：Word、Excel、文字型 PDF、TXT 以 label／blank 輸出後解析，確認不含編碼；code 的 round-trip 不變
- [X] T010 [US1] src/styles.css：標記方式選項與「無法還原」提醒的樣式（沿用 mode-option）

## Phase 4: User Story 2 — 信函上的標題、條列編號、署名與手寫批註（P1）

- [X] T011 [US2] src/formats/ocr.ts：漏字區域原尺寸讀不出（無字詞達 60）時放大 2 倍再讀（research R1）
- [X] T012 [US2] src/formats/ocr.ts：行首重讀——行首左側有未被可信字詞覆蓋的墨跡時，「墨跡＋前兩個字」單行重讀，補上新字並移除被取代的低信心舊字；每頁最多 15 行（research R2）
- [X] T013 [US2] src/formats/ocr.ts：第二意見擴充——中文行中 1～3 字母、信心 < 90 的英文片段，以及信心 < 30 的單一中文字（每頁最多 20 個），以純中文模型重讀（research R3、R4）
- [X] T014 [US2] 以 eval 驗證第 1 頁（函、一～六、董事長、丁承）並調整參數

## Phase 5: User Story 3 — 名片頁文字不重疊（P2）

- [X] T015 [P] [US3] tests/unit/ocr-items.test.ts：含中文的段落以中文字框高度推算字級；上下相鄰且水平重疊的兩段，字級縮到不重疊
- [X] T016 [US3] src/formats/ocr.ts `ocrLinesToItems`：字級推算與同頁行距限制（research R5）
- [X] T017 [US3] 以 eval 驗證各頁重疊數為 0，並以瀏覽器檢視名片頁輸出

## Phase 6: Polish

- [X] T018 `npm test`、`npm run build`、`npm run eval:ocr -- --sample all`；SC-004～SC-006 達標或記錄原因，結果寫入 research.md
- [X] T019 瀏覽器端對端：三種標記方式的預覽、下載（單檔、打包）、複製；掃描範例的預覽、下載、還原
- [X] T020 scripts/make-screenshots.ts：新增標記方式截圖（面板展開、選「空白佔位」的預覽）；重產截圖，只保留有變化的
- [X] T021 README、index.html、public/llms.txt：標記方式的說明、何時選哪一個、不需還原的限制；掃描辨識的最新數據

## Dependencies

- T003 → US1（T004–T010）。
- US2、US3 都修改 src/formats/ocr.ts，依序進行（T011 → T012 → T013 → T016）。
- T002 先於 T014、T017（評分要能回報重疊）。
- Polish 最後。

## Parallel Opportunities

- T004 與 T015 是不同檔案的測試，可平行撰寫。
- US1（core／ui）與 US2／US3（ocr）修改不同檔案，可交錯進行。

## Implementation Strategy

1. 先做 T001–T003 與 US1：使用者價值最直接，風險最低。
2. 接著做 US2、US3：每一步都以 eval 驗證不退步。
3. 最後更新文件與截圖。
