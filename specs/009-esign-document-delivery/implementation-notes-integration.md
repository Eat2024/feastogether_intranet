# Ticket 10：跨故事整合驗證

後續已依使用者要求納入 Spec007 補簽，更新範圍與驗證見 [補簽整合紀錄](reopening-integration.md)。PR 最終只交付後端；以下 Ticket10 的 client／Chrome 內容僅是開發期原型驗證紀錄，相關 client 程式已移除，不代表本 PR 已完成前端串接。

日期：2026-10-21（Asia/Taipei）。基線 `c1fe44b`，工作分支 `009/10-integration-delivery`，整合分支 `feature/009-esign-document-delivery`。本紀錄涵蓋本機驗證；Standards／Spec 最終 review 由整合分支另執行，ticket10 在該步完成前仍 claimed。部署 S3 容量門檻見 ticket11，T028 不勾選。

## 修正與紅綠驗證

1. 全拒／混合文件若 finalization queue 入列失敗，maintenance 原本只選全員 signed，導致永遠停在 finalizing。正式 HTTP 拒簽 + queue 邊界注入失敗 + 新 WorkerModule maintenance 的測試先得到 finalizing（失敗），修正 candidate 為「沒有 pending，也沒有尚未 ready 的 signed」後 completed。混合案例亦保留已簽 PDF 原 bytes。
2. 兩位不同外部本人拒簽時，MySQL REPEATABLE READ 在文件鎖前的普通查詢建立舊 read view，第二人看不到第一人已提交結果。真 DB 文件鎖 barrier 固定 A 先鎖、B 到達等鎖，再釋放 A；修正前雙拒後文件仍 active，修正後 finalizing，再由新 worker 完成。只把 immutable document identity lookup 移至交易外，鎖內重新驗本人、狀態與資格。
3. local 新 ZIP 使用既有 objectVersion 保存檔案 metadata fingerprint（device/inode/size/mtime/ctime，SHA-256 opaque 值）；stat 與 open 的同一 file descriptor 驗版本，偵測同長度改寫並回503，不偷偷建立新快照。測試先失敗後通過，Range 同樣受保護。舊 store(bytes) PDF 不新增版本、不重繪或覆寫。

檔案 metadata fingerprint 不是內容校驗碼；來源與 ZIP 建立時仍計算真正 SHA-256。它可偵測一般覆寫／替換／截短，但無法偵測底層不改 metadata 的 silent bit rot，亦非防惡意 filesystem 管理者機制。S3 成果固定 VersionId；儲存層自身耐久性／checksum 仍由部署保證。避免每次 Range 預先全讀數 GiB。備份搬移 local ZIP 後 metadata 改變會 fail closed，需保留原來源並等待七日期限後重新申請；不得修改既有 job hash 或私自延長期限。既有沒有 objectVersion 的 local 成果維持尺寸檢查。

## 跨故事公開接縫

新增 `server/test/esign-document-delivery-security.e2e-spec.ts`，納入一般 e2e 與 security 設定：

- 真 upload → draft-settings（內外部名單／期間／watermark=true／allowReject=true）→ initiation → 真簽名 → 個人 PDF → 背景 ZIP。ZIP central directory 獨立解析，唯一 entry bytes 等於個人下載；已拒及 pending 不納入。浮水印中文與各頁視覺／QR 已由 ticket02 的真 renderer 驗證，不以此 byte 比對代替視覺驗收。
- 混合 v3 及全簽 v2 的真結案 manifest、audit root、payload hash、來源／副本 metadata，經 note 保存／清空、通知歷史讀取、匯出／重用及重送結案後完全不變，公開驗證仍成功。全拒正式流程的 exports 回409。
- 有效員工 B 可以申請 A 文件 ZIP；相同 B 不可改 draft/note/reminder 或讀通知批次。新增寫入驗無／錯 Origin、未登入、有效外部 cookie；所有匯出讀寫入口都拒絕外部 cookie、未登入，錯文件／工作／檔案歸屬404。GET 不新增 export job 或 audit。
- 同文件外部 A 不能以自己的 cookie 拒簽 B；pending／rejected 本人 DTO 不含 synthetic note sentinel 或 B 身分。已排提醒在本人拒簽後由 worker skipped，不當作已寄送。其他 reminder 重放、午夜、原邀請／提醒 OTP、unknown/failed、密文清除由既有13項 reminder e2e 與 worker/service tests 回歸。
- 同長度 ZIP 改寫後 GET Range／POST 重用503，原 id／到期時間不變；不因成果不可用重跑。

## 驗證紀錄

實際環境：Node v26.4.0、MySQL 8.4.11、Redis 8.8.0、macOS；不宣稱 Redis 7 或部署 S3 已驗證。測試 DB 使用受保護的 `feastogether_intranet_test*` 名稱；schema suite 使用短前綴並由 helper 追加隨機 UUID。合成 HR／fake SMTP 不寄真實信件。

- server unit：99 suites／841 tests 通過。
- server e2e：17 suites／130 tests 通過（含新增整合3項、拒簽5項）。
- security：7 suites／34 tests 通過（整合 suite 亦在此重跑）。
- schema：2 suites／6 tests 通過。
- root `pnpm build`：server Nest 與 client Next 16 Turbopack production build 通過。
- root `pnpm lint`：server lint:check 與 client lint 通過，server warnings 保留（0 errors），沒有新增 client warning。
- 沒有新增 client 測試框架；各 ticket 的真 Chrome UI 驗收見既有紀錄，本輪新增的是正式 HTTP/worker 整合回歸，沒有把內部原型宣稱完整串接。

