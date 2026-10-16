# Data Model: 圖片型（掃描）PDF 的文字辨識

只延伸既有型別，不新增持久化資料。

## LoadedDocument（延伸）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `ocr` | `boolean?` | 文字由辨識產生時為 `true`。影響工具列標籤、格式限制說明，以及輸出時的字級縮放規則。 |

`layout` 仍為 `{ kind: 'pdf', pages }`。預覽看不出內容來源，也不需要知道。

## PdfPicture（`core/types.ts`，修訂 2026-10-16）

掃描頁中不含文字、保留在輸出的圖片。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `x`, `y`, `width`, `height` | number | PDF 座標（pt），原點左下 |
| `jpeg` | Uint8Array | 從原頁面裁切的影像 |
| `keep` | boolean | 預覽中可切換；`false` 時輸出不含此圖，切換即視為文件變更 |

`PdfPage.pictures?: PdfPicture[]`，並以同一個物件出現在 `layout.pages[i].pictures`，讓預覽與輸出讀到相同的 `keep`。

## RawItem／RawPage（`formats/pdf.ts` 內部）

文字層與 OCR 共用的組字輸入。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `text` | string | 文字段內容，可以是空字串（例如 pdf.js 的純換行項目）。 |
| `x`, `y` | number | PDF 座標，原點在左下；`y` 為 baseline。 |
| `fontSize` | number | 字級（pt）。 |
| `width` | number | 原始寬度（pt）。 |
| `eol` | boolean? | 此項目之後換行（pdf.js 的 `hasEOL`）；OCR 不使用。 |

RawPage = `{ width, height, items: RawItem[] }`。

## OcrLine／OcrWord（`formats/ocr.ts` 輸入，對應 Tesseract 輸出的子集）

| 型別 | 欄位 |
|---|---|
| OcrWord | `text`、`confidence`、`bbox {x0,y0,x1,y1}`（canvas 像素） |
| OcrLine | `words: OcrWord[]`、`bbox`、`baseline {x0,y0,x1,y1}`、`rowAttributes?.rowHeight` |

### 轉換規則 `ocrLinesToItems(lines, scale, pageHeight) → RawItem[]`

1. 清理每個 word：去掉頭尾的 `|｜`；清理後為空、或全部由框線類符號組成的 word 直接丟棄。
2. 計算行高 `h = rowHeight ?? (bbox.y1 − bbox.y0)`。
3. 逐字分段：兩字間距 `gap = b.x0 − a.x1`，大於 `1.5h` 就開新段。
4. 段內併字：
   - 兩側都是中日韓字或全形標點時不加空白；
   - 否則 `gap > 0.3h` 才加一個空白。
5. 座標換算：
   - `x = 段首.x0 / scale`
   - `y = pageHeight − baselineY(段首.x0) / scale`
   - `fontSize = h / scale`
   - `width = (段尾.x1 − 段首.x0) / scale`

## OcrProgress（UI 暫態，不保存）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `stage` | `'engine' \| 'recognize'` | 準備辨識引擎（下載與初始化）／辨識中 |
| `page` | number | 目前頁（從 1 起算）；`engine` 階段為 0 |
| `pages` | number | 總頁數 |
| `progress` | number | 整體進度 0–1 |
| `thumbnail` | string? | 目前頁縮圖（data URL，寬 160px），只存在於畫面上 |

## 狀態轉換（每個檔案）

```
讀檔 ─┬─ 有文字層 ───────────────────────────────→ 加入清單
      └─ 無文字層 → engine → recognize(1..N) ─┬─ 有文字 → 加入清單（ocr = true）
                         │                    └─ 無文字 → 錯誤「未辨識到任何文字」
                         └─ 取消（任何時點）→ terminate → 不加入，繼續下一個檔案
```
