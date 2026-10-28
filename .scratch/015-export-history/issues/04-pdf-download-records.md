# 04: 單人 PDF 下載紀錄與重新下載

**What to build:** 建立人下載、內部員工本人下載（員工 session，016 之後）、外部簽署人本人下載（Email OTP）與從紀錄重新下載，都改為 POST 子資源並在回傳 PDF 的同一請求寫入 `pdf` 紀錄；移除三條舊的 GET 下載。

**Blocked by:** 02

**Status:** ready-for-agent

**Spec:** 015 — US3、US4（PDF）、FR-004、FR-008、FR-014；research R5、R6；對應 T018–T025。

**執行約定:** 所有票單只實作後端、必要 migration 與契約文件，不修改 client、不部署、不建立遠端 issues。開始實作改 claimed；驗收通過並合併至功能整合分支後才改 resolved，追加驗證與 commit 紀錄，保留原驗收條件。測試 DB 名稱必須以 `feastogether_intranet_test` 開頭，只清理本次建立的合成資料。

- [ ] 先寫會失敗的 HTTP 案例：三條 POST 的成功、錯誤、Origin、401，以及紀錄寫入失敗回 500 且不送出 PDF。
- [ ] `POST …/signers/{signerPublicId}/completed-file/downloads`：只限建立人（同原本），PDF bytes 與標頭與原本 GET 相同，匯出人為建立人。
- [ ] `POST /api/esign/signing-tasks/{signerPublicId}/completed-file/downloads`：員工 session，只限已簽本人（同 016）；匯出人為該員工。
- [ ] `POST /api/external-signing-task/completed-file/downloads`：只限已簽的外部簽署人本人（同 016）；`created_by_user_id` 為 NULL；匯出人為「姓名＋Email」。
- [ ] `POST /api/esign/history/export/{id}/downloads`：任何有效員工；只接受 `pdf` 紀錄；新紀錄的匯出人為目前使用者，文件、簽署人與範圍沿用原紀錄。
- [ ] 副本未完成或權限不符時沿用原本錯誤，且不新增紀錄；簽署人標籤超過 255 字時截斷。
- [ ] 舊的三條 GET 回 404；`core-esign-flow`、`internal-email-copy`、`esign-rejection`、`esign-document-delivery-security`、`security-core-esign-flow`、`api-coverage` 已改用 POST 並通過。
- [ ] Swagger 說明與 contract 一致，移除「一般連結直接下載」的串接說明。
