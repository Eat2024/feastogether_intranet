# 資料模型與狀態

本次重用既有資料表；此文件描述目標行為，不代表程式已更新。

## 員工與簽署指派

`esign_signers` 沿用 `id/publicId/documentId/signerType/userId/empidSnapshot/email/status`。`signerType=user` 必須有可信本機 `userId` 與員編快照，`email` 可以 NULL；既有 identity CHECK 已允許，無 migration。`signerType=email` 繼續要求固定有效 Email，不能由員工 session 接管。

發起時重新解析員工與信箱，無地址以 NULL 保存；有地址仍固定發起時地址。不新增手填信箱、補登或 HR 通知資料。上游故障不是無信箱，維持原錯誤。文件快照繼續容納 nullable email，既有已發起快照不改寫。

內部新指派的 `invitationTokenSha256/invitationTokenCiphertext/invitationExpiresAt` 保持 NULL，不作授權或寄信前提；歷史值可保留供舊信識別，不再授權。外部依原 token 世代規則。

## 簽章與副本

`esign_signature_records.authenticationMethod` 為 varchar(50)：新內部紀錄 `internal_session`，外部保留 `email_invitation`。`authenticationEventId` 沿用 `internal:<signerPublicId>:<requestId>`／`external:<signerPublicId>:<requestId>`；無 session token。沿用 auth event 與 signer 唯一索引，兩處查重皆先確認 principal，不允許 requestId 成為授權。

同意版本、source hash、payload hash、UTC 簽署時間、IP／UA 與 verificationCode 沿原邊界保存。新驗證方式在寫入不可變證據前決定；不更新舊紀錄、PDF、manifest 或驗證結果。

`pending → signed` 或 `pending → rejected` 在交易鎖內完成；同 requestId 重送回既有結果，新 requestId 不可再次完成。補簽僅重開原有待簽指派，已簽／拒簽維持既有規則。副本狀態仍為 `pending → processing → ready|failed`，沿 worker 產製與完整性驗證。

## 通知批次與明細

重用 `esign_notification_batches`、`esign_notification_logs`。可寄送者 `pending → processing → delivered|failed|unknown`；無有效內部 Email 記 `skipped`，reasonCode 使用既有 `RECIPIENT_UNAVAILABLE`，completedAt 寫 UTC，不入寄信佇列、不記 delivered。既有每日一次催簽及 batch/request 去重保留。

內部新 log 的 invitation/reminder token 欄位為 NULL；claim/send/finish 依 signerType 分支，內部檢查文件期間、本人指派狀態、batch/log supersede、lease，不要求 token generation。補簽在同一交易終止舊未完成通知並建立新批次，寄送結束以租約條件更新，舊工作不得覆寫新批次。外部維持 generation 與 token 有效期。歷史內部 log 可有 token，但新 worker 忽略其授權用途。

## BCC 寄送群組（沿用通知表，不建新表）

一組為同一 `documentId + batchId + kind` 的合格內部 log，按 log id 穩定排序。單次 SMTP 最多 50 個不同的既有正規化 Email；同地址的合格 log 一起領取、一起回填結果，不合併 signer。新批次只有一位可通知者或失敗重試只剩一位時仍可寄一封，不填入無關收件人。

領取時沿 document → batch／log 的一致鎖順序，將選中的所有 log 設 processing、相同隨機 `leaseToken` 與 `processingStartedAt`、各自增加 attemptCount；提交交易後才寄 SMTP。mail 回傳各地址結果，依 lease 條件更新對應 log。既有 token 欄位保持 NULL；群組不需要新永久 ID 或保存 BCC 快照，寄送名單只在 worker 記憶體，地址仍來自固定 signer.email。

`delivered` 表示 SMTP 已受理，不代表到達收件匣。明確暫時拒收／未送出者 failed，內部每個 log 最多 3 次（含首次），採既有催簽的 30／60 秒退避；永久拒收 failed 不自動重試；未列明結果、DATA 後斷線、寄送後落庫失敗或 stale processing 保守轉 unknown，不因 lease 到期重寄。accepted 不隨其他地址的錯誤一起回 failed。共用信箱各 log 同步狀態，但授權仍逐人。既有批次統計仍按 log（人次），不是 SMTP 封數。

## Portal session（非 DB schema）

新增私有 session 欄位 `login_redirect_target`，值須存在於集中允許映射，初始 key 為 `hr/esign/mine`；`login_password_change_pending` 記錄本次登入尚待改密碼。兩者採共用名稱，不綁電子簽。取出目標時重新檢查映射仍有效，使用對應的站內路徑。皆由 server 控制，沿既有 session 期限，不建立新計時排程。

- 合法登入 GET：保存目的地；無參數的新 GET 或不合法輸入清除目的地。
- 登入 POST／驗證失敗：保留目的地；成功無待辦時消費並返回。
- 預設密碼登入：設待辦，先進改密碼；重開 Email 仍先完成待辦。
- 改密碼成功：清待辦並消費目的地；失敗兩者保留。
- 登出：兩欄都清除。共用瀏覽器多分頁使用同一 session，新的登入 GET 決定目的地，無需新交易 token。

## Migration 與回退

無 schema、索引或資料回填。無 Email 的新指派與新驗證方式不保證舊程式可操作；回退須停止受影響寫入／通知並保留資料，不能清除任務或回寫證據。細節見切換契約。
