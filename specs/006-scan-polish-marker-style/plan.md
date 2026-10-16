# Implementation Plan: 掃描辨識補強、名片排版不重疊與「不需還原」的標記方式

**Branch**: `006-scan-polish-marker-style` | **Date**: 2026-10-16 | **Spec**: [spec.md](spec.md)

## Summary

三件事：

1. **掃描辨識補強**：
   - 漏字區域讀不出時放大 2 倍再讀；
   - 行首有未讀墨跡時，連同該行開頭一起重讀，補回條列編號；
   - 中文行中的短英文片段與極低信心的中文字，以純中文模型重讀。
2. **排版不重疊**：含中文的文字段以中文字框高度推算字級；同頁上下相鄰的文字段，字級合計不超過基線距離。
3. **標記方式**：
   - 輸出設定新增「編碼／類別／空白佔位」，與既有輸出方式並用；
   - 不需還原時不產生編碼表，下載與介面隨之簡化；
   - 還原頁在找不到編碼時提示原因。
   - 憲章原則 II 修訂為「預設可還原、使用者明確選擇時例外」。

最後更新 README 與截圖。

## Technical Context

**Language/Version**: TypeScript（既有）、Vite 8

**Primary Dependencies**: 既有 pdfjs-dist、pdf-lib、tesseract.js；不新增依賴

**Storage**: 無；標記方式只存在記憶體中（憲章只允許儲存規則設定）

**Testing**:
- Vitest 單元測試：標記方式的輸出、批次壓縮檔、字級與重疊。
- 整合測試：三種標記方式 × 各格式的輸出；編碼方式的 round-trip 不變。
- `npm run eval:ocr`：第 1 頁字元與手寫值、各頁文字重疊數、時間。

**Target Platform**: 現代瀏覽器、純靜態部署

**Project Type**: 單一前端專案

**Performance Goals**: 5 頁掃描範例總辨識時間 ≤ 25 秒（目前 21.7 秒，+15% 以內）

**Constraints**:
- 預設行為（編碼、可還原）不變；
- 文字型 PDF、Word、Excel 的版面重建不變（字級調整只用於掃描頁）。

**Scale/Scope**:
- 每頁行首重讀最多 15 行、低信心中文字最多 20 個；
- 介面改動集中在輸出設定面板、工具列與還原頁。

## Constitution Check

| 原則 | 結果 |
|---|---|
| I 純前端 | ✅ 全部在瀏覽器內完成，不新增網路請求 |
| II 可逆 | ⚠️ → ✅ 「類別」「空白佔位」不可還原。修訂憲章為 1.1.0：預設必須可還原；使用者明確選擇不需還原的標記方式、且介面清楚告知時可例外（research R7）。編碼方式的 round-trip 測試維持 |
| III 人工覆核 | ✅ 預覽即輸出，三種標記方式都在預覽中呈現 |
| IV 規則透明 | ✅ 偵測規則不變 |
| V 簡單 | ✅ 不新增依賴；標記方式以一個參數貫穿既有函式 |
| 安全：不殘留敏感資訊 | ✅ 「○」只取代隱藏部分；保留的字元與既有輸出方式相同；介面註明「○」會透露字數 |

**Post-design re-check**：修訂憲章後各項皆通過。

## Project Structure

```text
specs/006-scan-polish-marker-style/
├── plan.md、research.md、data-model.md、quickstart.md、tasks.md
└── contracts/output-panel.md

.specify/memory/constitution.md     # 原則 II 修訂，1.0.0 → 1.1.0

src/
├── core/redactor.ts        # MarkerStyle；outputFor／previewLabel／buildEdits／applyRedactions 帶標記方式
├── formats/
│   ├── batch.ts            # buildArchive 依標記方式決定是否寫入編碼表
│   └── ocr.ts              # 漏字放大重讀、行首重讀、短英文與低信心中文重讀、字級與行距限制
├── ui/process-view.ts      # 標記方式選項、工具列、狀態列、下載與複製、已下載判斷
└── ui/restore-view.ts      # 找不到編碼時的提示

scripts/eval-ocr.ts          # 每頁文字段重疊數
scripts/make-screenshots.ts  # 新增標記方式截圖

tests/
├── unit/marker-style.test.ts       # 三種標記方式 × 輸出方式
├── unit/ocr-items.test.ts          # 字級與行距限制
└── unit/batch-archive／integration # 不需還原時壓縮檔不含編碼表
```

**Structure Decision**: 沿用單一前端專案結構；標記方式是 `core/redactor.ts` 的一個參數，UI 只在處理頁加一組選項。

## Design

- **掃描辨識流程**（每頁，在 005 的流程上調整）：
  1. 第一次辨識；
  2. 漏字區域：原尺寸讀不出時放大 2 倍再讀；
  3. 行首重讀：行首左側有未讀墨跡 → 「墨跡＋前兩個字」單行重讀，補上新字、移除被取代的低信心舊字；
  4. 第二意見：原有的低信心英文、新增中文行中的短英文（≤ 3 字母、信心 < 90）、極低信心中文字（< 30）；
  5. 圖片、勾選框、結構（不變）；
  6. 轉成文字段：字級以中文字框高度推算，最後做同頁行距限制。
- **標記方式**：
  - `state.marker` 決定 `previewLabel`、`outputFor`、`applyRedactions` 的第三個參數；
  - 改變時所有文件標為有變更（需重新下載）；
  - `isDownloaded` 在不需還原時只看文件；
  - 工具列與面板依 `state.marker` 呈現（contracts/output-panel.md）。
- **評分**：`eval-ocr.ts` 由預覽的文字段位置計算重疊數並列入報表。

## Complexity Tracking

| 項目 | 理由 |
|---|---|
| 憲章原則 II 例外 | 使用者明確需要「只去識別化、不還原」；以「預設可還原＋明確選擇＋清楚告知」限定範圍，記錄於憲章 1.1.0 |
