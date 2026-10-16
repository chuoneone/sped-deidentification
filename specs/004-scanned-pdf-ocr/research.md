# Research: 圖片型（掃描）PDF 的文字辨識

實測環境：Apple M1 Max、Node 24、tesseract.js 7.0.0、`@tesseract.js-data/*` 1.0.0（`4.0.0_best_int` 模型）。測試頁由 Chrome 以 HTML 排版後截圖產生（A4，含格線表格、中英文混排、號碼與 Email），另做灰階、旋轉 0.5° 與 JPEG 壓縮模擬掃描。

## R1 辨識引擎

- **Decision**: 使用 Tesseract.js 7（WebAssembly 版 Tesseract LSTM），語言 `chi_tra+eng`，PSM 3（自動版面分析）。
- **Rationale**:
  - 唯一成熟、可完全在瀏覽器內執行、支援繁體中文的 OCR 函式庫。
  - 實測一頁 A4 約 1.0–1.2 秒（Node；瀏覽器 WASM 相近），5 頁遠低於 60 秒的目標。
  - PSM 3 會把表格的同一列合成一行、把多欄區塊分開，閱讀順序合理。
- **Alternatives considered**:
  - 雲端 OCR（Google Vision 等）：會把文件送出瀏覽器，違反 constitution I。
  - PaddleOCR + onnxruntime-web：中文較準，但模型與執行環境都大得多，需要自己做前後處理，違反「簡單優先」。
  - 瀏覽器原生 `TextDetector`（Shape Detection API）：只有 Chrome 在旗標後提供，且不支援中文。

## R2 語言模型

- **Decision**: 用 `chi_tra` 加 `eng`，兩者都用 `4.0.0_best_int`（gzip 後分別為 1.66 MB、2.95 MB）。
- **Rationale**: 只用 `chi_tra` 時，`chen.dw@mail.com` 被讀成 `chen.dw@maiLcom`；加上 `eng` 後英文與 Email 都正確。中文、身分證、手機、統編兩種設定都正確。
- **Alternatives considered**: `4.0.0` 完整模型（chi_tra 27 MB）太大；`tessdata_fast` 沒有 npm 套件，要另外下載並提交二進位檔。

## R3 由本站提供程式與模型（零第三方請求）

- **Decision**: 在 `vite.config.ts` 加一個小型 plugin，把下列檔案以固定檔名放到網站的 `ocr/` 目錄：
  - `tesseract.js/dist/worker.min.js`
  - `tesseract.js-core` 的三個 LSTM 變體：`tesseract-core-lstm.wasm.js`、`tesseract-core-simd-lstm.wasm.js`、`tesseract-core-relaxedsimd-lstm.wasm.js`
  - 兩個 `*.traineddata.gz` 模型

  建置時用 `emitFile` 輸出，開發時由 middleware 直接讀 `node_modules`。執行期把 `workerPath`、`corePath`（目錄）、`langPath` 都設成本站的絕對網址。
- **Rationale**:
  - tesseract.js 預設會從 jsDelivr 下載 worker、core 與模型，違反 FR-002／SC-003。
  - `corePath` 給目錄時，tesseract.js 會依瀏覽器支援的 SIMD 自動選擇變體，所以要保留固定檔名；Vite 的 `?url` 會在檔名加 hash，無法使用。
  - 檔案來自 npm 套件、版本隨 `package-lock.json` 鎖定，不用把 17 MB 二進位檔提交進 git。
- **下載量**：瀏覽器只會下載一個 core 變體（3.9 MB）、兩個模型（4.6 MB）和 worker（0.1 MB），合計約 8.6 MB，符合 SC-001 的 10 MB 上限。之後由 HTTP 快取重複使用。
- **Alternatives considered**:
  - 把檔案複製到 `public/`：需提交二進位檔，或另寫 prebuild 腳本並加進 gitignore。
  - 自行 fetch 模型，再以 `{ code, data }` 傳給 worker：仍需處理 worker 與 core 的路徑，沒有比較簡單。

