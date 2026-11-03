# 022 本機整合驗收

驗收工作樹 `impl/022-08`，整合分支 `impl/022-integration`。本輪只改後端；不部署、不寄真信、不操作 UAT。所有資料為合成員工／文件，寄信由既有 fake mail fixture 隔離。

## 環境與重現

- MySQL `127.0.0.1:13322`，8.4.11；Redis `127.0.0.1:16322`，7.4.11；不是 UAT 8.4.7。
- 主 suite：`feastogether_intranet_test028`、Redis DB8、私有檔案 `/tmp/esign-test022-t08`。原 `test022_t08` 基底加 schema fixture UUID 超出 MySQL 64 字元限制，改短的隔離資料庫，未改正式設定。
- matrix／mixed：`feastogether_intranet_test022_t08bench`、Redis DB11、`/tmp/esign-test022-t08bench`。
- 長測：`feastogether_intranet_test022_long`、Redis DB10、`/tmp/esign-test022-long`；與一般 suite 的 DB、queue、私有檔案分離。
- 既有 `.env.test.example` 複製為未追蹤 `.env.test`，只改本機連線及隔離名稱；無新增 dependency、正式環境變數或排程。
- `pnpm install --frozen-lockfile` 成功。

```bash
DB_MYSQL_DB=feastogether_intranet_test028 pnpm -C server test:e2e
DB_MYSQL_DB=feastogether_intranet_test028s pnpm -C server test:schema
DB_MYSQL_DB=feastogether_intranet_test022_t08bench REDIS_DB=11 ESIGN_STORAGE_ROOT=/tmp/esign-test022-t08bench pnpm -C server test:e2e --testRegex 'esign-initiation-benchmark.e2e-spec.ts$' --testNamePattern 'SC-001|SC-008'
DB_MYSQL_DB=feastogether_intranet_test022_long REDIS_DB=10 ESIGN_STORAGE_ROOT=/tmp/esign-test022-long pnpm -C server test:e2e --testRegex 'esign-initiation-benchmark.e2e-spec.ts$' --testNamePattern 'SC-006'
```

## 受理效能與排隊

基準 `fadfc3f8`（01–07 整合），測試 harness 見 `f6d9de7`。每組20次，P95取排序後第19次；只量 POST受理，不含上傳、既有前置員編解析或後續GET詳細資料。背景處理仍由真實 `EsignInitiationJobService.process` 使用真 MySQL/Redis 執行，逐次驗成功與完整簽署人數。資料與負載僅代表本機合成環境。

| 簽署人 | 樣本 | POST P50 ms | POST P95 ms | 背景處理最大 ms | 測試程序峰值 RSS bytes |
| --- | --- | --- | --- | --- | --- |
| 1 | 20 | 10.35 | 12.39 | 64.44 | 440287232 |
| 100 | 20 | 12.97 | 16.99 | 107.53 | 459964416 |
| 101 | 20 | 9.77 | 14.15 | 83.95 | 475955200 |
| 5001 | 20 | 90.82 | 102.57 | 1546.16 | 1090961408 |

80次全通過 P95≤3000ms。背景處理數字包含完成後摘要／詳細資料HTTP驗證；RSS是Jest測試程序累積峰值，不是獨立正式worker記憶體基準。

SC-008 真 Bull Worker、queue global concurrency=1：先提交5001人，再提交5人；大型POST95.30ms、小型POST11.47ms。大型成功後13ms小型取得執行權，兩份皆 succeeded，符合60秒門檻。原始結果存本機 `/tmp/022-acceptance-benchmark.json`、`/tmp/022-mixed-benchmark.json`。

## SC-006 實時間長測（進行中，尚未標通過）

UTC 2026-11-03T15:14:35.183Z 開始；期限120分鐘，簽署截止設為24小時後。測試在每批首次 `UserRepository.findByIds` 查核注入 `batch人數 × 1000ms` 真實 timer，每位選中者只加一次，正式鎖內信箱重核不再加第二輪延遲。真Bull Worker進入正式service，heartbeat獨立續租；沒有使用 fake clock。

進度 `/tmp/022-long-benchmark-progress.json` 每30秒記錄 UTC/實際elapsed/processed/total/lastHeartbeat/status/stage/attempt，不含名單；結束另寫 `/tmp/022-long-benchmark-result.json`。啟動時正式程式基準為 `fadfc3f8`；後續Redis重連補修不在此已載入程序內，不把此長測宣稱為重連測試。初始錯誤 seam（鎖內重核延遲）已停止並捨棄，不計成功結果。

## 回歸與測試遷移

先確認舊 internal-email-signing 三項因201期待失敗，再改為明確202、同HTTP app真worker service、GET job摘要、GET文件詳細資料。保留既有repository/service spies與交易故障注入；背景資格錯誤檢查 failed／errorCode，不偽造同步422。來源暫時故障持續注入三次，測試只將nextAttemptAt移至已到期以略過30/120秒退避，真claim次數及交易不變；這不是實時間退避驗收。

- fixture清理只刪自身document jobs，ID倒序先子後父，保留FK。已由helper處理的等待dispatch依自身job ID移除；不清其他測試資料。
- PDF worker fixture同時pause新initiation queue，避免另一app instances搶工作而繞過既有spies。
- retry資格競態原52秒失敗：外部鎖持有者佔app pool2之一，worker交易佔另一條，HTTP輪詢等不到連線。改測試外部持鎖者使用獨立DataSource，正式pool維持2，原鎖內資格與HTTP取樣斷言保留，8/8於1.7秒通過。未改正式pool規格。
- schema約束清單增加8個新工作表CHECK；仍比對完整精確清單。
- 完整server/schema/security/root最終結果待補，不以局部通過取代。

## 未改 client 的相容性與限制

靜態呼叫證據：`client/src/features/esign-documents/DocumentSignersEditor.tsx` await `initiateDocument` 後未讀回傳詳細資料，仍導向 `/forms?flash=published&count=...`。舊API wrapper仍宣告詳細資料型別，但實際回202工作摘要；本輪按授權不改前端。無key舊body由後端相容受理，工作中列表維持draft，成功後active，異動回409 worker執行中訊息。

本輪沒有瀏覽器互動驗收，也未新增列表進度、輪詢、失敗還原畫面。既有前置解析耗時、型別宣告與published成功文案限制仍存在，不宣稱此後端修改解決全部前端等待。

## 發布與回退

只在隔離本機演練 migration；未部署 UAT。新表migration必須先於新版worker/server，然後協調切換兩個entrypoint；本輪client不部署。回退前先停止新受理並結清所有queued/processing，保留工作表與終態摘要，不能把尚有非終態工作的server直接換回舊同步版本。

`esign-initiation-schema.e2e-spec.ts` 真MySQL驗非空工作表down拒絕且資料保留，測試自身合成列清空後down/up可重建；這只是空表DDL回退演練，不是建議刪除正式工作紀錄。非空表正常回退保留schema，既有簽署證據不可刪除。
