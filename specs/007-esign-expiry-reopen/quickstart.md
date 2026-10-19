# Quickstart: 到期與補簽驗收

本文件為實作後驗證指南；目前只有規劃文件，以下功能尚未實作、測試尚未執行。欄位與 HTTP 結果見 [契約](contracts/http-api.md)，資料限制見 [資料模型](data-model.md)。

## 前置條件

- 使用 pnpm 與專案既有 Node 環境、MySQL、Redis、私有檔案儲存設定；只依 .env.example 準備設定，不提交實際 secret。
- e2e 使用 `.env.test`，DB 名稱必須以 `feastogether_intranet_test` 開頭。不得對正式資料執行時間操弄、migration 回滾或憑證測試。
- 測試使用合成 PDF、姓名與 Email。準備建立人 A、簽署人 B、無關員工 C，以及外部簽署人 E。
- 依既有開發流程安裝並啟動：`pnpm install`、`pnpm dev`。migration 使用專案既有測試初始化／部署流程；先檢查目標環境，勿把預設 .env 的 migration 指令當測試指令執行。

## 自動驗證指令（實作後）

```bash
pnpm -C server lint:check
pnpm -C server test --runInBand
pnpm -C server build
pnpm -C server test:schema
pnpm -C server test:e2e
pnpm -C server test:e2e:security
```

前端獨立 PR 再執行 `pnpm -C client lint`、`pnpm -C client build`；跨 package 實作再執行 root `pnpm lint`、`pnpm build`。client 沒有 test script，不宣稱有自動測試。

## 驗收情境

1. **到期及延遲 worker（FR-001、002、014）**：發起含已簽與未簽人的文件，停止測試 worker 並跨越期限。列表、expired 篩選及內部待簽顯示已到期；截止當下與之後提交均被拒絕。GET 前後 DB/audit 無寫入。重啟 worker 只追加一次 document.expired，不產生 stopped_by_deadline。
2. **補簽兩輪（FR-003–007）**：A 使用契約 POST 新期限與原因；立即取得 active、新期限與補簽標記。再到期，再開放一次；原始期限、payload hash、簽名與副本均不變，兩輪歷程可追溯。B/E 最後完成後先 finalizing，待副本 ready 後 completed。
3. **權限與驗證（FR-003、004、013、017）**：未登入、C、空白原因、501 字原因、缺漏／非法／非未來期限、未到期與各不可補簽狀態均符合契約錯誤；資料不變。另驗證 500 個 Unicode 字元不被稽核截斷。
4. **重送與競態（FR-011、012）**：真實 DB 上同時送兩個相同 expectedSignEndAt，僅一次成功；第二輪到期時重送第一輪要求仍 409。模擬提交成功但回應遺失，查詢可確認成功且再送不新增事件。並發執行補簽／worker／停止／最後簽署，結果符合鎖順序與截止邊界；注入交易失敗，狀態、邀請與稽核皆回滾。
5. **外部邀請（FR-009、010）**：補簽前保存舊邀請及已開啟的 cookie；補簽後均無法取得資格。A 主動 GET 新連結，重讀取得相同有效連結；E 可在新期限內簽署。一般詳情、簽署人資料、log 與錯誤不含 token。補簽新增通知 batch/log/queue job 數為 0。
6. **舊通知工作（FR-009–012）**：預置 pending、failed 與 processing 的舊通知；補簽後它們為 terminal superseded，scanner/claim 不寄出新 token。模擬舊郵件已在傳送，完成／失敗回寫不可清新密文或恢復舊 lease；送達的舊連結仍無效。新輪 invitationDelivery=null。
7. **證據與副本（FR-006、015）**：已簽者的副本尚未產製時讓其他人逾期；副本仍可產製／下載，既有簽章驗證維持有效。補簽後重新驗證原始 payload hash 與所有原有稽核鏈前綴，變更數為 0。以假時鐘驗證昂貴處理跨截止時不能新增逾期簽署。
8. **資料裁切（FR-008、014、017）**：A 可讀前後期限、原因、操作者；B/E 不可見補簽原因與設定人。外部已到期連結無法取得內部詳情。可用內部待簽列表辨識等待補簽。
9. **停止與遷移（FR-013、016）**：A 可停止 expired；新舊 stopped 均不能補簽。migration 前後舊文件、payload 與歷程不變。無新功能資料庫測試 up/down/up；存在 expired 或 reopened 歷程時 down 明確拒絕，資料不變。

## 部署與交付記錄

先協調停止舊 expiry worker，再更新 schema、HTTP 與 worker；不可混跑舊到期永久停止邏輯。測試與交付報告記錄前端、後端、migration/config 各自進度，不把 API 通過視為前端完成。

本功能不新增環境變數、依賴或排程，不需要修改 .env.example。保留未執行項目與原因；正式串接完成後再驗收對話框、日期顯示、衝突提示、待簽狀態與手動複製邀請。

## Ticket 01 交付紀錄（2026-10-19）

已完成已到期狀態、讀取／篩選、截止與合法重送、到期稽核、已簽個人副本及人工停止。補簽 API／邀請更新由 ticket 02 續作，前端正式串接仍未交付。

驗證：server 單元 89 suites／710 tests、core HTTP/DB 11 tests、core security 7 tests、schema 2 suites／5 tests、build、lint:check 均通過；lint 有既存 warnings、無 errors。完整 e2e/security 套件留待整合驗證。101 筆到期批次、截止當下與 GET 不寫資料、並發只一次事件、證據不變與 expired 副本下載皆有真實 DB 驗收。
