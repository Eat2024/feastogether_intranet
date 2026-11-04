# Data Model — Spec 025

## 持久資料（沿用）

| 來源 | 欄位／資訊 | 用途 |
|---|---|---|
| esign_documents | id、docNumber、title、createdByUserId、status | 原有列表項目身分與正式狀態 |
| esign_documents | signStartAt、signEndAt | 正式簽署／既有草稿期間，不為摘要預寫 |
| esign_initiation_jobs | id、documentId、activeDocumentId、status | 關聯文件與唯一有效工作 |
| esign_initiation_jobs | totalCount | 本次正規化受理名單的預計人數 |
| esign_initiation_jobs | inputJson.signStartAt／signEndAt | 本次受理確認期間，ISO UTC |
| esign_signers | 既有正式統計 | 成功後顯示及簽署授權來源 |

不新增 entity、table、column、index 或 migration。有效工作輸入在 queued／processing 期間不可被保留清理清除，沿用既有約束。

## 列表衍生模型

`initiation: { signStartAt: string; signEndAt: string; totalCount: number } | null`

- 只在文件 draft 且有效工作 queued／processing 時有值；totalCount 為正整數，日期為 normalize 後的有效 ISO 值且 start < end。
- 不含 job ID、名單、租約、問題明細及 JSON 全文。
- repository 內部允許捕捉 job ID 以關聯無排序日期投影，mapper 不對外輸出。
- 原 pendingCount、signedCount、signStartAt、signEndAt 維持原正式／草稿語意；client 在 initiating 時用摘要決定列表顯示與日期篩選。
- 原檔版本、文件 updatedAt、草稿設定不因列表摘要額外寫入。

## 狀態與顯示

| 文件／工作 | 對外狀態 | 摘要 | 畫面期間／計數 |
|---|---|---|---|
| draft，無有效工作 | draft | null | 原草稿資料 |
| draft，queued | initiating | 有 | 確認期間、0/N |
| draft，processing | initiating | 有 | 確認期間、0/N |
| draft，重試 queued | initiating | 有 | 同一確認期間、0/N |
| draft，最終 failed | draft | null | 原草稿資料 |
| 正式成功 | 既有狀態推導 | null | 正式期間與實際計數 |

正式成功可能隨期間推導為其他既有狀態，不強制一律 active。通知失敗不改此狀態表。使用相同讀取快照保持摘要與正式資料的邊界。

## 建立時間顯示

沿用文件 createdAt（既有列表欄位），代表原始建立時間。列表以 Asia/Taipei 顯示 YYYY/MM/DD HH:mm；不新增衍生儲存值，不因工作受理或完成而改寫。
