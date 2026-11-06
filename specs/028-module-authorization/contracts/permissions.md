# 權限目錄與端點矩陣

本文件是028實作權限碼的單一設計來源，029只引用同一字串。module_key先只有esign、platform；正式catalog不含虛構測試子功能。權限全部是正向grant，不存在deny、階層或角色名稱特殊判斷。

| moduleKey | permissionKey | 範圍與初始角色 |
|---|---|---|
| esign | esign.document.read | 同部門列表／詳情／來源PDF；同仁及所有有效員工 |
| esign | esign.signing.read | 本人任務／簽署內容；同仁 |
| esign | esign.signing.submit | 本人簽署／拒簽；同仁 |
| esign | esign.signing.copy | 本人合法副本；同仁 |
| esign | esign.document.create | 建立文件；文件建立者／電子簽管理員 |
| esign | esign.document.manage | 自己文件的合法維護／發起／停止／補簽／提醒；文件建立者／電子簽管理員 |
| esign | esign.export.read | 一般匯出清單／歷史／進度／已產出檔下載，仍驗部門；文件建立者／電子簽管理員 |
| esign | esign.export.create | 一般匯出產生／Excel紀錄／重試，仍驗部門；文件建立者／電子簽管理員 |
| esign | esign.document.read-all | 搭配document.read放寬跨部門閱讀；電子簽管理員 |
| esign | esign.document.manage-all | 搭配document.manage放寬建立人及部門；電子簽管理員 |
| esign | esign.export.all | 搭配export.read／create放寬匯出部門；電子簽管理員 |
| platform | platform.authorization.manage | 授權管理；assignable=false，只有Super user |

受保護esign/colleague固定前四項。esign/document_creator初始含create/manage/export.read/export.create；esign/esign_admin初始含全部esign權限。員工effective permissions還會聯集同仁。初始化只建立缺少的一般角色，不重寫已調整的設定。Super user列出全部12項已登錄權限，但個人簽署仍因非employee資格遭拒。

role permission配置可選assignable權限，但跨範圍修飾能力缺對應base時不得儲存：read-all需read、manage-all需manage、export.all需export.read或export.create。這個依存驗證以該角色集合計算，避免可孤立的危險修飾碼；一般角色可自行包括基本read/signing能力，不影響全員同仁保證。

## 本人能力契約（029引用）

GET `/api/me/authorization`，FT_ESIGN_SESSION，Cache-Control:no-store。回既有envelope：

```json
{
  "success": true,
  "data": {
    "actor": { "kind": "employee", "userId": 123 },
    "modules": [
      { "moduleKey": "esign", "permissions": ["esign.document.read", "esign.signing.copy", "esign.signing.read", "esign.signing.submit"] }
    ]
  },
  "timestamp": "2026-11-04T00:00:00Z"
}
```

actor沿027：employee僅kind/userId；super_user為kind/displayName。modules與permissions按字串排序且去重，沒有能力的module省略。Super user回全部compiled modules與permissions。回應不帶role、其他員工、內部DB id、入口、帳號、cookie或token。讀取無副作用、不依賴Portal即時查詢；session失效401、DB或目錄不一致503，不能fallback全權限。功能不足403 AUTHORIZATION_DENIED，不把403當作重新登入。

029對應：`/forms`→esign.document.read；`/my-signature`→esign.signing.read；`/export-history`→esign.export.read。這是頁面進入能力，不代表內部所有按鈕能力或每筆資料範圍。

## 既有端點覆蓋矩陣

所有下列內部路徑均先經027 actor auth，再以下述能力及service資源檢查。多個能力採ALL；不同子能力分支必須在service依已驗證query／操作選擇，不能只靠controller寬鬆OR。全體route掃描測試要求每支明確Public／AuthenticatedOnly／RequirePermissions，缺宣告在readiness拒啟動；沒有DB API registry及啟動同步寫入。

| 現有controller／操作 | 必要能力 | 資源／actor限制 |
|---|---|---|
| Documents GET列表、GET詳情（一般view）、GET source-file | document.read | 部門／原建立人既有閱讀例外；有read-all允許跨部門；原始簽名／邀請憑證仍裁切 |
| Documents GET詳情 view=export | export.read | 同部門或export.all；不能以read能力取得Excel用資料 |
| Documents POST建立 | document.create | employee可信部門；super明確validated departmentCode |
| Documents PATCH、DELETE、PUT draftSave、PATCH draft-settings、PUT fields | document.manage | 原建立人或manage-all；所有草稿／工作鎖／狀態規則保留 |
| Documents POST initiations／reopenings／stoppages、GET reopening-invitations、PATCH signer note | document.manage | 原建立人或manage-all，保留簽署與通知資料最小化 |
| Documents POST signer completed-file/downloads | signing.copy | 明確改為employee且該signer為本人；不可由super或同部門繞過 |
| SigningTasks GET列表、POST任務開啟、GET source-file | signing.read | employee本人指派；super不能用全權限冒用 |
| SigningTasks POST signatures／rejection | signing.submit | employee本人、同意條款／狀態／期限與證據驗證 |
| SigningTasks POST completed-file/downloads | signing.copy | employee本人副本 |
| SignerCandidates GET org-chart／GET候選人／POST resolutions | document.manage OR document.create（二者任一） | 此處為明確any-of宣告；只回簽署人設定所需資料，不以讀文件能力取得全員目錄 |
| InitiationJobs GET latest／issues／input／detail、POST retries | document.manage | 依job.document與actor檢查原建立人或manage-all；不能用job actor取代document歸屬 |
| NotificationBatches POST／GET列表／GET detail | document.manage | 原建立人或manage-all，保留期限／節流 |
| Exports GET exportable-documents／GET job／GET files | export.read | 同部門或export.all，下載時重驗 |
| Exports POST exports／retries／export-downloads | export.create（產生／重試）；export.read（現成檔下載記錄） | 依實際分支明確分類；同部門或export.all |
| ExportHistory GET列表／GET :id/document／POST :id/downloads | export.read | 同部門或export.all；pdf本人副本仍額外驗本人，不因歷史路徑放寬 |
| ExportHistory POST Excel紀錄 | export.create | 同部門或export.all；保存實際actor |
| 本人能力、session read/logout | AuthenticatedOnly | 明確接受employee／super，不要求可指派權限 |
| 授權管理所有API | SuperUserOnly＋platform.authorization.manage | actor種類必為super_user，不能由role取得 |
| 外部Email簽署、公開驗證、OAuth／WebView pre-session、health | 各自既有Public規則 | 不套員工同仁，不因Super user cookie取得外部憑證資格 |

保留既有路徑與HTTP語意，不為權限重命名draftSave等既有契約。一般匯出與本人副本分開：全文件合法一般匯出可依export權限產生；指向某signer個人副本的入口只給本人，包含既有departmentFile與pdf歷史重下載。詳細檔案完整性驗證一律保留。