## R4 瀏覽器儲存

- **Decision**: `cacheMethod: 'none'`，模型不寫入 IndexedDB，只靠瀏覽器 HTTP 快取。
- **Rationale**: constitution 規定瀏覽器儲存只能放 pattern 設定。模型雖然不是敏感資料，仍照字面遵守。

## R5 頁面轉圖片

- **Decision**: 用 pdf.js 的 `page.render()` 把每頁畫到 canvas，再交給 Tesseract。
  - 縮放倍率為 `min(3, 4000 / max(寬, 高))`，A4 約 216 DPI，長邊不超過 4000 px 以控制記憶體。
  - 頁面尺寸採用 viewport 的寬高，已套用 `/Rotate`。
  - 每頁辨識完就釋放 canvas。
- **Rationale**: pdfjs-dist 已是既有依賴。實測 200 DPI 的影像辨識正確；150 DPI 時出現「臺導市」「緊急陛絡人」等誤讀。

## R6 辨識結果 → 版面文字段

- **Decision**: 取 Tesseract 的 `blocks → paragraphs → lines → words`，每一行依字距切成「文字段（run）」，每段對應一個 PDF 文字項目（與文字層 PDF 相同的資料結構）。規則如下：
  - **切段**：相鄰兩字的間距大於 1.5 × 行高時切開。表格欄位、表單「欄名｜值」、並排名片因此各自成段。
  - **併字**：兩側都是中日韓字或全形標點時不加空白；其餘情況，間距大於 0.3 × 行高才加空白。Tesseract 對中文常把每個字當成一個 word，若直接用 `line.text`，會產生「王 小 明」之類的空白。
  - **框線雜訊**：先去掉 word 頭尾的 `|｜`；全由框線類符號組成的 word（`| ｜ _ = ~ — –` 等）直接丟棄。實測 200 DPI、旋轉 0.5° 的表格會產生零星的 `|`、`=`。
  - **座標**：x 取段首 word 的 `x0`；y 取該行 baseline 在段首位置的內插值；字級取 `rowAttributes.rowHeight`（實測與實際字級幾乎相同），沒有時改用行框高度；寬度取段首到段尾的距離。全部除以縮放倍率後，換成 PDF 座標（原點在左下）。
  - **順序**：沿用 Tesseract 的閱讀順序，不重新排序。名片頁因此一張一張讀，表格則一列一列讀。
- **Rationale**: 與文字層 PDF 共用同一份版面資料，預覽、輸出、還原都能沿用；表格與多欄內容不會擠成同一行（FR-004）。

## R7 輸出時的文字大小

- **Decision**: 辨識來源的文件在重建 PDF 時，每個文字項目都縮放到「同一行下一段的起點」或右邊界為止。
- **Rationale**: 辨識估出的字級與 Noto Sans TC 的字寬並不完全吻合；替換成較長的標記時，也不能蓋到同一列的下一欄（FR-012）。文字層 PDF 維持現有行為（SC-006）。

## R8 取消

- **Decision**: 使用 `AbortSignal`。
  - 每頁的 render 與 recognize 都和 abort 做 `Promise.race`。
  - abort 時呼叫 `worker.terminate()`，丟出 `AbortError`。
  - 呼叫端遇到 `AbortError` 時跳過該檔，繼續處理下一個。
- **Rationale**: Tesseract 的 recognize 無法中途停止，只能終止整個 worker；終止後未完成的 promise 不會 resolve，所以必須自己 race。

## R9 範例掃描檔的產生

- **Decision**:
  - 在 `scripts/lib/render-scan.ts` 用 puppeteer-core（既有 devDependency）與本機 Chrome，把 5 頁 HTML 版面以 200 DPI 截成 JPEG。
  - 模擬掃描：灰階或彩色、旋轉 0.2–0.4°、紙張底色與輕微雜訊。
  - 用 pdf-lib 把影像鋪滿 A4 頁面，不加任何文字層。
  - 字體在 macOS 上優先使用系統字（宋體、楷體、蘋方）來呈現不同版式，沒有時退回 Noto Sans TC。
