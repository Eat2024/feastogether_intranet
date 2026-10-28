# Quickstart：歷史匯出紀錄驗收

## 自動化

```bash
pnpm -C server lint:check
pnpm -C server build
pnpm -C server test
pnpm -C server test:schema
pnpm -C server test:e2e
```

`test:schema` 與 `test:e2e` 需要隔離的 MySQL／Redis；測試 DB 名稱必須以 `feastogether_intranet_test` 開頭。

本 spec 只做後端，不執行 client 驗證。

## 驗收矩陣

| # | 情境 | 預期 |
|---|---|---|
| 1 | migration up 後執行 `schema:dump` | `schema.sql` 與 entity 一致；舊 ZIP 資料通過 CHECK |
| 2 | 已有 `excel`／`pdf` 紀錄時執行 migration down | 拋錯拒絕回退，資料不變 |
| 3 | 沒有新類型紀錄時執行 migration down | 欄位、索引、CHECK 移除，`created_by_user_id` 回到 NOT NULL |
| 4 | 寫入違反 CHECK 的資料（`excel` 沒有條件、`pdf` 沒有簽署人、ZIP 沒有匯出人） | DB 拒絕 |
| 5 | `GET /api/esign/history/export` 不帶 `type`、`type=sheet`、`pageSize=101`、`page=0` | 400 `INVALID_REQUEST` |
| 6 | 23 筆 `excel` 紀錄，`pageSize=10` 翻三頁 | 10／10／3 筆，不漏不重，`total=23` |
| 7 | 三類型各有資料，帶與不帶 `documentId` | `typeTotals` 與各類型逐頁合計相同 |
| 8 | 非建立人、非匯出人的員工查詢 | 看得到全部紀錄 |
| 9 | 未登入或只有外部存取 cookie | 查詢、記錄、重新下載都被拒，且不留紀錄 |
| 10 | 非建立人 `POST` Excel 紀錄到已發起文件 | 201，匯出人為目前使用者 |
| 11 | `POST` Excel 紀錄到草稿、已刪除或不存在的文件 | 404，不新增紀錄 |
| 12 | Excel body 帶未知欄位、未知狀態／欄位、`fields` 為空、`scope` 為 256 字、`count=-1`、`type=pdf` | 400，不新增紀錄 |
| 13 | 建立人 `POST …/completed-file/downloads` | 回 PDF；新增 `pdf` 紀錄，匯出人為建立人，範圍為該簽署人 |
| 14 | 外部簽署人 `POST /api/external-signing-task/completed-file/downloads` | 回 PDF；新增 `pdf` 紀錄，匯出人為「姓名＋Email」 |
| 15 | 內部員工以員工 session `POST /api/esign/signing-tasks/{id}/completed-file/downloads` | 回 PDF；新增 `pdf` 紀錄，匯出人為該員工（姓名＋員工編號） |
| 16 | 副本尚未產製完成或權限不符時下載 | 沿用原本錯誤，不新增紀錄 |
| 17 | 模擬紀錄寫入失敗 | 500，不回傳 PDF |
| 18 | 舊的三條 GET 下載與 `GET /api/esign/exports` | 404 |
| 19 | 任一員工對 `pdf` 紀錄 `POST …/{id}/downloads` | 回 PDF；新增一筆 `pdf` 紀錄，匯出人為目前使用者 |
| 20 | 對 `excel` 或 `zip` 紀錄 `POST …/{id}/downloads`；對 `pdf` 或 `zip` 紀錄 `GET …/{id}/document` | 404 |
| 21 | 任一員工對 `excel` 紀錄 `GET …/{id}/document` | 只回 contract 列出的欄位，不新增紀錄 |
| 22 | 申請、重用、重試與下載 ZIP | 行為與 Spec 009 相同；下載不新增紀錄；`zip` 只依匯出工作計數 |
| 23 | 存在 `excel`／`pdf` 紀錄時執行 ZIP worker 與維護掃描 | 新類型不被選中或更新 |

## 前端串接後（由前端工程師驗收）

1. 建立人在文件檢視頁下載某位簽署人的副本：成功下載，`GET /api/esign/history/export?type=pdf` 多一筆。
2. 外部簽署人在簽署完成頁按「下載已簽署文件」：成功下載，歷史多一筆，匯出人為外部簽署人。
3. 員工在「我的電子簽」下載本人副本：成功下載，歷史多一筆，匯出人為該員工。
4. 建立人匯出頁的 ZIP 面板：重新整理後帶回最近一次匯出，可產生、輪詢與下載。
5. 匯出頁下載 Excel：先回報紀錄再下載，歷史多一筆 `excel`。

## 驗證紀錄

### 01 schema（T001–T006，2026-10-28）

環境：Node v26.4.0、pnpm 11.9.0、MySQL／mysqldump 8.4.11（Homebrew）。基準為整合分支 `feat/015-export-history`（f974afe）。

測試隔離：
- e2e 使用 `DB_MYSQL_DB=feastogether_intranet_test_015_01`、`REDIS_DB=11`。
- `test:schema` 會在 DB 名稱後加 `_` 與 32 字元亂數；上述名稱加上後超過 MySQL 64 字元上限，因此改以環境變數 `DB_MYSQL_DB=feastogether_intranet_test1501` 執行，每個案例仍各自建立並刪除隨機測試庫。
- `pnpm -C server schema:dump` 讀 `.env`（開發庫），本次不碰開發庫：改用同一支腳本讀 `.env.test`，從已套用新 migration 的隔離庫匯出（`node --env-file=.env.test --conditions=development -r ts-node/register src/infrastructure/database/dump-schema.ts`）。

