# 02: 歷史匯出紀錄查詢

**What to build:** 新增 `GET /api/esign/history/export?type=excel|pdf|zip&page&pageSize&documentId`，以頁碼分頁回傳紀錄、`total` 與 `typeTotals`，並移除 `GET /api/esign/exports`。

**Blocked by:** 01

**Status:** ready-for-agent

**Spec:** 015 — US1、FR-001～005、FR-011、FR-012；對應 T007–T013。

**執行約定:** 所有票單只實作後端、必要 migration 與契約文件，不修改 client、不部署、不建立遠端 issues。開始實作改 claimed；驗收通過並合併至功能整合分支後才改 resolved，追加驗證與 commit 紀錄，保留原驗收條件。測試 DB 名稱必須以 `feastogether_intranet_test` 開頭，只清理本次建立的合成資料。

- [ ] 新增 `server/test/esign-export-history.e2e-spec.ts` 並加進 `jest-e2e.json`；先寫會失敗的查詢案例。
- [ ] 參數驗證：缺 `type`、未知 `type`、`page=0`、`pageSize=101`、`documentId` 格式錯誤都回 400。
- [ ] 分頁依 `created_at`、`id` 由新到舊，不漏不重；帶與不帶 `documentId` 時 `total`、`typeTotals` 都正確。
- [ ] 任何有效員工可看全部紀錄；未登入與外部存取 cookie 回 401。
- [ ] `exportedBy` 正確區分員工、本人下載的內部簽署人、外部簽署人；`zip` 項目沿用既有工作欄位，只計 `snapshot_json IS NOT NULL` 的工作。
- [ ] API `type` 與 DB `export_type` 的對應只在 history service 一處。
- [ ] `GET /api/esign/exports` 回 404；security 與 api-coverage e2e 已改用新路由；ZIP 申請、查詢、重試、下載的既有 e2e 不變。
- [ ] Swagger 說明與 contract 一致。
