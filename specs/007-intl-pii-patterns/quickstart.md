# Quickstart: 驗證英文與國際格式的個資偵測

```bash
npm install
npm test
npm run build && npm run preview
```

1. 開啟網站，在「去識別化」貼上 tests/fixtures/english-sample.txt 的內容，按「開始去識別化」：電話、信用卡、SSN、IBAN、IP、出生日期都被標記，訂單編號、金額、日期、版本號沒有被標記。
2. 「調整輸出方式」選部分保留：信用卡只露出末 4 碼、生日只露出年份、國際電話只露出國碼。
3. 「偵測規則」頁：看到 7 條新規則，可以停用。
4. 下載文件與編碼表，到「還原」頁還原，內容與原文相同。
