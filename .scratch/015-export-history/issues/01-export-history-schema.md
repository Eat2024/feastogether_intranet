# 01: 匯出紀錄 schema 擴充

**What to build:** 讓 `esign_export_jobs` 能存 Excel 與單人 PDF 紀錄，以及簽署人本人下載：`created_by_user_id` 改為可 NULL，新增 `signer_id`、`conditions_json`、類型時間索引與類型 CHECK。

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

**Spec:** 015 — data-model、research R1–R4、R11、R12；對應 T001–T006。

**執行約定:** 所有票單只實作後端、必要 migration 與契約文件，不修改 client、不部署、不建立遠端 issues。開始實作改 claimed；驗收通過並合併至功能整合分支後才改 resolved，追加驗證與 commit 紀錄，保留原驗收條件。測試 DB 名稱必須以 `feastogether_intranet_test` 開頭，只清理本次建立的合成資料。

- [ ] 核對指引、constitution 1.5.0、migration 次序與測試隔離；基準 `test`、`test:schema` 結果記入 quickstart。
- [ ] `schema-constraints` 涵蓋 CHECK 的拒絕與接受案例，以及 `signer_id` 外鍵 RESTRICT。
- [ ] `schema-migration` 驗證 up→down→up；既有 ZIP 資料在 up 後通過 CHECK；已有 `excel`／`pdf` 紀錄時 down 在任何 DDL 前拒絕且資料不變。
- [ ] Migration `1792454406000-ExportHistory`、entity、`schema.sql`、`doc/esign-db-schema.sql` 一致，`schema-metadata.spec.ts` 通過。
- [ ] 應用程式行為不變：既有 unit 與 ZIP e2e 仍通過。
