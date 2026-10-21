# Spec007 補簽與 Spec009 整合

2026-10-21：依使用者要求，將 `feature/007-reopen-signing`（`e0e7049`，包含拆分 private methods）合併至 `feature/009-esign-document-delivery`，一併交付 PR #17。PR 最終只交付後端；曾用於驗證的 client 串接已移除，正式畫面由獨立前端 PR 交付。

## API 與權責

- `POST /api/esign/documents/:documentId/reopenings`：建立人提供 `expectedSignEndAt`、新 `signEndAt` 與必填原因；只開放已到期且仍有 pending 簽署人的文件。只改到期時間，保留開始時間、固定簽署證據與既有副本；每輪追加歷程。
- `GET /api/esign/documents/:documentId/reopening-invitations`：建立人唯讀取得目前補簽輪的外部邀請。
- 入口在 `documents.controller.ts`，交易主流程在 `EsignReopeningService.reopen()`。前端應只傳新截止日與原因，不提供修改開始時間；本 PR 不含 `/forms` 串接。補簽不自動寄信。
- 已停止、已完成及 finalizing 不可補簽。拒簽者仍不納入 pending；「拒簽後改簽」尚未實作。

## 衝突處理與相容性

- 同時保留補簽 API 與 Spec009 草稿、備註、拒簽、催簽及 ZIP 服務。
- 歷程保留 Spec009 具名 actor；補簽歷程對建立人回傳原因／前後期限，對簽署人僅回傳必要期限資訊。
- 使用者已確認：補簽僅停用舊邀請信工作，催簽保留原有寄送結果。舊排隊催簽由既有 worker 檢查邀請世代後 skipped；unknown 不得改成 failed 或自動重寄；新一輪由建立人主動催簽，沿用每日限制。
- 舊補簽測試改用目前 OTP 流程與 signerPublicId 簽署契約。已簽外部本人可依 Spec008 繼續查看結果與個人副本。
- 發現並修正跨版本交界：Spec008 session 原本只存 signer id，補簽輪替邀請後舊 session 仍可使用。現改為在同一 Redis key 保存 signer id＋邀請世代雜湊；讀取入口與簽署／拒簽交易檢查世代，文件鎖取得後也檢查是否已換代。
- 沒有新資料表、migration、環境變數或排程。本機先前已套用的到期狀態 migration 足夠。

## 發布注意

舊格式外部 session 未綁邀請世代，更新後失效，使用者需從目前有效邀請重新 OTP。8 小時 TTL 不變，cookie／邀請明碼不寫入資料庫或 log。API 與 worker 應協調更新，不混跑不理解新功能的舊版本。補簽前的邀請及 session 不得取得新輪資格。

## 驗證

- 單元：101 suites／872 tests。
- 完整 e2e：17 suites／135 tests，含補簽兩輪、並發／舊請求、交易回滾、已簽副本與證據保留、舊邀請／session 失效、新 OTP、補簽與催簽交互驗證。
- schema：2 suites／6 tests。
- server build、lint:check 通過；lint 0 errors（202 warnings）。
- 正式 client 串接已移至獨立前端 PR；本分支保留 API、交易與 e2e 驗證，不以先前的瀏覽器原型驗證宣稱前端功能已交付。
- 補簽保留 unknown 催簽結果的新增測試先重現結果被覆寫成 failed，限制停用對象為 invitation 後通過。
- 原 Spec009 的 S3 部署容量驗收仍由 ticket11 承接，T028 未勾選；本次不宣稱完成該驗收。
