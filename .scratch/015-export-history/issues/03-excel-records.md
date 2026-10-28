# 03: Excel 匯出紀錄與重新下載資料

**What to build:** 前端下載 Excel 時以 `POST /api/esign/history/export` 回報文件、範圍、筆數與條件，由後端寫入紀錄；任何員工可用 `GET /api/esign/history/export/{id}/document` 取得重新產生 Excel 所需的窄資料。

**Blocked by:** 02

**Status:** ready-for-agent

**Spec:** 015 — US2、US4（Excel）、FR-006、FR-009、FR-010；對應 T014–T017、T026–T027。

**執行約定:** 所有票單只實作後端、必要 migration 與契約文件，不修改 client、不部署、不建立遠端 issues。開始實作改 claimed；驗收通過並合併至功能整合分支後才改 resolved，追加驗證與 commit 紀錄，保留原驗收條件。測試 DB 名稱必須以 `feastogether_intranet_test` 開頭，只清理本次建立的合成資料。

- [ ] 先寫會失敗的 HTTP 案例，涵蓋成功、404、400、Origin 與 401；每個失敗案例都確認沒有新增紀錄。
- [ ] 有效員工即可記錄，不檢查建立人；文件須存在、未刪除且已發起，否則 404 `ESIGN_RESOURCE_NOT_FOUND`。
- [ ] 匯出人只取自 session；body 規則依 contract（`type` 只接受 `excel`、條件鍵限定集合、`scope` 為 1–255 字、`count` 為 0 以上整數、`depts` 上限），未知欄位回 400。
- [ ] 成功回 201，內容與查詢的 item 形狀相同。
- [ ] `GET …/{id}/document` 唯讀、不新增紀錄；只回 contract 列出的欄位，不含管理備註、通知結果、驗證網址與簽署人 publicId；非 `excel` 紀錄或文件已刪除時回 404。
- [ ] Swagger 說明與 contract 一致。
