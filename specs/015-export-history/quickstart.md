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

尚未執行。
