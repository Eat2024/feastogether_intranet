# Phase 0 Research: 簽章驗證 QR Code

## 1. 簽章驗證代碼

**Decision**: 每名簽署人一個驗證代碼，在簽署 transaction 內以 16 bytes 隨機值產生（base64url 22 字），寫入 `esign_signature_records.verification_code`（UNIQUE；Spec 04 上線前的紀錄為 NULL，不回補）；驗證網址為 `{EXTERNAL_SIGNING_ORIGIN}/verify/{code}`，只在簽署成功後對外提供。代碼產生、格式檢查與網址組合放在既有 `EsignTokenService`。

**Rationale**: 代碼只是參照，簽署時間、狀態與摘要一律從 DB 查，因此不含個資。128 bits 隨機值無法猜測或列舉；重送簽署請求讀回同一筆紀錄，得到相同網址。網址約 51–65 字，QR 為 version 4（33×33），比原本 Ed25519 token（139 字、version 8、49×49）在小簽名欄位明顯好掃。不需金鑰，也就沒有 HTTP server 與 worker 金鑰不一致、金鑰遺失或輪替讓已印出的 QR 全部失效的風險。

**Alternatives considered**: Ed25519 簽章 token 不落 DB（原設計，2026-10-16 實際印出後 QR 過密而改用本方案）；HMAC 截短 token（仍需金鑰，網址約 75 字）；直接以 signer `public_id` 當代碼（public ID 也出現在其他網址與 log，不宜兼作查驗憑證）；放在 `esign_verification_records`（一份文件一筆、結案才建立，無法在簽署當下發出，停止的文件也沒有）。

## 2. 公開驗證查詢

**Decision**: 新增獨立 `@Public()` controller 的 `GET /api/signature-verifications/{code}`，不讀任何 cookie、不設 cookie，回應加 `Cache-Control: no-store` 與 `Referrer-Policy: no-referrer`，並沿用既有 Redis throttler（`AuthThrottlerGuard`）與登入端點相同的視窗：每個 client IP 每 60 秒 10 次、每 300 秒 50 次，不新增設定。

查詢流程：

1. 檢查代碼格式（22 字 base64url）；不符時不查 DB。
2. 以代碼查簽署紀錄與簽署人，簽署人必須為 `signed`；文件不得為 draft 或已刪除。
3. 文件為 `completed` 時讀驗證快照：重算 canonical `manifest_json` 的 SHA-256 與 `manifest_sha256` 比對；`final_pdf_sha256` 必須等於 active `completed_pdf` file object 的 SHA-256；快照中本簽署人的項目必須與 signature record 一致；從第一筆事件重算 audit chain 至 `audit_root_hash`。
4. 回傳 FR-009 白名單欄位。

格式錯誤、查無資料或未簽署一律回同一個 404「查無此簽章或驗證碼無效」；比對不一致回 409 `ESIGN_INTEGRITY_FAILED`，並以結構化 log 記錄不含代碼的告警。整個查詢只讀，不 lock、不寫 audit。

**Rationale**: 驗證頁是任何人都能打的公開入口，若每次掃描都寫 audit，會讓任何人都能對文件 row 製造 lock 與寫入，並無限拉長稽核鏈，也違反 GET 不得產生業務寫入。逐次從 storage 讀回 PDF 重算雜湊會讓公開端點成為放大 I/O 的攻擊面；PDF bytes 的完整性已在結案與每次下載時重驗，查詢時比對 DB 中的快照、file object 與稽核鏈即可。統一的 404 避免攻擊者藉回應差異列舉簽署人。公司網路共用對外 IP 時，大量集中查驗可能觸發 429，屆時再依實際使用量調整。

**Alternatives considered**: 放在 `/api/esign/*` 下並加 `@Public()` 容易與員工 session 端點混淆；記錄每次掃描到 `esign_audit_events` 有前述鎖競爭與灌爆風險，需要時以應用程式 log 統計即可；每次查詢重算 PDF bytes 的成本與風險不相稱；另訂公開驗證專用限流設定，目前沒有使用量資料支持。

## 3. 文件驗證快照

**Decision**: Worker 結案的第二個 transaction（lease CAS 成功後）依序寫入 `completed_pdf` file object、更新 signers 與 document、append `document.completed`，再以該事件回傳的 `event_hash` 作為 `audit_root_hash`，組出 canonical `manifest_json`（版本 `esign-verification-manifest-v1`）並 insert 一筆 `esign_verification_records`：隨機 UUID v4 `public_id`、`manifest_sha256`、`final_pdf_sha256`、`audit_root_hash`、`status = valid`、`issued_at = completed_at`。任一步失敗整個 transaction rollback，沿用既有 finalization 重試。Manifest 只放文件 doc number、原始 PDF、簽署參數與完成 PDF 的摘要、完成時間、各簽署人的 public ID、簽署時間、驗證方式、同意版本與證據摘要，不放姓名、Email 或員編。本規格不對外使用 `public_id`，也不實作撤銷；快照只為功能上線後結案的文件建立，不回補。

