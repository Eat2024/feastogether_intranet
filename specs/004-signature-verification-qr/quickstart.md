# Quickstart: 簽章驗證 QR Code 驗收

> **2026-10-18 合併註記**：下方原執行紀錄保留為歷史；涉及 receipt、document finalization lease、manifest v1 或單一 final_pdf_sha256 的設計已由 Spec 03 個人副本 CR 取代。現行模型見本目錄 data-model.md 與 contracts/openapi.yaml；驗證採 signer lease、個人完成檔與 manifest v2。前端仍由獨立 PR 交付。

## 1. 前置條件

- Spec 03 的 HTTP server、BullMQ worker、MySQL、Redis 與 Client 已可依 `specs/003-core-esign-flow/quickstart.md` 運作。
- UAT 驗收前清除功能上線前建立的測試文件；上線前已結案的文件不會有驗證快照或 QR。
- 準備 iOS 與 Android 手機各一支，以及可 100% 比例列印 PDF 的印表機。
- 第 6 節掃描後的畫面需要前端工程師提供的 `/verify/[code]` 驗證頁；該頁完成前，只能以 API 回應驗收第 6 節。

## 2. 環境設定

套用本規格新增的 migration（`esign_signature_records.verification_code`）：

```bash
pnpm -C server migration:run
```

本規格不新增環境變數；驗證網址使用既有 `EXTERNAL_SIGNING_ORIGIN`。

## 3. 自動化驗證

```bash
pnpm -C server lint:check
pnpm -C server test
pnpm -C server build
pnpm -C server test:e2e
pnpm -C server test:e2e:security
pnpm build
pnpm lint
```

## 4. User Story 1：簽署後取得驗證網址

1. 建立一份含員工 B 與一名 external signer 的文件並發起。
2. 員工 B 簽署成功，確認簽署回應含 `verificationUrl`；以相同 `requestId` 重送，網址相同。
3. Creator 查看詳情：員工 B 有 `verificationUrl`，external signer 為 null。
4. External signer 簽署成功後，其回應與完成狀態都含相同 `verificationUrl`。

預期：網址形如 `{EXTERNAL_SIGNING_ORIGIN}/verify/<22 字元>`，不含姓名、Email、員編或文件資訊。

## 5. User Story 2：完成 PDF 與驗證快照

1. 兩人都簽署後保持 worker 運行，等待文件 completed。
2. 下載 completed PDF，確認每個簽名欄位右下角都有 QR，簽名不與 QR 重疊；放大後 QR 仍清晰。
3. 檢查 DB。

預期：

- 該文件恰好一筆 `esign_verification_records`，`status = valid`、`issued_at` 等於 `completed_at`。
- `final_pdf_sha256` 為 NULL；manifest v2 的每人 `completedPdfSha256` 等於對應 record-owned completed PDF file object 的 `sha256`；`audit_root_hash` 等於 `document.completed` 事件的 `event_hash`；`manifest_sha256` 可由 canonical manifest 重算。
- Manifest 不含姓名、Email 或員編。

## 6. User Story 3：公開查驗

1. 將 completed PDF 以 100% 比例列印，用 iOS 與 Android 手機相機掃描每個 QR，確認開啟 `/verify/{code}` 且顯示對應簽署人。另準備一份同一頁有十位以上簽署人的文件一併列印掃描，記錄可穩定掃描的最小簽名欄位高度。
2. 以未登入、無 cookie 的瀏覽器開啟驗證網址：顯示簽署人完整姓名、簽署時間、驗證方式、文件標題、簽署當下原始文件摘要、文件狀態、完成時間與完成文件摘要。
3. 改動驗證代碼任一字元、改成其他長度、在代碼後多加路徑，以及格式正確但不存在的代碼，都得到相同的 404 內容。
4. 在 DB 測試環境竄改驗證快照的 `manifest_json` 或 `final_pdf_sha256`，查詢得到 409 驗證失敗，不顯示為有效。
5. 對已停止文件中已簽署者的驗證網址查詢，顯示簽章有效、文件已停止，且沒有完成文件摘要。
6. 同一 IP 在 60 秒內查詢超過 10 次（或 300 秒內超過 50 次），觸發 429。

預期：

- 驗證回應與瀏覽器 Network 不含簽名圖、Email、員編、部門、職稱、IP、User-Agent 或其他簽署人資料；回應不帶 `Set-Cookie`，`Cache-Control` 為 `no-store`。
- 查詢前後 `esign_audit_events` 與其他業務資料筆數不變；access log 不出現完整驗證代碼。

## 7. 不屬於本次驗收

- 文件層級公開驗證入口、驗證紀錄撤銷或取代
- 證據包、稽核報告、下載稽核或浮水印
- 公司憑證封存、可信時間戳記、PAdES-LT/LTA 或個人數位憑證
- 一般匯出（Spec 05）
- 上線前已結案文件的快照或 QR 回補
