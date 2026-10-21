# Spec 009 實作後驗證指南

本指南提供可重跑步驟；本輪實際結果見 [整合驗證紀錄](implementation-notes-integration.md) 及 [容量報告](performance-results.md)。部署 S3 容量仍待 ticket11，不以本機成績替代。本地 role／permission 已決定留待後續，本次驗證員工 session 與外部 session 的邊界。

## 前提與執行

在隔離測試環境準備 MySQL／Redis、測試 SMTP 信箱與 local 或測試 S3 bucket。依 server/.env.example 設定，不提交 secret；test DB 名稱必須以 `feastogether_intranet_test` 開頭。使用合成姓名、簽名與PDF，不複製正式個資。ZIP 所用 S3 bucket 必須保持 Versioning=Enabled；未啟用或 Suspended 的成果會 fail closed，所需版本讀刪／清理 IAM 見 [S3 紀錄](implementation-notes-s3.md)。

從 repository root：

```bash
pnpm install
pnpm -C server db:test:create
pnpm -C server test:schema
pnpm -C server test
pnpm -C server test:e2e
pnpm -C server test:e2e:security
pnpm -C server lint:check
pnpm -C server build
pnpm -C client lint
pnpm -C client build
pnpm build
pnpm lint
```

跨 package 實作完成後跑 root 驗證；不要為單純文件更新執行寫入式 lint。開發環境由 `pnpm dev` 啟動 HTTP／worker／client；測試資料建立與 migration 僅使用隔離資料庫，不把一般 migration:run 誤指正式資料庫。client 沒有 test script，以瀏覽器驗收補足，不宣稱自動測試完成。

## 情境矩陣

| 對應 | 步驟 | 預期 |
|---|---|---|
| US1 / FR001–005 | 混合內外部及純外部草稿；日期完整、單端、全空、過去日期；登出登入回填 | 原子保存，清除與未傳可區分；日期顛倒整筆不變，無邀請 |
| US2 / FR006–009 | watermark true/false；多頁、旋轉90/180/270、CropBox；舊副本 | true 每頁中文字樣，false 無水印，簽名／QR可用；下載與ZIP hash一致，舊檔不變 |
| US4 / FR022–026 | 內外部拒簽；200/201 code points；簽／拒並發、同request重送、截止與停止競態 | 單一終態及一筆拒簽證據；無假PDF；混合與全拒結案正確 |
| US5 / FR027–034,041 | 單人、多選、跨頁全部；混合內外部；跨文件ID；0 eligible | 只有符合資格外部收信；非法歸屬整批拒絕；同文件不合格列skip原因 |
| US5 日界線 | 可控時鐘 Asia/Taipei 23:59:59、00:00；兩批並發、舊批跨午夜待送 | 同日一人一次，午夜可新一次，舊批pending/processing不重排，真正dispatch日再驗 |
| US5 投遞恢復 | DB commit後入列失敗、SMTP明確拒絕、SMTP接受後kill worker | maintenance補列；明確失敗重試原明細；未知結果不盲寄，紀錄unknown |
| US5 憑證 | 原邀請＋提醒連結各走OTP；提醒寄後密文清空；補簽輪切換；已簽本人下載 | 不改原邀請digest；錯人／舊輪不能簽；已簽下載權不受ZIP七天影響 |
| US6 / FR035–040 | note 0/30/31 code points、取消／清空／並發；歷程查看 | 正規化保存，失敗保留原值；簽／拒顯示本人，寄信／產製仍系統，無管理資料外洩 |
| US3 匯出存取 | 有效員工session A匯出其他建立人文件；B取同成果；無session／外部session嘗試 | A/B皆可查找及下載，B不建新工作；無員工session者拒絕；不擴權改草稿、催簽或備註 |
| US3 快照 | 首次匯出後新增簽署、不同人再申請、完成後第7天前後 | 七天內同job及hash，清楚顯示舊快照；滿168小時回410，再申請新快照 |
| US3 缺檔 | 一位已簽副本未ready、永久failed、來源hash錯 | 等原副本，失敗不發布漏件ZIP；retry仍原名單 |
| US3 串流恢復 | >4GiB檔，下載一半Range續傳、錯Range、If-Range不符、session撤銷 | 206/416/200規則正確；每次授權；解壓數與hash一致；前端不建立整包Blob |
| Schema／cleanup | 舊資料升級、降版有rejected、worker中斷、到期刪檔失敗 | 不偽造舊快照，不破壞證據；降版拒絕不相容資料；cleanup可重試且不刪來源 |

## 6,000 份效能驗收

固定環境記錄：Node與DB版本、worker數、CPU/RAM限制、storage provider與網路、來源大小分布、頁數分布、同時簽署請求數與請求速率。以實際部署規格的隔離環境執行；未提供部署容量前不可用本機結果宣稱production保證。

測試至少6,000份合成完成副本，含文字型與影像型、不同頁數，至少一組ZIP>4GiB。第一輪 global export concurrency=1、逐份讀、STORE；比較DEFLATE1/6記錄端到端時間與bytes。只有量測支持才試有界預取2/4，不能只限制份數卻無bytes預算。

先建立相同正常簽署流量的基準，再開匯出；記錄受理p95≤5秒、簽署p95增幅≤20%、OOM/正常簽署失敗=0。觀測RSS、external Buffer、CPU、event-loop delay、DB鎖等待、S3/local吞吐及開檔數。確認記憶體不隨總PDF bytes線性增加。

完成全部來源hash比對、ZIP CRC及解壓份數／檔名唯一性；中途kill worker、斷S3、磁碟滿均不能發布半包。跨兩worker程序確認全域匯出仍最多1；下載中斷續傳驗證原hash。產出可重現的報告（環境、資料分布、時間、RSS峰值、失敗及差異），不在這份計畫預填測試成績。

## 實際測試與發布接點

跨故事 suite 為 `server/test/esign-document-delivery-security.e2e-spec.ts`（一般與 security 設定皆納入）；浮水印 HTTP 沿用 `core-esign-flow.e2e-spec.ts`。schema 前綴使用 `DB_MYSQL_DB=feastogether_intranet_test`，helper 會追加 UUID，避免資料庫名稱過長。

發布及回退順序見 [整合驗證紀錄](implementation-notes-integration.md)：先停舊 worker／寫入，再升 schema、新 worker、新 API/client；不混用不理解 reminder/rejected 的舊 worker。已有新證據禁止破壞性 down。local 新 ZIP 使用固定檔案版本偵測一般覆寫；不宣稱防底層 silent bit rot，也不每次下載全檔 hash。
