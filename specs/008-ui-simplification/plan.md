# Implementation Plan: 介面精簡（去識別化頁的輸出設定、偵測規則頁）

**Branch**: `008-ui-simplification` | **Date**: 2026-10-16 | **Spec**: [spec.md](spec.md)

## Summary

只改呈現方式，不改功能。

**去識別化頁**：

- 輸出設定改成「保留」「標記」兩列分段按鈕，每列附一行範例或說明；
- 提醒合併成一行；
- 類別表收進「依類別調整」（選自訂時自動展開），編碼範圍收進「進階」（只在編碼時出現）；
- 狀態列精簡為一行，預覽說明縮成一行。

**偵測規則頁**：

- 依「台灣格式／國際與通用格式／自訂規則」分組，可整組啟停；
- 每條規則一行，比對規則與保留方式收在「查看規則」；
- 新增表單改為按鈕打開。

最後更新截圖與 README。

## Technical Context

**Language/Version**: TypeScript（既有）、Vite 8，無 UI 框架

**Primary Dependencies**: 無新增

**Storage**: 無新增；分組與展開狀態不記憶

**Testing**: Vitest（jsdom）：

- 規則頁的分組、整組啟停、查看規則、表單開關；
- 輸出設定的兩列、收合區塊的條件。

**Target Platform**: 現代瀏覽器、純靜態部署

**Project Type**: 單一前端專案

**Performance Goals**: 無（純版面調整）

**Constraints**: 既有功能、儲存格式、輸出結果不變

**Scale/Scope**: src/ui/process-view.ts（輸出設定、工具列）、src/ui/patterns-view.ts（重寫表格部分）、src/styles.css、src/core/patterns.ts（group、note）

## Constitution Check

| 原則 | 結果 |
|---|---|
| I 純前端 | ✅ 不涉及 |
| II 可逆 | ✅ 輸出不變 |
| III 人工覆核 | ✅ 預覽與偵測清單不變 |
| IV 規則透明 | ✅ 比對規則仍可在「查看規則」中完整檢視、每條可停用 |
| V 簡單 | ✅ 沿用原生 radio、details、checkbox，不新增依賴 |

## Project Structure

```text
specs/008-ui-simplification/
├── plan.md、research.md、data-model.md、quickstart.md、tasks.md
└── contracts/ui.md

src/core/types.ts        # Pattern.group、Pattern.note
src/core/patterns.ts     # 內建規則加 group、note，名稱縮短
src/ui/process-view.ts   # 輸出設定兩列、收合區塊、狀態列、預覽說明
src/ui/patterns-view.ts  # 分組、整組啟停、查看規則、表單按鈕
src/styles.css           # 分段按鈕、規則列、分組
tests/unit/patterns-view.test.ts、tests/unit/output-panel.test.ts
scripts/make-screenshots.ts、README.md
```

## Design

- **分段按鈕**：
  - 一組相連的 label＋radio，選中的高亮；
  - 窄螢幕時整列換行，範例移到下一行。
- **合併提醒**：
  - 部分保留：「部分保留會露出姓氏、證號前 2 碼等，並非完全匿名」；
  - 不需還原：「不需還原：只下載文件、沒有編碼表；空白佔位會保留字數」；
  - 兩者都適用時以「；」相接。
- **規則列**：
  - grid 欄位為「開關｜名稱｜類別｜範例（單行省略）｜查看規則」，窄螢幕時範例換到第二行；
  - 細節區以 `details`／按鈕切換。

## Complexity Tracking

無。
