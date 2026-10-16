# Contract: 辨識程式與模型的部署

建置後的 `dist/ocr/` 目錄必須包含以下檔案，檔名固定、不加 hash。開發伺服器以相同路徑提供。

| 路徑 | 來源 | 大小（約） |
|---|---|---|
| `ocr/worker.min.js` | `tesseract.js/dist/worker.min.js` | 0.1 MB |
| `ocr/core/tesseract-core-lstm.wasm.js` | `tesseract.js-core` | 3.9 MB |
| `ocr/core/tesseract-core-simd-lstm.wasm.js` | `tesseract.js-core` | 3.9 MB |
| `ocr/core/tesseract-core-relaxedsimd-lstm.wasm.js` | `tesseract.js-core` | 3.9 MB |
| `ocr/lang/chi_tra.traineddata.gz` | `@tesseract.js-data/chi_tra/4.0.0_best_int` | 1.7 MB |
| `ocr/lang/eng.traineddata.gz` | `@tesseract.js-data/eng/4.0.0_best_int` | 3.0 MB |

## 執行期設定

`createWorker('chi_tra+eng', OEM.LSTM_ONLY, options)` 的 `options` 如下，所有 URL 都以 `document.baseURI` 解析成絕對網址，因為 worker 以 blob URL 啟動，無法解析相對路徑：

- `workerPath`：`<site>/ocr/worker.min.js`
- `corePath`：`<site>/ocr/core/`（目錄，由 tesseract.js 依 SIMD 支援選擇變體）
- `langPath`：`<site>/ocr/lang`
- `cacheMethod`：`'none'`

## 保證

- 辨識過程的所有網路請求都指向本站同源網址（SC-003）。
- 一般檔案（非圖片型 PDF）不會請求 `ocr/` 底下的任何檔案（FR-010）。