6,000 份／>4GiB／兩 worker／SIGKILL／Range 與相同負載 p95 實測見 [performance-results.md](performance-results.md)。本輪 local version metadata 增加每份 ZIP 完成一次 stat、下載前固定成本 stat，不重跑完整容量 benchmark；部署 S3 的容量／IAM／網路仍未提供，ticket11 ready-for-human、T028 未完成。

## 41 條 FR 對照

| FR | 實作／驗證依據 |
|---|---|
| 001 | draft-settings e2e：混合及純外部名單 roundtrip |
| 002 | draft-settings e2e：完整／單端／null／省略日期 |
| 003 | draft-settings：交易回滾、非建立人、發起競態 |
| 004 | draft-settings：不發起、不寄信；正式發起驗完整設定 |
| 005 | ticket01 真 Chrome 洛杉磯時區、台北回填 |
| 006 | completed-pdf service true/false；正式 API 固定 payload |
| 007 | ticket02 八頁真 renderer、四種旋轉 QR 與 OFL 字型 |
| 008 | completion／verification 回歸；本輪 v2/v3 證據不變 |
| 009 | 本輪真水印個人 PDF 與 ZIP entry bytes 相等 |
| 010 | export e2e＋本輪跨建立人有效員工／外部拒絕 |
| 011 | export e2e 固定簽署／版本快照、新簽排除 |
| 012 | 本輪 signed/rejected/pending 組合唯一 ZIP entry；全拒409 |
| 013 | export e2e pending／failed／缺檔修復／來源 hash |
| 014 | ticket09 local 6,000／5.815GiB 通過；部署 S3 尚待 ticket11 |
| 015 | ticket09 STORE/DEFLATE 實測，單一 ZIP64 6,000 唯一 entry |
| 016 | export service／worker／HTTP 狀態與進度、失敗資訊 |
| 017 | storage 完成後 fenced publish；entry hash／CRC 獨立驗證 |
| 018 | ticket07/09 enqueue、lease、真 SIGKILL、同快照重試、cleanup |
| 019 | export e2e 168h 邊界、跨員工重用、Range；本輪毀損503 |
| 020 | ticket09 真兩程序 global=1／正常簽署 p95；部署門檻未完成 |
| 021 | export DTO 安全裁切／本輪錯歸屬與員工 session |
| 022 | 草稿＋initiation 固定 allowReject，內外本人 DTO |
| 023 | rejection unit/e2e：本人、期間、Unicode 200、留白/null |
| 024 | rejection terminal／download 拒絕；本輪拒後提醒 skipped |
| 025 | 全拒／mixed maintenance 恢復及兩人鎖競態；signed ready predicate |
| 026 | 同人簽拒並發／同 request 重送；本輪不同人並發 |
| 027 | reminder13 e2e、ticket06 真 Chrome 多選／全部23人 |
| 028 | 本輪管理邊界；reminder DB 交易及入列恢復 |
| 029 | reminder13：去重／跨文件全拒／mixed skip／0 eligible |
| 030 | worker unit/e2e 寄前停用；本輪寄前本人拒簽 |
| 031 | mailer／worker 資料最小化與 fake SMTP 測試；note 不在 payload |
| 032 | notification invitation/reminder 分頁、attempt history／unknown |
| 033 | reminder service 台北午夜／in-flight、HTTP 並發與重放 |
| 034 | notification status unit、前端批次結果與輪詢真 Chrome |
| 035 | signer-management e2e／mapper＋管理 UI |
| 036 | signer-management note 0/30/31 Unicode、trim／清空／重整 |
| 037 | 本輪 note 不在本人視角，v2/v3／PDF 證據不變 |
| 038 | mapper 事件 actor 類型；signer-management 歷程身分 |
| 039 | ticket04 真 Chrome 拒簽頁籤／實際 xlsx；本輪 ZIP 排除 |
| 040 | 既有 security／本輪 session、Origin、跨人、敏感 sentinel |
| 041 | reminder mixed internal skip、all_pending 外部限定／UI 人數 |

## 發布、回退與未完成界線

- Client：本 PR 不修改 client，維持 `dev` 的 mock store 原型。草稿設定、拒簽、備註／歷程、催簽、補簽及 ZIP 匯出正式串接均由獨立前端 PR 交付。
- Server：既有 worker 新增 export queue，並擴充 reminder／拒簽結案；既有 maintenance 負責補列／清理，沒有新排程或新環境變數。新增依賴與授權字型見 ticket02/07/08。
- Migration：依序 `1792454400000`（草稿）、`1000`（拒簽）、`2000`（通知）、`3000`（匯出）、`4000`（備註）；全部修改既有表，schema.sql 同步。先備份、停止新寫入入口及舊 worker 消費，套用 migration，再部署新 API 與 worker（含字型 assets）。禁止舊 invitation worker 消費 reminder；舊 finalizer 不理解 rejected。不是滾動混跑相容承諾。
- 已跑 migration 升級／metadata no-drift／reapply 與單端草稿、拒簽、通知、匯出 down 保護；沒有在正式環境演練 rollout 或復原。若已有新證據，down 會拒絕破壞性回退；先停止新流量與 worker，使用相容修正版本向前處理，不能刪 rejected／提醒／快照資料硬降版。個人 PDF 與既有 manifest 永久保留。
- 未部署、未寄實際郵件。未新增 role/permission 或內部催簽；Spec007 補簽後端已合併。部署 S3 容量驗收仍是公開未完成工作。
