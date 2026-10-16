# Tasks: 介面精簡（去識別化頁的輸出設定、偵測規則頁）

**Input**: `specs/008-ui-simplification/` 的 plan、spec、research、data-model、contracts、quickstart

**Tests**: 介面結構以 jsdom 單元測試驗證；既有測試依新結構更新；量測與截圖以瀏覽器驗證。

## Phase 1: Setup

- [X] T001 量測現況（1280×900、委外服務契約書範例）：輸出設定展開後高度、規則頁是否橫向捲動，記錄於 research.md

## Phase 2: Foundational

- [X] T002 src/core/types.ts、src/core/patterns.ts：`Pattern.group`、`Pattern.note`；內建規則名稱縮短、檢核說明移到 note

## Phase 3: User Story 1 — 輸出設定（P1）

- [X] T003 [P] [US1] tests/unit/output-panel.test.ts：兩列選擇、合併提醒、「依類別調整」選自訂時展開、「進階」只在編碼時出現、狀態列一行
- [X] T004 [US1] src/ui/process-view.ts：輸出設定兩列分段按鈕與範例、合併提醒、details.by-category、details.code-advanced
- [X] T005 [US1] src/ui/process-view.ts：狀態列精簡（模式、格式限制、含部分保留標籤＋提示框）、預覽說明一行
- [X] T006 [US1] src/styles.css：分段按鈕、輸出列、窄螢幕換行

## Phase 4: User Story 2 — 偵測規則頁（P1）

- [X] T007 [P] [US2] tests/unit/patterns-view.test.ts：三個分組與規則數、整組啟停（含部分狀態）、查看規則、表單按鈕打開與取消、編輯自訂規則；既有測試依新結構更新
- [X] T008 [US2] src/ui/patterns-view.ts：分組清單、整組開關、規則列、查看規則細節、新增／編輯表單按鈕
- [X] T009 [US2] src/styles.css：規則分組與規則列（grid）、窄螢幕

## Phase 5: Polish

- [X] T010 `npm test`、`npm run build`；量測改版後數字（SC-001、SC-002、SC-005），記錄於 research.md
- [X] T011 瀏覽器端對端：兩頁所有既有功能（切換模式、自訂與設為預設、共用編碼與匯入、標記方式、規則啟停、自訂規則新增／編輯／刪除）
- [X] T012 scripts/make-screenshots.ts 依新結構調整選擇器並重產截圖；README 對應的說明、index.html 與 llms.txt 的操作描述同步更新

## Dependencies

- T002 → T008。
- US1（process-view）與 US2（patterns-view）修改不同檔案，可平行；styles.css 依序修改。
- Polish 最後。
