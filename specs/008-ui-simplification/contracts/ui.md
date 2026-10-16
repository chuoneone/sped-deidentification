# Contract: 介面結構（測試與截圖使用的選擇器）

## 去識別化頁

- `.output-panel`（details）＞`.output-panel-summary`（不變）
- `.output-rows`：兩列，`.output-row[data-row=keep]`、`.output-row[data-row=marker]`
  - 每列含 `input[name=output-mode]`／`input[name=marker-style]`（值不變）與 `.output-row-note`
- `.output-notice`：合併後的提醒（沒有提醒時不出現）
- `details.by-category`：類別表（`.output-table` 不變）
- `details.code-advanced`：編碼範圍（`.code-scope` 不變），只在編碼時出現
- `.status-line`：`.status-mode`、`.status-info`（格式限制）、`.status-partial`（含部分保留）

## 偵測規則頁

- `.rule-group[data-group=tw|intl|custom]`（details）＞`summary` 含 `.group-toggle`（checkbox）與規則數
- `.rule-row[data-id=<pattern id>]`：`input.rule-toggle`、`.rule-name`、`.badge-<類別>`、`.rule-example`、`button.rule-more`
- `.rule-detail`：完整比對規則 `code.regex`、檢核說明、預設保留、來源；自訂規則含「編輯」「刪除」
- `button.add-rule`：打開 `.form-card`（新增／編輯表單，含「取消」）
