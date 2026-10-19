# Quickstart: 到期與補簽驗收

本文件為已交付後端的驗證指南；實際驗證結果如下，前端正式串接仍另行交付。欄位與 HTTP 結果見 [契約](contracts/http-api.md)，資料限制見 [資料模型](data-model.md)。

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

## Ticket 02 交付紀錄（2026-10-19）

- 單元：91 suites／738 tests 通過；新 DTO／service／worker 測試採先紅後綠，DB HTTP 先確認端點 404 再完成實作。
- HTTP／DB／queue／API coverage：10 suites／74 tests 通過（排除獨立執行的 6,000 人 scale suite）；最後涉及 worker／新簽章鏈驗證的 core 與 queue 再驗 2 suites／13 tests 通過。
- 安全性：6 suites／25 tests 通過。補簽特定的 401／403／404、未知欄位、內部原因裁切、舊 cookie/token 與 no-store/no-referrer 另外集中於 core HTTP 整合測試。
- Schema：2 suites／5 tests 通過，涵蓋 up/down/up、無 drift、expired/reopened 回滾拒絕。
- server build 與 lint:check 通過（0 errors，既有及測試型別 warnings 仍存在）；git diff --check 通過。

SC-001 由截止、延遲 worker 與並發到期測試覆蓋；SC-002 由既有已簽者＋內部未簽＋外部未簽的兩輪補簽至 completed、原 snapshot/evidence/副本 bytes 比對覆蓋；SC-003 由授權、輸入、不可補簽狀態與完整性驗證覆蓋；SC-004 由同輪並發、跨輪重送、expiry／stop 競態、資料庫回滾與舊郵件 claim 回寫覆蓋；SC-005 由多輪歷程、新舊資格與新舊簽章公開驗證覆蓋；SC-006 由摘要／清單／signer 歷程的精確欄位斷言覆蓋。

本輪測試以既有 `.env.test` 配合命令環境覆寫 `DB_MYSQL_DB=feastogether_intranet_test_spec007_reopen`、`REDIS_DB=15` 隔離，不修改設定檔。Schema helper 會附加 UUID，改用較短 `feastogether_intranet_test007` 前綴，避免 MySQL 64 字識別字上限；所有測試仍維持 feastogether_intranet_test 前綴的 fail-closed 保護。合成測試資料依 fixture 清理；未操作正式資料。

後端與 migration/config：補簽與外部手動邀請已交付，migration 僅 ticket 01 的 status CHECK；無新 dependency/config。前端：未修改 client，正式 API 接線與完整產品 UI 驗收由獨立 PR 交付。部署／回滾順序同上，本次沒有部署。

## 整合補充驗證與審查（2026-10-19）

- 既有 6,000 人規模 e2e 在 ticket 01 整合版本通過：6,001 人可發起，6,000 人各自簽署、產製個人副本並結案；測試共約 1,051 秒，簽署約 331 秒、產製約 702 秒。此測試針對已到期相容性所影響的既有副本路徑；ticket 02 的補簽、外部邀請與 queue 則由前述完整套件驗證。
- 以 `b9ae324` 為固定基準進行雙軸 code-review：規格符合性 0 項問題；程式規範 0 項硬性違規，另有 1 項 worker claim 回寫檢查重複的維護性建議，於獨立 review commit 收斂。
- 本機兩張 tickets 均已驗收並整合。PR #13 交付已到期；PR #14 疊在 #13 上交付重新開放補簽。未合併遠端 PR、未部署。
