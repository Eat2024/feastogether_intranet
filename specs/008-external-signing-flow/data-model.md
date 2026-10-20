# Data Model: 外部簽署流程畫面與本人副本下載

本功能不新增資料表、欄位、索引、CHECK 或 migration，`schema.sql` 不變，簽署成功時的欄位寫入也維持現狀。以下說明既有欄位在本功能中的語意。

## esign_signers（email 簽署人）

| 欄位 | 待簽署（pending） | 已簽署（signed） |
|------|-------------------|------------------|
| `invitation_token_sha256` | 邀請憑證 digest，授權查詢依據 | **保留**（現狀即如此），作為簽署後開啟與下載的依據，不設期限 |
| `invitation_token_ciphertext` | 寄信前後保存密文；寄送成功清除；補簽時重建 | 簽署成功時清除（現狀） |
| `invitation_expires_at` | 有效簽署期限（發起或補簽時設定），授權時比對 | 簽署成功時清為 null（現狀）；已簽者授權不比對 |
| `status` | `pending` | `signed` |
| `signed_at` | null | 後端權威簽署時間 |
| `completion_status` | null | `pending` → `processing` → `ready`／`failed`（沿用個人副本流程） |

- 停止（`esign-stoppage.service.ts`）與到期（`esign-expiry.service.ts`）只清除 `pending` 簽署人的憑證欄位；已簽者的 digest 不受影響。
- 補簽（`esign-reopening.service.ts`）只替 `pending` 簽署人重建憑證；已簽者不受影響。
- 唯一讓已簽者存取失效的情況是簽署人或文件被刪除。

## 外部存取狀態

```text
邀請寄出（pending，期限＝簽署期限）
  ├─ 開始前按「開啟」 → 409 尚未開始頁（不設 cookie、不記開啟）
  ├─ 期間內按「開啟」 → 303 + cookie（Expires＝簽署期限）→ 同意聲明 → 閱讀與簽名
  │     └─ 送出簽名成功 → signed，cookie 重設為 session cookie → 完成頁
  ├─ 文件停止／到期／刪除 → 憑證清除或失效 → 401 失效頁
  └─ 期限屆滿 → 401 失效頁

已簽署（signed，不設期限）
  ├─ 任何時間按「開啟」 → 303 + session cookie → 完成頁（可下載／產生中／產製失敗）
  ├─ 文件停止、到期或完成 → 不影響，仍可下載
  ├─ 嘗試再次簽署 → 拒絕（重送同一 requestId 回既有結果）
  └─ 簽署人或文件被刪除 → 401 失效頁
```

## 稽核事件

沿用既有事件，不新增類型：

- `external_invitation.opened`：建立 session 成功時記錄；尚未開始、失效時不記錄。
- `document.opened`：`POST /api/external-signing-task` 時記錄；新增的 `GET /api/external-signing-task` 不記錄。
- 下載本人副本不記錄（與建立人、內部簽署人下載一致）。
