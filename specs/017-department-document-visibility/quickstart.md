# Quickstart: 部門可見與匯出驗收

此為未來實作後的驗證指南，不代表目前功能已完成。現有程式仍是 role=created 列表。

## 前置條件

- 使用 pnpm、既有 Node 版本、MySQL／Redis 與本機隔離檔案儲存。
- 按 server/.env.example 建立本機測試設定；測試 DB 名稱必須以 feastogether_intranet_test 開頭，不可使用 UAT／正式 DB。
- 本輪先前 E2E 曾因 MySQL 驗證失敗而中止；執行前先修正自己的測試環境，不跳過 DB 名保護。
- 建立合成帳號：A1、A2 同屬部門 A，B1 屬部門 B，N1 無部門代碼；另準備內部跨部門指定簽署人與外部 Email 簽署人。
- 使用既有正式登入的本機測試 stub／fixture，不將真實員工資料或 cookie 提交至 repo。
- 每個部門準備草稿、active、expired、finalizing、completed、stopped 與已刪除文件；簽署日期與資料應為合成測試內容。

## 執行檢查（實作完成後）

從 repository root 執行：

```bash
pnpm install
pnpm -C server db:test:create
pnpm -C server test --runInBand
pnpm -C server test:schema
pnpm -C server test:e2e
pnpm -C server test:e2e:security
pnpm lint
pnpm build
```

先執行本次受影響的 service／授權與 migration 測試，再完成上述整體檢查；新測試檔名於 tasks 定義，不把尚不存在的測試宣稱已執行。Schema/E2E 的既有 setup 會驗證測試 DB 與 migration；實際命令需使用 repository 既有測試設定，不自行換成 UAT 連線。

## 本機瀏覽

```bash
pnpm dev
```

使用兩個獨立瀏覽器 session 分別登入 A1 與 A2，再用第三個 session 登入 B1。前端 http://localhost:3000，server 代理沿用既有設定。

1. A1 建立草稿，A2 在電子簽列表可看到它，B1 的 dep 列表不可見。DevTools 確認請求為 role=dep、未傳部門代碼；回應不含 B 文件。
2. A2 可開草稿／已發起文件唯讀詳情與來源 PDF，沒有編輯、發起、刪除、停止、補簽、備註寫入或催簽能力。直接打開 /edit、/signers 也不能進可寫模式。
3. 對管理 API 直接發出 A2 的合法 session 請求，驗證 404、DB 無變更、無通知入列。不能僅檢查按鈕有沒有隱藏。
4. 用建立人姓名／員編、文件標題、狀態、單邊／雙邊日期篩選，再清空全部條件：只在 A 部門文件中縮小／恢復，沒有設定簽署開始日的文件依原日期篩選規則處理。
5. 檢查唯讀 response 不含 Email、內部 note、邀請 URL、驗證連結、管理提醒資格或檔案 object key；原始 PDF 預覽維持既有防快取／嵌入標頭。

## API 與權限負向案例

依 [contracts/department-access.md](contracts/department-access.md) 對每一入口驗證：

- role=all、未知 role、偽造 departmentCode／departmentId 不得擴權。
- 未登入 401；無部門 dep／新建／一般匯出為 409，不能視為所有 NULL 文件共有。
- 不同部門直接使用 documentId、exportId、fileId、history id：404 或列表空資料；response 不含檔案、URL、筆數旁路，無新增工作／下載紀錄。
- ID 各自有效但不屬於同一 document／job／signer 時拒絕；Range／If-Range 不得跳過授權。
- 所有歷史 total/typeTotals 與 items 同範圍，跨部門 documentId filter 為零，外部匯出紀錄依所屬文件部門而不是匯出者判斷。
- created、assigned、未指定 role 維持原個人範圍，不開全公司。

## 同部門匯出

A2 對 A1 文件執行 Excel 紀錄與重下載、PDF 重下載、ZIP 建立／重試／狀態／分檔下載。驗證成功或依檔案狀態回既有錯誤，原文件設定不變。B1 以相同 ID 呼叫全部入口被拒絕。

worker 完成工作後，下載仍重新檢查使用者目前部門；工作成功不代表任何人都能下載。未就緒／過期錯誤在授權通過後才回傳。

## 調職與各登入入口

- 透過可信測試資料使 A1 重新登入同步至 B。A1 新文件屬 B；舊文件仍屬 A。A2 仍可讀舊文件，B1 不可因 A1 調職而讀取它。
- A1 仍可依建立人資格管理舊文件，但一般匯出入口受同部門規則限制；本人有簽署資格時，從本人任務的副本入口仍可使用。
- 使用 A1 舊 session 再查 dep／下載：使用 DB 已同步的新部門，不沿用舊 session 部門。
- 帳密、WebView、OAuth 都跑一次代碼更新／缺值／上游失敗測試；上游明確缺值不能殘留舊代碼，上游失敗不能改用假部門。
- 跨部門本人簽署、拒簽、本人副本、外部 OTP／本人副本與公開驗證皆維持原契約。

## UAT 切換演練

先在隔離測試資料演練 [data-model.md](data-model.md) 的切換／回滾流程。真正 UAT 寫入不屬本輪授權：

1. 先停寫、停一般下載並暫停會變更文件的 worker，備份 DB／私有檔案；套用只加欄位的 schema migration。
2. 在維護窗口盤點舊文件明列 ID、原 code/name、狀態、軟刪除數及證據摘要，保存受控備份；包含軟刪除，重跑不得重建集合。
3. 核對指定代碼 `1029030000` 與名稱「IT策略本部系統開發部」。不符或有非預期非空歸屬即停止。
4. 依 [uat-cutover.md](uat-cutover.md) 的同一 SQL，在同一 connection／transaction 鎖定集合、整批 preflight、回填與核對。保留 User、原建立人、updated_at 與全部證據；任一缺失 ID 或不合法原值整批不寫入。
5. 核對備份數、實際改動數、已同值數及新建文件不變；成功才 commit，失敗 rollback 並維持維護狀態。
6. 部署完整相容程式，正式重新登入同步可信部門，確認 IT 同事可讀舊文件、其他部門無關者不可讀／匯出，新文件按真實建立人部門。本人跨部門／外部簽署與副本保持原資格；驗收後才開放服務。
7. 隔離演練同一備份的原值回復與安全重跑，另驗證 schema up/down/up；不能讓回滾後全員可下載的舊版本直接重新開放服務。

## 驗收紀錄

交付時記錄實際測試命令、結果、未執行原因、UAT 回填清單與影響筆數核對結果；不得把本指南當作測試通過證據。前後端無新增 dependency 或 env；schema／資料變更依 migration 與一次性 UAT 程序分開交付。