- **Rationale**:
  - 現有範例都由腳本以固定亂數種子產生；`make-screenshots`、`make-og` 已經依賴本機 Chrome。
  - 以 HTML 排版，最容易做出擬真的表格、表單與名片。
- **Alternatives considered**: Node 端用 pdf.js 加 canvas 轉圖，需要新增原生套件 `canvas`。

## R10 測試策略

- 單元測試 `ocrLinesToItems`：用從真實辨識輸出擷取的行與字資料（存成 fixture JSON），驗證切段、中文併字、框線過濾與座標換算。
- 整合測試：fixture → 組成 `LoadedDocument` → 偵測 → `generatePdf` → `parsePdf` → 還原，驗證文字一致（忽略空白，與既有 PDF round-trip 相同）、輸出不含影像、相鄰段不重疊。
- 真正的瀏覽器辨識（canvas＋WASM）無法在 vitest（jsdom）中執行，以 quickstart 的端對端步驟驗證：載入範例、確認進度畫面、測試取消、檢查網路請求、還原。

## R11 提升辨識率的演算法（修訂 2026-10-16）

以 `npm run build` 後的網站實際流程量測（在 Node 跑同一份 PNG 的結果會比瀏覽器高約 6%，所以一律以瀏覽器為準），逐項保留有效的：

| 步驟 | 作法 | 效果 |
|---|---|---|
| 框線移除 `removeRules` | 長度超過頁寬 5%（至少 80 px）的水平／垂直深色連續像素與其旁邊一列抹白；字的筆畫遠短於此 | 「|」「=」等雜訊消失，貼著框線的號碼不再被讀錯 |
| 彩色字加深 `deepenColour` | 灰階 = 亮度 − ½ 彩度：橘、綠、藍字變深；淡黃螢光筆仍淺；黑白內容不變 | 藍筆手寫 7→9/12；彩色名片公司名可讀 |
| 字形校正 `fixConfusables` | 8–14 字元、六成以上是數字的字串，把 I/l/O/D/Q/S/Z/B/g/q/G 讀成數字；結果須通過身分證或統編檢核碼，或符合手機／市話格式才採用，長度不變 | DI32062529→D132062529、0g78-…→0978-… |
| 第二意見 | 信心值低於 70 的英數字詞，以純中文模型（單行模式）在原倍率與放大 2 倍各讀一次；結果全為中文時只要更有信心就採用，英數結果須高 10 分 | 窄欄姓名被讀成 ERE、FL、RARE 時改回范思華、王士軒、宋宏軒；印刷 84.7%→94.4% |
| 不採用 | 依掃描原解析度渲染（避免重新取樣）；擴大第二意見到低信心中文字、門檻 85 | 前者 Node 實驗反而變差，後者沒有改善且多 2 秒 |

## R12 保留不含文字的圖片（修訂 2026-10-16）

- Tesseract 的 blocks 只回傳文字區塊，沒有圖片區域，所以自行偵測：以 12 px 格子計算「明顯比紙色深或彩度高」的覆蓋率，連通成區塊，取面積 ≥ 頁面 0.15%、每邊 ≥ 4 格、長寬比 ≤ 6、填滿率 ≥ 0.35 者（照片 0.99、標誌 0.59、印章 0.19）。
- 區塊沿淡色像素外擴最多 4 格（補回標誌淺色部分與照片外框），碰到任何不屬於它的文字就停止。
- 含文字判定 `holdsText`：區塊內有信心值 ≥ 80 的英數／中文字、跨越邊界的字，或 3 個以上信心值 ≥ 60 的字詞 → 視為含文字，不保留。照片的雜訊字信心值實測最高約 71，真實印刷與手寫在 85 以上。
- 對候選區再以稀疏文字模式（PSM 11）單獨辨識一次，作為第二道防線；印章因填滿率低在第一關就排除。
- 圖片候選要在「第二意見」之前找出，否則標誌的誤讀字（「0」）會被中文模型改讀成高信心的字而誤判含文字。
- 保留的圖片從未經處理的原頁面裁切為 JPEG（品質 0.9），以原位置與尺寸繪入輸出 PDF；落在圖片內的誤讀字從文字中移除。

