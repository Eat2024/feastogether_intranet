# Spec 026：停用簽署歷程與文件事件稽核

日期：2026-11-04。狀態：已實作，尚未部署。沿用 PR #53 的分支。

## 決策與範圍

主管要求降低每次操作的資料寫入、文件鎖定與稽核鏈儲存成本，移除 `esign_audit_events` 及前端「簽署歷程」，以文件保存曾有的功能與恢復方式。此決策取代 Spec 003／004／007／008／019／025 中要求寫入或驗證事件鏈的部分；其他簽署、通知與下載功能維持。

不保留 no-op 寄存服務、不以另一張表或 application log 保存同一份事件流水帳。簽署證據 `esign_signature_records`、文件／簽署人狀態、通知明細、匯出歷史、驗證 manifest 與檔案摘要仍保留。

## 使用情境與驗收

1. 文件詳情沒有簽署歷程區塊，也不發出 history 請求；舊 history 路由移除。
2. 補簽 Dialog 移除只存歷程的原因輸入；舊客戶端的 reason 仍接受驗證但不保存，新客戶端省略。建立／發起／開啟／簽署／拒簽／到期／補簽／通知／OTP／副本產製不再建立稽核事件，也不為記錄事件額外鎖定文件。
3. 在不存在稽核表的隔離資料庫完成簽署、副本產製、全部簽署或含拒簽的結案及公開驗證，權限、OTP、簽署證據與檔案歸屬檢查仍生效。
4. 新驗證快照使用 manifest v4，只包含文件摘要、個人副本識別與摘要、簽署時間／驗證方式／條款版本及拒簽摘要，不建立假的 audit hash。
5. 舊 v2／v3 manifest 保留原始內容及其摘要，不改寫歷史。公開驗證仍比對 manifest 摘要、現存文件、本人簽署紀錄與完成檔 metadata；不再驗證已移除的事件鏈。拒簽項目對照現存簽署人狀態／時間／原因摘要。
6. API 與公開驗證頁明示驗證範圍為保存的簽署紀錄及檔案摘要，不宣稱具有事件稽核鏈驗證。不能把移除事件鏈後的保證描述成與原版完全相同。
7. 舊文件、簽署證據、通知紀錄、匯出歷史與檔案不被刪表 migration 更動。

## 成本與能力邊界

停用後不提供誰在何時開啟文件、OTP 事件或完整操作時間軸；不再提供可逐筆重算的事件鏈、事件順序與鏈完整性驗證。資料一致性驗證不等同獨立簽章或外部可信時間證明。本次不承諾未量測的效能提升比例。

## 曾有的資料格式

表定義及索引／外鍵完整封存在 [original-schema.sql](original-schema.sql)。主要欄位：

| 欄位 | 意義 |
| --- | --- |
| id | 追加順序流水號，查詢／鏈尾依 id 排序，不依事件時間 |
| document_id | 所屬文件 |
| signer_id | 可空的事件對象簽署人 |
| actor_user_id | 可空的員工操作者，系統與外部行為可無員工 |
| event_type | 事件代碼 |
| occurred_at | UTC 微秒精度事件時間 |
| previous_event_hash | 前一事件的 SHA-256；第一筆為 NULL |
| event_hash | 本筆鏈結 SHA-256，唯一索引 |
| request_id | 可空的請求追蹤 ID |
| metadata_json | 經白名單裁切的事件資料 |
| created_at | DB 寫入時間 |

`metadata_json` 曾允許 status、reason、consentVersion、errorCode（非空 trim 後最多 500 code points）；expiredAt、previousSignEndAt、signEndAt（合法 ISO UTC）；signatureRecordId、completedFileId（正整數）；remainingAttempts（非負整數）；completedPdfSha256（64 位小寫 hex）。不存 token、cookie、簽名 PNG 或任意輸入。

hash 算法：`SHA256((previous_event_hash ?? '') + canonicalJson(event))`。event 包含 actorUserId、documentId、eventType、metadata、occurredAt（ISO）、requestId、signerId；可空 ID／request 為 null，無 metadata 時省略。canonical JSON 遞迴排序物件 keys、省略 undefined、維持陣列順序、Date 轉 ISO。寫入時鎖文件並接續鏈尾；批次發起曾在同交易鎖內串接所有指派與發起事件。

舊 verification manifest v2／v3 包含 auditRootHash、每份副本的 copyCompletedEventHash，v3 拒簽項目另有 rejectionEventHash。`esign_verification_records.audit_root_hash` 改為 nullable，僅保留舊值作歷史參考；新 v4 不填。舊值只與原 manifest 的對應欄位做一致性比較，不拿來重建或驗證事件鏈。

