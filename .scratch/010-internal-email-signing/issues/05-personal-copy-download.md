# 05: 簽署後透過 OTP 取得個人副本

**What to build:** 已簽署員工可在同次驗證或日後重開原邀請並重新 OTP 後，取得本人簽署副本；停止、到期或完成不剝奪下載權利，刪除後不可存取。

**Blocked by:** 04 內部員工透過 Email＋OTP 簽署或拒簽。

**Status:** claimed

**Spec:** 010 — US3、FR-010、FR-012～013、FR-017。對應 T029～T032。

**執行約定:** 前置 resolved 才開始；沿用既有 PDF worker、產物、浮水印與證據，不新增副本種類或期限。不修改 client、不部署；驗收並整合後才 resolved，追加驗證與 commit 紀錄。

- [x] 本人結果正確回報 pending／processing／ready／failed；未就緒下載回 409，未簽及已拒簽者不能下載簽署副本。
- [x] 簽署成功不清除現有有效 cookie；有效存取可下載本人副本，8 小時失效或新瀏覽器須重新 OTP，不可用一般員工 session 取代。
- [x] 已簽者原邀請在停止、到期、完成後仍可重新驗證下載，不設下載期限；仍驗證邀請世代、文件關聯與 credential，刪除後拒絕，不能重簽。
- [x] 沿用產物完整性檢查，損壞產物不提供；本人與建立人取得同一副本的 PDF bytes 一致，歷史證據 hash 不變。
- [x] 跨人、跨文件及錯誤 cookie 無法讀取原檔、結果或副本；讀取保持 GET 唯讀與 private,no-store。
- [x] 隔離環境由測試 worker 產生真實測試產物，完成 HTTP 下載、重新 OTP 下載及狀態／授權測試，記錄結果；前端輪詢與手機畫面驗收仍列未實作。

## 2026-10-21 實作與驗收紀錄（待整合）

- 以整合分支 `3961514` 為基底；前置 04 已 resolved。依 implement-spec／tdd 在已同意的 HTTP、worker、storage 邊界逐個加入驗收，使用真實 MySQL／Redis、合成 HR／Email 與真實 PDF 產物。
- 先新增同次 OTP 的 pending→ready／下載測試即通過：03／04 已將內部指派接入既有共用存取及副本實作，因此本票不重複新增 production 邏輯，也不宣稱修正不存在的失敗。後續逐次增加儲存故障、processing 暫停、重試、終態、授權及完整性驗收均通過。
- 新增七個整合案例，涵蓋儲存故障 failed→processing→ready、已簽原邀請過期十年後仍可重新 OTP、停止／到期／完成下載、簽後 cookie 保留、一般員工 session 不能下載、錯誤世代／刪除拒絕、拒簽與跨人／跨文件隔離、損壞 PDF 拒絕提供、建立人／本人 bytes 一致及公開證據摘要不變。GET 前後建立人歷程一致。
- credential 實際 TTL 核對為八小時；Redis 使用真實時鐘，因此以刪除單一合成 credential 模擬自然失效，再透過真實 OTP HTTP 重新驗證。停止、完成均走正式操作；到期時間與軟刪除以隔離 DB fixture 驅動，不增加正式刪除入口。
- HTTP：`pnpm --config.verifyDepsBeforeRun=false -C server test:e2e --testRegex internal-email-copy.e2e-spec.ts`，1 suite／7 tests 通過；新 suite 已登錄一般 e2e 及 security 白名單。
- `pnpm --config.verifyDepsBeforeRun=false -C server lint:check` 通過（既有 warnings）；新增測試再以 ESLint `--max-warnings 0` 單獨檢查。`pnpm --config.verifyDepsBeforeRun=false -C server build` 通過。
- 契約校正：副本未就緒沿用既有 `409 ESIGN_STATE_CONFLICT`／「個人副本尚未產生」，不是尚未存在的 `ESIGN_PERSONAL_COPY_NOT_READY`。
- 無 client、migration、環境變數、dependency、真實 HR／寄信或部署變更。前端輪詢、手機／瀏覽器畫面驗收仍未實作。狀態維持 claimed，待 merger 整合並追加 commit 紀錄後才 resolved。
