# Implementation Plan: 掃描 PDF 輸出的版面還原、勾選框與傾斜文字辨識

**Branch**: `005-scan-layout-fidelity` | **Date**: 2026-10-16 | **Spec**: [spec.md](spec.md)

## Summary

在 004 的掃描辨識流程中加入兩件事。

**辨識前**：判斷整頁方向與傾斜；傾斜 ≥ 1° 時讓 pdf.js 直接以轉正的角度重新渲染後辨識。

**辨識後**：從轉正的頁面像素擷取版面結構，包括線段、底色區塊、勾選框與每段文字的顏色（< 1° 的輕微傾斜照原樣辨識，結構在轉正副本上找到後轉回）。這些結構以純色向量圖形畫在輸出 PDF 與預覽中。勾選框位置上的雜字會被移除、被併進框裡的選項字會重讀；勾選框與表格直線也是文字分段與排版的界線。原稿與評分工具同步擴充結構與角度指標。

## Technical Context

**Language/Version**: TypeScript（既有）、Vite 8

**Primary Dependencies**: 既有 pdfjs-dist、pdf-lib、tesseract.js；不新增依賴與模型

**Storage**: 無

**Testing**:
- Vitest 單元測試：以合成像素測試線段、虛線、底色、勾選框、傾斜角度與文字顏色。
- 整合測試：結構寫入輸出 PDF、round-trip 文字不變。
- `npm run eval:ocr`：主範例加上角度樣本。

**Target Platform**: 現代瀏覽器、純靜態部署

**Project Type**: 單一前端專案

**Performance Goals**: 5 頁範例總辨識時間增加 ≤ 30%（004 基準約 19 秒）

**Constraints**: 結構以重新繪製的純色圖形呈現，不複製任何原頁面像素；文字型 PDF 與還原行為不變

**Scale/Scope**: 傾斜偵測範圍 ±10°；每頁最多多一次渲染（轉正）

## Constitution Check

| 原則 | 結果 |
|---|---|
| I 純前端 | ✅ 全部在瀏覽器以像素運算完成，不新增網路請求或模型 |
| II 可逆 | ✅ 線條、底色、勾選框、顏色都不是文字，不影響編碼與還原；round-trip 測試維持 |
| III 人工覆核 | ✅ 預覽同步呈現結構，預覽即輸出 |
| IV 規則透明 | ✅ 偵測規則不變 |
| V 簡單 | ✅ 沿用既有掃描與資料結構，不新增依賴 |
| 安全：輸出不殘留敏感資訊 | ✅ 結構都是單一顏色的向量圖形，無法夾帶文字；保留圖片的規則沿用 004 |

**Post-design re-check**：設計完成後再檢查一次，以上各項維持不變。

## Project Structure

```text
specs/005-scan-layout-fidelity/
├── plan.md、research.md、data-model.md、quickstart.md、tasks.md
└── contracts/answer-key.md      # 原稿與評分報表的結構

src/
├── core/types.ts                # PdfRule、PdfFill、PdfCheckbox；PdfItemLayout.color；pdf 版面加上結構
├── formats/
│   ├── layout-scan.ts           # 新增純函式：findRules（含虛線）、findFills、findCheckboxes、textColour、estimateSkew、lineOrientation
│   ├── ocr.ts                   # 轉正與方向、結構擷取、勾選框雜字移除與選項字重讀、以框與直線分段、進度階段
│   └── pdf.ts                   # assemblePdf 傳遞結構與顏色；generatePdf 畫底色→圖片→線條→勾選框→彩色文字；文字寬度以框與直線為界
├── ui/preview.ts                # PDF 頁面加一層 SVG 呈現底色、線條、勾選框；文字套用顏色
└── ui/ocr-overlay.ts            # 階段文字（判斷方向、轉正、辨識、分析版面）

scripts/
├── lib/scan-pages.ts            # 勾選框加 data-checkbox
├── lib/render-scan.ts           # 原稿加上線段、底色、勾選框；支援旋轉影像（90°／180°）
├── make-examples.ts             # 角度樣本 tests/fixtures/scan-angles.pdf 與其原稿
└── eval-ocr.ts                  # 結構與角度指標；--sample main|angles|all

tests/
├── unit/layout-scan.test.ts
└── integration/roundtrip-ocr.test.ts   # 結構寫入輸出、文字 round-trip 不變
```

## Design

- **頁面處理順序**（每頁）：
  1. 渲染；
  2. 方向判斷，必要時轉 90°；
  3. 傾斜偵測：≥ 1° 時以旋轉矩陣重新渲染、在轉正的頁面上辨識；0.1°–1° 時另外渲染一份轉正副本，只用來找版面結構；
  4. 清理副本：加深彩色字、抹除長段（004 的 `removeRules`）與虛線；
  5. 辨識，信心過低時試 180°；
  6. 圖片候選；
  7. 漏字補辨識、第二意見；
  8. 確認保留的圖片；
  9. `findRules`、`findFills`、`findCheckboxes`（在轉正的頁面或副本上，再轉回辨識頁座標）；
  10. 移除框內雜字，重讀被併進框裡的選項字；
  11. 文字分段（勾選框與直線也是界線）與文字顏色；
  12. 輸出 `PdfPage { items（含 color）, pictures, rules, fills, checkboxes }`。
- **座標**：以辨識的頁面為準（≥ 1° 時為轉正後的頁面），換算成 PDF 點（原點左下）。頁面轉 90°／270° 時寬高對調。
- **輸出繪製順序**：底色 → 圖片 → 線條 → 勾選框 → 文字（文字最後，永遠在最上層）。
- **預覽**：每頁加一個 `<svg>`（viewBox 以 pt 為單位、隨頁面縮放），畫底色、線條、勾選框；文字 span 設定 color。保留圖片沿用 004 的切換。
- **評分**：原稿新增 `rules`、`fills`、`checkboxes`。網站預覽以 `data-*` 屬性提供讀到的結構，評分工具從 DOM 取回後比對。

## Complexity Tracking

無違反原則之處。
