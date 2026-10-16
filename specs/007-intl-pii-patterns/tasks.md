# Tasks: 英文與國際格式的個資偵測（第一層：規則與檢核碼）

**Input**: `specs/007-intl-pii-patterns/` 的 plan、spec、research、data-model、contracts、quickstart

**Tests**: 憲章要求每條偵測規則都有命中與不命中的測試樣本，以及 round-trip 自動化測試。

## Phase 1: Setup

- [X] T001 安裝 `libphonenumber-js`（package.json、package-lock.json），記錄建置後首次載入的 JS 大小（壓縮前後）作為基準

## Phase 2: Foundational

- [X] T002 src/core/types.ts：`CATEGORIES` 新增 國際電話、信用卡、SSN、IBAN、IP、生日；`Pattern.validate` 可回傳接受的長度
- [X] T003 src/core/detector.ts：檢核函式回傳數字時只保留開頭這麼多字元，並從其後繼續比對
- [X] T004 src/styles.css：6 個新類別的標記與徽章顏色

## Phase 3: User Story 1 — 電話、卡號、帳號、IP（P1）

- [X] T005 [P] [US1] tests/unit/patterns-intl.test.ts：依 contracts/patterns.md 撰寫國際電話、信用卡、SSN、IBAN、IPv4、IPv6、+886 市話的命中與不命中測試
- [X] T006 [US1] src/core/intl.ts：電話（libphonenumber-js、排除 +886、逐組修剪）、信用卡（Luhn、號段、分組格式）、SSN（號碼段）、IBAN（mod-97、國別長度修剪）、IPv6（網址解析器）的檢核函式
- [X] T007 [US1] src/core/patterns.ts：新增 intl-phone、credit-card、us-ssn、iban、ipv4、ipv6 規則（排在台灣規則之後）；tw-landline 擴充 +886

## Phase 4: User Story 2 — 出生日期（P1）

- [X] T008 [P] [US2] tests/unit/patterns-intl.test.ts：出生日期的命中（英文與中文標籤、各日期格式）與不命中（無標籤、無效日期）
- [X] T009 [US2] src/core/patterns.ts＋intl.ts：dob 規則（標籤＋日期）與月日檢核

## Phase 5: User Story 3 — 部分保留與規則透明（P2）

- [X] T010 [P] [US3] tests/unit/patterns-intl.test.ts：各新類別的部分保留輸出（信用卡末 4 碼、生日年份、國際電話國碼、IBAN 國別碼、IP 前兩段、SSN 全隱藏）
- [X] T011 [US3] src/core/retention.ts：新類別的 `standardSplit`
- [X] T012 [US3] 確認偵測規則頁列出新規則並可停用（tests/unit/patterns-view.test.ts 補案例）

## Phase 6: Polish

- [X] T013 tests/fixtures/english-sample.txt 與 tests/integration/english-sample.test.ts：所有新類別完整偵測、一般數字零誤判、三種標記方式輸出、以編碼表還原一致
- [X] T014 `npm test`、`npm run build`；確認首次載入增加 ≤ 40KB（壓縮後）；中文真實案例測試不退步
- [X] T015 瀏覽器端對端：貼上英文樣本，檢查預覽、部分保留、規則頁、下載與還原
- [X] T016 README、index.html、public/llms.txt：新支援的國際個資類別、部分保留方式與限制（英文姓名、地址尚未支援）

## Dependencies

- T001 → T006（函式庫）；T002 → T003、T007、T009、T011。
- US1、US2 修改同一個 patterns.ts，依序進行；測試（T005、T008、T010）可先寫。
- Polish 最後。

## Implementation Strategy

先完成 Setup 與 Foundational，再依序做 US1（最常見的國際個資）、US2（出生日期）、US3（部分保留），每一步都以單元測試驗證；最後以英文樣本做整合驗證並更新文件。
