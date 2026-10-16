# Data Model: 掃描 PDF 輸出的版面還原

所有座標為 PDF 點（pt），原點在左下，以辨識的頁面為準（傾斜 ≥ 1° 時為轉正後的頁面；更輕微的傾斜保留原樣，結構座標也跟著轉回）。

| 型別 | 欄位 | 說明 |
|---|---|---|
| `PdfRule` | `x1, y1, x2, y2, width, color, dashed?` | 水平或垂直線段（輕微傾斜的頁面上會略帶斜度）；`color` 為 `[r, g, b]`（0–255） |
| `PdfFill` | `x, y, width, height, color` | 底色矩形，畫在文字與線條之下 |
| `PdfCheckbox` | `x, y, size, checked, color` | 方框左下角、邊長、是否勾選 |
| `PdfTextItem.color?` | `[r, g, b]` | 該段文字的代表色；沒有時為黑色 |

- `PdfPage` 新增 `rules?`、`fills?`、`checkboxes?`；`layout.pages[i]` 帶相同物件供預覽使用，`PdfItemLayout` 新增 `color?`。
- 結構不是文字：不參與偵測、編碼、還原；`generatePdf` 只負責繪製。

## 原稿（`tests/fixtures/*.answer.json`）新增欄位

| 欄位 | 說明 |
|---|---|
| `rules: { x1, y1, x2, y2, dashed }[]` | 由 DOM 邊框與細色條推得（在轉正後的頁面座標） |
| `fills: { x, y, width, height, color }[]` | 非白色、非整頁的底色 |
| `checkboxes: { x, y, size, checked }[]` | 由 `data-checkbox` 取得 |
| `rotation?` | 角度樣本頁的傾斜或轉向（僅供報表標示） |
