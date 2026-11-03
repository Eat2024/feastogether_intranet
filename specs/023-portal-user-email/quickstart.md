# 驗證與上版交接

本文件是待實作功能的驗收指引，以下沒有宣稱已執行。使用合成資料，測試 DB 名稱必須以 feastogether_intranet_test 開頭，禁止套用 UAT 憑證執行測試。

## 前置

1. PR #45 migration 已套用並確認 users.email nullable/select:false。不得重建或清除已匯入資料。
2. 建立隔離 MySQL 8.4／Redis，依現有 .env.test 範例設定；先驗證 DB 名稱保護。
3. 在 test fixture 建立 5,001 人（混合新舊帳號、前導零、英數、空 email、共享信箱、停用、部門相似碼），禁止使用真實 Portal 匯出檔。

## 工具驗收

由 contracts/local-directory.md 的 CLI 執行 preview → apply → 同來源重新 preview/apply，確認首次分類與結果一致、第二次 changed=0 且 updated_at 不變。注入缺姓名、非法 hex/UTF-8、缺欄位、衝突員編、非法非空 email、空來源與長度超界，確認預覽阻止寫入。

預覽後用另一連線更新姓名／email／last_login_at 或新增相同員編，apply 必須拒絕。寫入途中故障不得留下部分資料。回復測試包括未被使用的新帳號可安全刪除、有文件／稽核／session 依賴或事後修改時整批拒絕；DB commit 後 artifact 寫入失敗須提示人工對帳。

## 流程驗收

- 既有 org chart 正常取資料及使用快取；準備有效 session 與選人資料後，將 HR lookup／emails mock 設為一旦被呼叫就失敗。
- 每批 100 共 51 次解析 5,001 人，去重後完整對應；缺一人則 UI 阻止整份送出並提示同步，解析不得建立帳號。
- 發起包含有／無 email 員工與外部 Email：確認所有指派成立，缺信箱通知 skipped；惡意 client email 不影響內部快照。
- 並行修改 email／部門／帳號狀態與兩份共用簽署人的發起，核對交易內一致性與無部分寫入／寄信。
- 員編／直接部門／完整 Email 白名單、相似部門／子部門拒絕、規則及 users DB 故障、production bypass、初邀／催簽／補簽／OTP 全部測試。
- 主檔更新後重送舊通知仍使用固定信箱；登入同步不清空 users.email，登入／候選 payload 不增加 email。

## 驗證指令（實作完成後）

```bash
pnpm -C server test --runInBand
pnpm -C server test:e2e
pnpm -C server test:e2e:security
pnpm -C server lint:check
pnpm -C server build
pnpm -C client lint
pnpm -C client build
pnpm build
pnpm lint
```

Schema 無新增；若實作碰觸 migration／entity，另跑 pnpm -C server test:schema 並更新對應快照。所有驗證需記錄實際結果／未執行限制，不能引用前次 PR 通過結果代替。

## 效能與部署

相同環境、同一份合成 5,001 人，切換前後各跑三次，記錄每次解析總時間、Email 查詢、發起交易、policy 時間、DB query 數與 HR request 數。後者在 scope 內必須為 0；不得逐人 SQL 取得 email。若仍超時，附測量交由 022 背景流程處理，不宣稱本規格解決所有大量寫入成本。

正式啟用前由維運確認 DB 資料完整度、更新責任人、更新時機與受控原值檔保存位置；部署 server 與 worker 同版本，client 提示同步上版。執行不寄真信的合成 smoke，寄信測試需使用允許的測試收件人。回滾先回復應用版本，保留 email 欄位與資料，不為回滾程式刪除新帳號／歷史資料；資料回復使用受控流程另行確認。

## 實作前置核對（2026-11-03）

- 本機 dev 已含 PR #45 的 UserNotificationEmail migration 與 email select:false；本次不新增 schema。
- 首次 UAT 匯入依使用者回報：5165個唯一員工、613個非空信箱、4670新增／495既有、差異0；本輪不重新連線 UAT。
- 本機隔離測試使用 MySQL :13321／Redis :16321；資料庫名稱保留 feastogether_intranet_test 前綴。
