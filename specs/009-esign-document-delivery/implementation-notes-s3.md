# Ticket 08：S3 串流 ZIP

使用既有 private storage 與匯出 API／worker／正式畫面，不新增環境變數、migration、公開或 presigned URL。`@aws-sdk/lib-storage` 固定 3.1149.0，與現有 client-s3 版本相同，避免引入 peer 不相容。

- partSize 至少 16 MiB、queueSize=2；依 metadata 預估放大 part，且實際流量超過 10,000 parts 時失敗，不發布半包。預估僅用於 part sizing，不能送作 ContentLength。串流計算實際 SHA-256／bytes，成功 complete 後回傳 VersionId。
- generation key 先寫入既有 job staging；CreateMultipartUpload 回應後先寫 uploadId，才准 UploadPart。取消傳給來源 pipeline 與每個 SDK HTTP request；等待它們 settled 後 abort，避免 SDK abort race 提早返回。完整物件已在 S3 但 DB 尚未發布的 crash window，由 key/version 掃描清理。
- GET Range 與 HEAD 帶明確 VersionId。正常刪除使用指定版本；只知 generation key 的舊 staging，列出並刪除精確 key 的版本／delete markers，並 abort uploadId。來源 PDF 的 store(bytes) 行為保留。
- 既有 maintenance 每次只掃一頁版本、一頁 MPU（各最多 limit，且上限1000），保存游標，避免 active 第一頁永久阻擋後頁。只掃 `exports/`、只清早於門檻且無有效引用項目。不因 failed job 留著 staging JSON 就永久保留；有效 processing lease 必須與 staging generation 一致。

## 可重跑驗證

測試只使用合成內容、隔離 MySQL／Redis與 loopback Moto；沒有讀取 AWS credentials provider chain。Moto 為測試工具，未新增專案 Python dependency 或正式 endpoint 設定。

```sh
# 另建隔離 Python venv 並安裝 moto[server]==5.1.18，使 moto_server 在 PATH
PATH=/tmp/esign009-moto-venv/bin:$PATH pnpm -C server test:s3
PATH=/tmp/esign009-moto-venv/bin:$PATH DB_MYSQL_DB=feastogether_intranet_test_009_08 pnpm -C server test:s3:e2e
```

`test:s3:e2e` 需要 `.env.test` 的既有測試 MySQL／Redis，必須避開其他共用 Redis 測試同時執行。每次使用新的測試 DB suffix；schema suite 仍用短前綴。兩套 S3 tests 自動起停 loopback Moto，使用固定假的 local-only credentials及隨機 bucket，不連外部帳號。

- Adapter 真 HTTP：未知長度33 MiB、刻意錯的 expectedSize=1仍正確上傳、part前已有uploadId紀錄、實際hash/size、跨part Range／HEAD、來源throw／AbortSignal／staging DB錯誤／complete錯誤無半包或MPU；版本刪除與有界跨頁清理保護active／來源。
- API／worker：兩員工同快照、33 MiB既有副本→實際multipart ZIP→完成後可讀；七天重用、Range206／非法416／無session401；故障補列；maintenance 實際MySQL引用查詢讓failed/stale staging可清除、有效lease與來源保留。這項回歸先失敗再修正。
- 真 Chrome：以非建立人 session 經 Next正式匯出頁查找／申請／reload／原生下載33 MiB ZIP；unzip比對內容、Next代理206／If-Range200／ETag／private-no-store／nosniff、七天重用皆通過。臨時腳本 `/tmp/esign009-s3-zip-browser.cjs`、截圖 `/tmp/esign009-s3-zip-browser.png`；臨時fixture已還原，Next與Moto已停止。未新增client測試框架。
- 初輪 server 98 suites／837 unit tests 通過、server build/lint 0 errors（既有warnings）。整合後最終結果補於下方。

## 部署界線

ZIP 使用的既有 bucket 必須啟用 Versioning（`Enabled`），不可暫停；應由部署管理者設定並驗證，應用不自行改 bucket 設定。串流完成回應必須有非空、非 `null` 的 VersionId，否則清除 generation 並回報失敗，不發布下載成果。即使上傳期間切成 Suspended 也不能繞過這個完成時檢查。已有無固定版本的 ZIP 同樣不可下載或宣稱重用成功。此檢查不增加 GetBucketVersioning 呼叫或 IAM 權限，也不改既有 PDF `store(bytes)` 行為。

既有 S3 帳號需對來源／成果具備原有 Get/Put 權限；成果版本讀刪需 `s3:GetObjectVersion`、`s3:DeleteObjectVersion`，multipart清理需 `s3:AbortMultipartUpload`、bucket 的 `s3:ListBucketMultipartUploads` 與 `s3:ListBucketVersions`（prefix 限 exports/）。測試診斷的 ListParts 另需 `s3:ListMultipartUploadParts`。此處列出實作實際使用的操作，未替使用者修改任何雲端權限。

Moto 的 complete 會整包累積記憶體，**不拿它驗證 >4 GiB 效能**。本 ticket 證明本機 S3 協定與應用流程，沒有正式 AWS IAM、部署網路、S3大容量吞吐或記憶體保證；6,000份及>4GiB量測由 ticket09記錄可用環境的實測與未驗證部分。

## 整合後驗證

已合併整合分支 `9b88316`（含ticket06）。root `pnpm build`、`pnpm lint` 通過；server 99 suites／839 unit tests 通過。固定SDK版本後真HTTP adapter 6 tests通過，另包含單part及空串流、只給end的Range。永久API／worker S3 e2e為3 tests，Chrome臨時項目加跑後為4 tests；無schema變更。

最終記錄：`/tmp/esign009-08-final-build.log`、`/tmp/esign009-08-final-lint.log`、`/tmp/esign009-08-final-unit.log`、`/tmp/esign009-08-final-s3.log`、`/tmp/esign009-08-e2e-green.log`、`/tmp/esign009-08-browser.log`。root lint 0 errors；server仍有既有warnings。套件未新增AWS SDK peer不相容。
