# 簽署歷程事件中文化盤點

盤點日期：2026-11-02。範圍為本機分支的正式程式與前端歷程對照，未查詢 UAT 資料庫。

共 27 種：26 種有目前事件寫入流程，另 1 種 `document.stopped_by_deadline` 為仍保留讀取與顯示支援的舊事件。前端有 23 種中文對照、缺少 4 種。刪除草稿後一般查詢通常無法再取得該文件，故缺少對照不代表四種都會在正常畫面出現。

| 事件代碼 | 中文顯示文字 | 現況 |
| --- | --- | --- |
| `consent.accepted` | 簽署人同意電子簽名條款 | 已有前端對照 |
| `document.completed` | 所有簽署人皆已完成簽署或拒簽 | 已有前端對照 |
| `document.created` | 建立草稿 | 已有前端對照 |
| `document.draft_deleted` | 刪除草稿 | 缺少對照 |
| `document.draft_updated` | 更新草稿 | 已有前端對照 |
| `document.expired` | 簽署期限已到，文件已到期 | 已有前端對照 |
| `document.initiated` | 發起簽署 | 已有前端對照 |
| `document.opened` | 簽署人開啟文件 | 已有前端對照 |
| `document.reopened` | 建立人設定補簽，重新開放未簽署者簽署 | 已有前端對照 |
| `document.stopped_by_creator` | 建立人停止簽署 | 已有前端對照 |
| `document.stopped_by_deadline` | 簽署期限已到，系統自動停止 | 已有前端對照；舊事件相容 |
| `external_invitation.delivered` | 外部簽署人邀請信已寄送 | 缺少對照 |
| `external_invitation.opened` | 外部簽署人開啟邀請連結 | 已有前端對照 |
| `external_otp.failed` | 外部簽署人輸入的驗證碼錯誤 | 已有前端對照 |
| `external_otp.locked` | 外部簽署人驗證碼錯誤次數已滿，驗證碼失效 | 已有前端對照 |
| `external_otp.sent` | 寄送驗證碼給外部簽署人 | 已有前端對照 |
| `external_otp.verified` | 外部簽署人通過驗證碼 | 已有前端對照 |
| `external_reminder.delivered` | 外部簽署人催簽信已寄送 | 缺少對照 |
| `internal_invitation.delivered` | 已寄出內部簽署邀請通知 | 已有前端對照 |
| `internal_notification.protocol_error` | 內部通知寄送結果異常 | 已有前端對照 |
| `internal_reminder.delivered` | 已寄出內部催簽通知 | 已有前端對照 |
| `signature.completed` | 簽署人完成簽署 | 已有前端對照 |
| `signature.submitted` | 簽署人送出簽名 | 已有前端對照 |
| `signer.assigned` | 指派簽署人 | 已有前端對照 |
| `signer.copy_completed` | 個人簽署副本產生完成 | 已有前端對照 |
| `signer.copy_failed` | 個人簽署副本產生失敗 | 缺少對照 |
| `signer.rejected` | 簽署人拒絕簽署 | 已有前端對照 |

## 來源與處理方向

- `client/src/features/esign-documents/DocumentHistory.tsx` 使用 `EVENT_LABEL[e.type] ?? e.type`，未對照事件會直接顯示原代碼。
- `server/src/features/esign/services/esign-document-query.service.ts` 的 history 回傳 `type: event.eventType`，尚無中文標籤。
- 後端新增歷程顯示欄位 `label`，保留 `type` 供分組與顏色判斷；前端顯示 `label` 並移除重複字典。
- `document.reopened` 有特殊回應分支，必須一併補上 label，檢查 DTO 與 actor 相容性，不漏掉補簽事件。
- 原 DB event_type、metadata、hash 與簽署證據不改寫；此為回應顯示層中文化，無資料 migration。
- 未知事件使用「其他簽署歷程事件」中文顯示，不把未知事件誤標為成功；type 保留可供技術排查。
- `document.finalization_failed` 僅見於測試資料，未發現目前正式寫入流程，不計入上述 27 種；若 UAT 有歷史版本特有事件，可於唯讀盤點後追加對照。
- 本次不擴大到所有文件狀態、通知失敗碼或使用者自行填寫的 reason 翻譯。寄信的「已寄送」沿用既有送信成功語意，不表示收件者已讀。
