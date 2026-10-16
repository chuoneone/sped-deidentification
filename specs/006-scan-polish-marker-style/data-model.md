# Data Model: 標記方式與掃描排版

## MarkerStyle（新增）

| 值 | 隱藏部分的呈現 | 編碼表 | 可還原 |
|---|---|---|---|
| `code`（預設） | `[類別:編碼]` | 產生 | 是 |
| `label` | `[類別]` | 不產生 | 否 |
| `blank` | 每個文字或數字 →「○」，其他字元保留 | 不產生 | 否 |

- 整批文件共用一個設定，存在處理頁的記憶體狀態中，不寫入瀏覽器儲存空間。
- 與既有 `Retention`（輸出方式）獨立：輸出 = 保留前段 ＋ 依 MarkerStyle 呈現的隱藏部分 ＋ 保留後段。
- 範例（輸出方式 × 標記方式）：

  | 原文 | 部分保留＋編碼 | 部分保留＋類別 | 部分保留＋空白 | 全部隱藏＋空白 |
  |---|---|---|---|---|
  | 王小明 | 王[姓名:6e679d] | 王[姓名] | 王○○ | ○○○ |
  | 0912-345-678 | 0912-[手機:1a2b3c] | 0912-[手機] | 0912-○○○-○○○ | ○○○○-○○○-○○○ |
  | amy.chen@gmail.com | [電子郵件:…]@gmail.com | [電子郵件]@gmail.com | ○○○.○○○○@gmail.com | ○○○.○○○○@○○○○○.○○○ |

## 函式介面（core/redactor.ts）

- `outputFor(item, style = 'code')`、`previewLabel(item, style = 'code')`、`buildEdits(items, style = 'code')`、`applyRedactions(text, items, style = 'code')`：多一個標記方式參數，預設值維持現行行為。
- `applyRedactions(..., 'label' | 'blank')` 的 `mapping` 為空陣列。
- `formats/batch.ts` 的 `buildArchive(entries, merged?, style = 'code')`：不需還原時不寫入編碼表，清單不含編碼表欄。

## 掃描文字段（PdfTextItem，既有）

- `fontSize`：含中文的段落改以中文字框高度推算；同頁上下相鄰、水平重疊的兩段，字級合計不超過基線距離。