## 遷移、部署與回復

- 新 migration 刪除稽核表；此步會永久失去該表資料。部署時先停止所有舊版 server／worker，再以既有備份流程保存一致的資料庫備份，之後執行 migration 並啟動新版，避免新舊程式混跑。沒有備份就無法恢復過去事件。
- 本任務只提交 migration，不在本機開發資料庫或 UAT 執行刪表；整合測試只用 `feastogether_intranet_test*`。
- 回滾程式前需恢復原表、資料與舊驗證相依。新 v4 期間沒有產生事件，不能補造為當時存在的證據。down 只在無驗證紀錄的空測試環境重建結構；有驗證資料時拒絕假裝完成回滾，需備份復原／前向修復。
- 未來恢復：以停用前 commit `50b48f1` 取回 entity、repository、EsignAuditService、history API／DTO／前端及原驗證實作；依本 spec 建新 migration，決定新鏈起點及歷史覆蓋範圍。還原 schema 不等於還原資料。
- 恢復時需測試事件 metadata 白名單、append 並行、批次鎖定、鏈中斷／竄改、結案／拒簽、公開驗證與資料隔離，並重新量測大名單寫入成本。

## 成功標準

- 所有正常操作不對稽核表發出 SQL，完整後端測試與刪表後端到端流程通過。
- 歷程不再出現在畫面；其他清單資料來源與顯示不變。
- API、UI、spec 對驗證範圍的說明一致，不把不存在的事件鏈當作驗證成功條件。

## 曾有的事件代碼

- `consent.accepted`
- `document.completed`
- `document.created`
- `document.draft_deleted`
- `document.draft_updated`
- `document.expired`
- `document.initiated`
- `document.opened`
- `document.reopened`
- `document.stopped_by_creator`
- `external_invitation.delivered`
- `external_invitation.opened`
- `external_otp.failed`
- `external_otp.locked`
- `external_otp.sent`
- `external_otp.verified`
- `external_reminder.delivered`
- `internal_notification.protocol_error`
- `internal_invitation.delivered`
- `internal_reminder.delivered`
- `signature.completed`
- `signature.submitted`
- `signer.assigned`
- `signer.copy_completed`
- `signer.copy_failed`
- `signer.rejected`


## API 與 manifest 格式備忘

已移除的 `GET /api/esign/documents/:id/history` 曾回傳以下陣列（全域 response envelope 的 data）。建立人可看管理事件；同部門非建立人僅可看文件層級事件，指派者額外可看自己的事件。不得恢復為全集團可看他人的個人行為。

```ts
type HistoryItem = {
  type: string;
  label: string; // 後端繁體中文對照，未知類型顯示「其他簽署歷程事件」
  occurredAt: string; // UTC ISO
  actor: { kind: 'signer' | 'employee' | 'system'; name: string; signerPublicId?: string };
  reason: string | null;
  signEndAt?: string;
  actorUserId?: string; // 僅建立人
  previousSignEndAt?: string; // 僅建立人
};
```

新 manifest（v4）的欄位如下。摘要值皆為 64 位 hex；ID 沿用現有資料型別。無拒簽時省略 rejected。manifestSha256 是完整 manifest 的 canonical JSON SHA-256，儲存在同一驗證紀錄。

```ts
type ManifestV4 = {
  schemaVersion: 'esign-verification-manifest-v4';
  document: {
    docNumber: string;
    sourcePdfSha256: string;
    signingPayloadSha256: string;
    completedAt: string;
  };
  signers: Array<{
    signerPublicId: string;
    signatureRecordId: number;
    completedFileId: number;
    completedPdfSha256: string;
    signedAt: string;
    authenticationMethod: string;
    consentVersion: string;
    documentSha256: string;
    signingPayloadSha256: string;
  }>;
  rejected?: Array<{ signerPublicId: string; rejectedAt: string; reasonSha256: string }>;
};
```

公開 `GET /api/signature-verifications/:code` 保留 signature、document 的既有白名單欄位，新增 `verificationScope: "stored_records"`。404／409 規則保留；驗證頁標題為「簽署資料比對一致」，說明不包含歷程／事件鏈驗證。補簽 `POST /api/esign/documents/:id/reopenings` 的 reason 改為可省略，提供時沿用字串及長度驗證但不保存；期限的並行檢查、權限及通知不變。