**Rationale**: 既有 schema 已以 unique `document_id` 定義「每份完成文件一筆」的驗證紀錄，符合結案快照的語意，不需新表。與 completed 狀態同一 transaction 寫入，確保不會有已完成但缺快照的文件。`document.completed` 是結案當下最後一筆事件，以它的 hash 作終點可固定結案時的完整歷程。Manifest 是日後以公司憑證封存與加可信時戳的對象；在取得憑證前，它與其他資料同在 DB，主要提供一致性比對而非抗竄改錨點。

**Alternatives considered**: 回補上線前已結案的文件：快照資料雖可重建，但這些完成 PDF 沒有 QR，補 QR 須重新產生完成 PDF 而改變其摘要，等同改動證據；延後到取得憑證時再一次補寫：使用者決定現在就固定快照；在 manifest 放簽署人姓名：違反資料最小化，姓名可由 signer 關聯取得；另建 manifest 檔存 storage 並用 `verification_record_id` 關聯：本規格沒有下載 manifest 檔的需求。

## 4. 完成 PDF 上的 QR 版面

**Decision**: `CompletedPdfService` 在每個 signature 欄位內，沿用原型與簽署畫面佔位圖相同的版面：QR 邊長為欄位高度的 72%，貼齊欄位右下角並先畫白底；簽名圖在其左側剩餘寬度（扣除欄位高度 8% 的間距）內等比縮放置中。QR 內容為該簽署人的驗證網址，錯誤修正等級 M、無留白；以 `qrcode` 取得模組矩陣後用 `pdf-lib` 畫向量方塊，不嵌入點陣圖。Date 欄位不變。

**Rationale**: 與簽署畫面的佔位圖一致，簽署人看到的可用範圍就是最終版面；向量 QR 在任何縮放與列印解析度下都清晰，也不增加圖片處理。QR 屬於完成 PDF 的內容，因此完成 PDF 的 SHA-256 涵蓋 QR；驗證代碼保存在簽署紀錄，重試結案也畫出相同 QR。Spec 04 上線前的簽署紀錄沒有代碼，該欄位不畫 QR。

**Alternatives considered**: 嵌入 PNG QR 會在放大或高解析列印時模糊；把 QR 放在欄位外或另附頁面，與簽署畫面的佔位圖不一致。

**Risk**: 約 51–65 字元的網址對應 QR version 4（33×33 模組）。列印時每個模組建議至少 0.3 mm，QR 邊長約需 10 mm，相當於簽名欄位高度約 14 mm 以上（原 Ed25519 token 網址 139 字、version 8，A4 頁高 7% 的欄位實測模組僅約 0.31 mm，因此改為短代碼）。本規格暫不在發起時強制欄位高度下限；須以實際列印與手機掃描驗收最小欄位尺寸，不足時再決定是否訂定下限（會影響前端欄位編輯器）或縮短驗證路徑。

## 5. Client 原型的處理

**Decision**: 以下 Client 變更由前端工程師依 contract 實作，不在本規格工項。移除原型在簽署前以 `crypto.randomUUID()` 產生 `signatureIds` 並畫 QR 的做法。簽署畫面的 `SignatureQr` 改為示意簽名可用範圍的佔位圖；簽署成功後，以 Server 回傳的 `verificationUrl` 產生 QR 顯示。公開驗證頁 `client/src/app/verify/[code]/page.tsx` 由前端工程師提供，不在本規格工項；本規格提供的 contract 要求該頁不使用 `(main)` layout 與 session，呼叫同源 `/api/signature-verifications/{code}`，呈現有效、查無、驗證失敗與查詢過於頻繁等狀態，時間以台北時間呈現，且只顯示 API 回傳的欄位。

**Rationale**: Client 產生的識別碼無法被 Server 信任，違反 Server 權威；佔位圖保留簽署人對版面的預期而不提前發出驗證碼。公開頁與外部簽署頁一樣不接觸內部 session，避免公開入口取得內部能力。

**Alternatives considered**: 保留 Client 識別碼並由 Server 收下保存：仍需新增欄位，且識別碼來源不可信；驗證頁直接由後端回 HTML：與既有 Client 頁面元件與樣式不一致。
