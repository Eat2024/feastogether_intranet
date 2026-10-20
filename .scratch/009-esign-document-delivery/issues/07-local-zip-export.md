# 07: 背景 ZIP 匯出與七天重用：本機儲存

**What to build:** 有效員工session可跨建立人查找文件、背景匯出既有副本，離頁後從歷史下載及續傳。

**Blocked by:** None (can start immediately)

**Status:** claimed

- [x] 固定已簽record快照，等待既有副本、不重繪不漏檔。
- [x] 本機串流ZIP64，安全唯一檔名，全成果落檔並驗證後發布。
- [x] 七天從完成起算；不同員工重用同成果，新簽不混入，不延長期限。
- [x] 查找/申請/進度/歷史/retry/原生下載可用；Range及到期410正確。
- [x] 匯出只驗員工session不做RBAC；外部session不可用，不擴權其他管理。
- [x] 失敗同快照恢復、全域concurrency=1、maintenance清理；完成local測試。

**Spec:** 009 — 對應任務 T015–T019、T021–T027。以已確認規格、計畫及契約為準。


## 實作與驗證（2026-10-21，待 merger 驗收結案）

- 已實作正式跨建立人查找／申請／歷史／詳情／retry／原生 ZIP 下載；本次僅有效員工 session，不增加 RBAC，其他管理操作仍維持建立人限制。
- 固定簽署 record 快照、等待既有副本、明確來源失敗、逐份 SHA-256 校驗、STORE ZIP64 串流、本機 atomic rename、租約 fencing、全域 queue concurrency=1、七天共用與到期清理。
- 新增 migration `LocalZipExports1792454403000`；沿用既有表，未新增環境設定或 scheduler。加入 archiver 7 及相符型別；PrivateFileStorage 保留既有 PDF/PNG，S3 ZIP 由 08 接續。
- TDD 證據：storage 新能力先 red，再通過 6 項公開 storage 測試；API 路由 red404、worker red 未完成、retry 殘留 failureCode red 均已修正。風險測試集中在 `server/test/esign-export.e2e-spec.ts` 的公開 HTTP／真 worker／storage 邊界，未另建內部 collaborator mock 測試檔。
- MySQL/Redis 真實 e2e 3 項情境通過（每項含完整流程）：全拒／空資料409、拒簽排除、兩員工並發重用、Redis enqueue 故障補列、固定快照、新簽不混入、168小時及410、成果遺失503不重建、Range/If-Range/416、來源失敗後原快照retry、來源篡改與不可重試、舊 generation 不能發布、兩個真 worker 全域最多一個匯出及慢目的端有界讀取。
- 真 Chrome＋Next rewrite 驗收通過：非建立人查找及申請、離頁重整後歷史、原生 ZIP 下載及解壓內容、206/If-Range/ETag/private-no-store/nosniff、七天重用。合成資料；截圖 `/tmp/esign009-zip-browser.png`，執行器 `/tmp/esign009-zip-browser.cjs`。
- 整合 01–05 後：root build/lint 通過；server 98 suites／836 tests 通過；schema 6 tests 通過。lint 0 error，保留既有 warnings。專用測試 DB `feastogether_intranet_test_009_07`；schema 使用較短測試前綴與隨機 suffix，沒有降低 fail-closed。
- 明確交接：08 須擴充 S3 `onStaging` uploadId／abort／版本與孤兒清理。現有 `isReferenced` 對 failed job 的 staging 仍視為引用，可能保護已放棄 generation；依 root 指示交 08 改成 active generation 判斷。6000份／>4GiB／效能門檻仍由 09 實測，未在本票宣稱達標。
