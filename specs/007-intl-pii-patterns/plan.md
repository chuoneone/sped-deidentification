# Implementation Plan: 英文與國際格式的個資偵測（第一層：規則與檢核碼）

**Branch**: `007-intl-pii-patterns` | **Date**: 2026-10-16 | **Spec**: [spec.md](spec.md)

## Summary

新增 6 個類別（國際電話、信用卡、SSN、IBAN、IP、生日）與 7 條內建規則：

- 每條規則都是可在「偵測規則」頁檢視的正規表達式，再以檢核函式過濾（號碼有效性、Luhn、號碼段、mod-97、位址範圍、日期）。
- 電話有效性交給 libphonenumber-js。
- 檢核函式可回傳「接受的長度」，修剪過長的比對。
- 各類別加上部分保留的標準切分與標記顏色。
- 台灣市話規則擴充 +886 寫法。
- 以英文樣本與命中／不命中測試驗證；README 同步更新。

## Technical Context

**Language/Version**: TypeScript（既有）、Vite 8

**Primary Dependencies**: 新增 `libphonenumber-js`（MIT），理由見 research R1；其餘不變

**Storage**: 無；規則的啟用狀態沿用既有的規則設定儲存

**Testing**:
- Vitest：每條規則的命中與不命中（contracts/patterns.md）；
- 各類別的部分保留；
- 英文樣本的完整性與零誤判；
- 既有測試不退步。

**Target Platform**: 現代瀏覽器、純靜態部署

**Project Type**: 單一前端專案

**Performance Goals**: 網站首次載入增加 ≤ 40KB（壓縮後）

**Constraints**: 既有中文類別的偵測結果不變；所有偵測在瀏覽器內完成

**Scale/Scope**: 7 條規則、6 個類別

## Constitution Check

| 原則 | 結果 |
|---|---|
| I 純前端 | ✅ 函式庫與號碼規則資料都打包進網站，不連網 |
| II 可逆 | ✅ 新類別與既有類別走同一套編碼與還原 |
| III 人工覆核 | ✅ 偵測結果照常可取消、可手動新增 |
| IV 規則透明 | ✅ 每條規則都是可檢視、可停用的正規表達式；檢核方式寫在規則說明中 |
| V 簡單 | ✅ 新增一個依賴：全球電話號碼規則無法手寫維護（R1）；其餘以既有架構擴充 |
| Development Workflow | ✅ 每條規則都有命中與不命中的測試樣本 |

**Post-design re-check**：各項維持通過。

## Project Structure

```text
specs/007-intl-pii-patterns/
├── plan.md、research.md、data-model.md、quickstart.md、tasks.md
└── contracts/patterns.md

src/core/
├── types.ts        # CATEGORIES 新增 6 類；Pattern.validate 可回傳接受的長度
├── patterns.ts     # 7 條新規則；tw-landline 擴充 +886
├── intl.ts         # 新增：電話、信用卡、SSN、IBAN、IPv6、日期的檢核函式
├── detector.ts     # 依檢核函式回傳的長度修剪比對
└── retention.ts    # 新類別的部分保留標準切分
src/styles.css      # 新類別的標記顏色

tests/
├── fixtures/english-sample.txt
├── unit/patterns-intl.test.ts       # 命中／不命中、部分保留
└── integration/english-sample.test.ts  # 樣本完整性、零誤判、還原
```

**Structure Decision**: 檢核函式集中在新的 `core/intl.ts`，與台灣格式的 `core/twid.ts` 並列。

## Design

- **偵測流程**：
  1. 既有流程不變，每條規則先以正規表達式比對；
  2. 檢核函式回傳 `true`／`false`／接受的長度；
  3. 重疊時仍是較長者優先，同長時排在前面的規則優先。新規則排在台灣規則之後，所以 +886 手機仍歸「手機」。
- **類別順序**：新類別接在既有類別後面，類別表與規則頁的選單依此排序。

## Complexity Tracking

| 項目 | 理由 |
|---|---|
| 新增依賴 libphonenumber-js | 全球電話號碼的長度與號段規則需要持續更新的資料，手寫不可行；只用於驗證，不改變規則透明度 |
