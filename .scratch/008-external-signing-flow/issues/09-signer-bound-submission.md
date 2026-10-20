# 09: 送出簽名綁定簽署人

**What to build:** 外部簽署人送出簽名時，系統確認送出的頁面確實屬於目前存取所對應的簽署人。同一個瀏覽器先後開啟同一份文件兩位簽署人的邀請、cookie 被後者覆蓋時，從前一個分頁送出的簽名會被拒絕，並提示重新開啟邀請信中的連結，不會把簽名記到另一位簽署人身上。

**Blocked by:** 05: 簽完立即下載本人副本

**Status:** resolved

- [x] 外部送出簽名必須帶上頁面所屬的簽署人識別；後端與存取憑證對應的簽署人比對，不符時回 409「此頁面的簽署對象已變更，請重新開啟邀請信中的連結」，不建立簽署、不改變任何簽署人狀態。
- [x] 內部簽署端點不受影響。
- [x] 外部簽署頁送出時自動帶上頁面路由中的簽署人識別；收到不符錯誤時顯示該訊息，不顯示員工登入相關提示。
- [x] 合法送出（含網路重試重送同一請求）照常成功。
- [x] e2e 重現「同一文件兩位外部簽署人、cookie 被覆蓋」情境：舊分頁送出被拒、兩位簽署人都維持未簽；另驗證缺少或格式錯誤的簽署人識別回 400。
- [x] API 契約與後端 API 說明同步更新；server lint、test、build、e2e 與 client lint、build 通過。

## 實作紀錄（2026-10-20）

- 分支 `008/09-signer-bound-submission`，commit `4461abc`（實作）、`ecc7c7c`（合併整合分支 f3c6b46）；合併至整合分支 `8f0a988`。
- 後端：外部簽名端點改用 `ExternalSignatureSubmissionDto`（必填 `signerPublicId`，UUID v4），controller 與 cookie 對應簽署人比對，不符回 409 `ESIGN_EXTERNAL_SIGNER_MISMATCH`（envelope code `ESIGN_STATE_CONFLICT`）；內部端點維持原 DTO。
- 前端：送出帶 `task.signerPublicId`；不符錯誤以 Snackbar 顯示後端 message、留在原頁（偏離契約原寫的 `03` 失效頁，取捨列入 12）。
- e2e：重現同一文件兩位外部簽署人 cookie 覆蓋（修正前 201 簽錯人 → 修正後 409、兩人皆未簽），缺少／格式錯誤 400；05 的跨文件測試改為預期 409。
- 驗證：server test 766、build、lint 0 error；e2e 11 suites／77 tests、security 6／27；client lint、build；整合後 server／client 驗證通過。