核對：root／server `AGENTS.md`、constitution（目前為 **2.0.0**，T001 寫的 1.5.0 已被 016 修訂；本票沒有牴觸）、migration 次序（新增於 `1792454405000-InternalEmailInvitations` 之後）。

| 指令 | 基準（變更前） | 變更後 |
|---|---|---|
| `pnpm -C server lint:check` | — | 0 errors（265 個既有 warnings，本次變更檔案 0 個） |
| `pnpm -C server build` | — | 通過 |
| `pnpm -C server test` | 106 suites／964 tests 通過 | 106 suites／964 tests 通過 |
| `pnpm -C server test:schema` | 2 suites／8 tests 通過 | 2 suites／12 tests 通過 |
| `pnpm -C server test:e2e test/esign-export.e2e-spec.ts`（ZIP） | 1 suite／4 tests 通過 | 1 suite／4 tests 通過 |
| `pnpm -C server test:e2e`（全套，額外回歸） | — | 27 suites／240 tests 通過 |

`test:schema` 新增案例：
- `schema-constraints`：`chk_esign_export_jobs_record_type` 的 8 個拒絕與 4 個接受案例；`fk_esign_export_jobs_signer` 拒絕不存在的簽署人與刪除被引用的簽署人，`DELETE_RULE=RESTRICT`；CHECK 清單加入新名稱。
- `schema-migration`：先停在 `InternalEmailInvitations` 寫入既有形狀的 ZIP 工作，up 後欄位、三個複合索引、外鍵與 CHECK 正確，既有單欄日期索引保留，ZIP 列仍可更新；down 還原到 up 前的結構（`created_by_user_id` 回到 NOT NULL）；再 up 結構相同。已有 `excel` 或 `pdf` 紀錄時 down 拋出「無法回滾」，資料與結構都不變。
- 「最新 migration 無 drift」案例同時驗證 entity 與 DB 一致。

`schema.sql` 由隔離庫重新匯出後，可載入空的測試庫（13 張表）。

### 02 查詢（T007–T013，2026-10-28）

環境：Node v26.4.0、pnpm 11.9.0。基準為整合分支 `feat/015-export-history`（e7ed918），實作分支 `impl/015-02`。

測試隔離：worktree 的 `server/.env.test` 改為 `DB_MYSQL_DB=feastogether_intranet_test1502`、`REDIS_DB=12`；`test:schema` 加上 33 字元亂數後仍在 MySQL 64 字元上限內。

| 指令 | 結果 |
| --- | --- |
| `pnpm -C server lint:check` | 0 errors（265 個既有 warnings，本次變更檔案 0 個） |
| `pnpm -C server build` | 通過 |
| `pnpm -C server test` | 106 suites／964 tests 通過 |
| `pnpm -C server test:schema` | 2 suites／12 tests 通過 |
| `pnpm -C server test:e2e --testRegex '(esign-export-history\|esign-export\|esign-document-delivery-security\|api-coverage)\.e2e-spec\.ts$'` | 4 suites／55 tests 通過：`esign-export-history` 14、`esign-export`（ZIP，不變）4、`esign-document-delivery-security` 3、`api-coverage` 34 |
| `pnpm -C server test:e2e`（全套，額外回歸） | 28 suites／255 tests 通過（01 合併後為 27／240；新增本檔 14 個與 api-coverage 1 個） |

驗收矩陣 #5–#8 與 #18 的 `GET /api/esign/exports` 已由 `esign-export-history`、`api-coverage` 自動化：
- 400 `INVALID_REQUEST`：缺 `type`、`type=sheet`、`page=0`、`pageSize=101`、`pageSize=0`、`documentId=abc`、`documentId=0`、未知參數。
- 23 筆 `excel`（每兩筆同一匯出時間，且越晚寫入的時間越早）以 `pageSize=10` 翻頁得 10／10／3／0，順序依匯出時間、流水號由新到舊，`total=23`。
- 帶 `documentId` 時 `typeTotals` 與逐頁合計相同；沒有紀錄的類型回 0；不帶 `documentId` 時與查詢前的基準相差本次寫入的筆數（測試庫不重建，以差值驗證）。
- 非建立人、非匯出人的員工看得到全部紀錄；未登入與外部存取 cookie（Redis 實際核發的憑證）回 401。
- `exportedBy`：員工取自員工資料（姓名、員工編號），本人下載的內部簽署人同樣取員工資料而非簽署人快照，外部簽署人本人下載為姓名＋Email。
- `zip` 只列有快照的匯出工作（沒有快照的舊 ZIP 列較新也不會出現），欄位與 ZIP 工作狀態相同，含 `files[].downloadPath`，不含 `requesterName`。
- Excel／PDF／ZIP 合成紀錄以 entity manager 直接寫入，`created_at` 以 SQL 固定；寫入 API 在 03、04 票單。

變異檢查：暫時拿掉 ZIP 快照條件、排序改為只依流水號、內部員工匯出人改取簽署人快照，新 e2e 有 5 個案例轉紅；還原後全綠。

Swagger：以 build 產物產生文件確認 `GET /api/esign/history/export` 的參數（`type` 必填 enum；`page`／`pageSize` 選填，預設 1／10，範圍 1–Number.MAX_SAFE_INTEGER／1–100；`documentId` pattern）、200／400／401 與回應 schema；`/api/esign/exports` 不在文件中。
