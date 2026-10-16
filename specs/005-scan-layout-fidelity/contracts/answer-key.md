# Contract: 原稿與評分報表

## 原稿檔

- `tests/fixtures/scanned-sample.answer.json`：網站範例（5 頁），`source: public/samples/scanned.pdf`。
- `tests/fixtures/scan-angles.answer.json`：角度樣本，`source: tests/fixtures/scan-angles.pdf`，頁面依序為信函 3°、信函 6°、表單 3°、表單 6°、信函 90°、信函 180°。

每頁：`title, text, planted, handwritten, manual, pictures, rules, fills, checkboxes, rotation?`（見 data-model）。

## 網站預覽提供給評分的屬性

每個 `.pdf-page` 內的 `svg.pdf-structure`：
- `line[data-rule]`、`rect[data-fill]`、`g[data-checkbox]`；
- 以 `data-*` 帶 pt 座標，例如 `data-rule="x1,y1,x2,y2"`、`data-fill="x,y,w,h,r,g,b"`、`data-checkbox="x,y,size,1|0"`。

## 評分報表（`npm run eval:ocr`，`--sample main|angles|all`，預設 all）

主範例逐頁：字元召回／精確、印刷值、手寫值、讀錯仍遮蔽、誤判、圖片、線段召回／精確、底色命中、勾選框（找到／狀態正確／原稿數）。

角度樣本逐頁：角度、字元召回、印刷值命中、線段召回、勾選框。

`--json` 輸出相同內容。