## R13 漏字補辨識與號碼重接（修訂 2026-10-16 續）

- **漏字補辨識 `uncoveredText`**：Tesseract 的版面分析會整行略過某些文字（與照片並排的「董事長　廖宜婷」、大字加字距的名片姓名「簡　柔」）。在清理後的頁面上以 8 px 格子找出「有墨跡、但沒有任何信心 ≥ 30 的辨識字覆蓋」的區域，水平 3 格、垂直 1 格內相連視為同一行；只取高 16–200 px、寬 ≥ 32 px、寬至少為高 1.8 倍的行狀區域，最多 12 個。方正的印章字距大、不成行，不會被選到，避免把拆散的公司名當文字帶出。每個區域以單一區塊模式（PSM 6）單獨辨識：整行至少一字信心 ≥ 60 才採用，行內中文字全數保留、英數字信心 ≥ 30 才保留；新字只在比其下方原有字更有信心時才取代原字。補辨識在「第二意見」之前執行，補回的英數誤讀（董事長→HEHE）也會由中文模型重讀。
- **門檻取捨**：覆蓋門檻 50 時會換掉一些低信心但正確的原字（Email 被讀成 `…50! @…`），30 時印刷 138／手寫 9，40、50 時印刷 137／手寫 10；選 30（對原辨識結果的改動最少）。
- **號碼重接**：Tesseract 有時把一串號碼切成兩個字詞（`0918-1` `54-331`）；兩段都是數字或連字號、間距小於 0.2 倍行高時直接相連，正常的空白（`0955 888 777`）仍保留。
- **偵測器**：姓名規則把職稱「工程師」誤判為「程師」；`NAME_STOPLIST` 加入「程師」，並讓驗證失敗的比對只跳過被拒的兩個字後繼續掃描，否則「工程師程大偉」中真正的姓名會一起被跳過。

## R14 對答案用的原稿與評分（修訂 2026-10-16 續）

- **原稿**：`npm run examples` 產生掃描範例時，從同一份 HTML 擷取各頁 `innerText`（表格一列一行、欄以 Tab 分隔）與圖片位置，連同 `scanPages()` 的 `planted`／`handwritten`／`manual` 寫入 `tests/fixtures/scanned-sample.answer.json`。原稿與影像出自同一來源，不會對不上；重新產生範例時一起更新。
- **評分** `npm run eval:ocr`：上傳範例到建置後的網站（真實瀏覽器流程），由預覽取回每頁辨識出的原文（標記以 tooltip 中的原文還原）、偵測值與保留圖片，逐頁計算：
  - 字元召回／精確率：以字元多重集合比對，不計順序（表格可能被逐欄讀取），比對前做 NFKC，使全形「：」與辨識出的「:」視為相同；
  - 個資：印刷值與手寫值命中；不在原稿中的偵測值再分成「讀錯仍遮蔽」（同類別、與某筆漏抓值只差約兩成字元）與「誤判」；
  - 圖片：與原稿位置 IoU ≥ 0.5 視為保留正確，另列多保留的張數。
- **整合測試**改讀同一份原稿，並新增「全頁字元召回率 ≥ 95%」的回歸檢查（Node 版 Tesseract）。
- **目前基準**（M1 Max、Chrome）：字元召回 98.8%、精確 99.1%；印刷值 138/144、手寫值 9/12；讀錯仍遮蔽 7、誤判 2（「曹冠君」把敬稱併入、斷行造成的「股份有限公司」）；圖片 4/4；19 秒。
- 評分揭露的姓名規則誤判「簡訊口」「向本」已加入停用詞（`簡訊`、`向本`）。
