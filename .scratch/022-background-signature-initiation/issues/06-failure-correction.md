# 06: 失敗名單恢復與安全人工重試

> **範圍修訂**：只改後端，依 [最新範圍](../../../specs/022-background-signature-initiation/backend-only-scope.md) 與更新後 tasks 執行。下列原前端 UI／輪詢／畫面還原驗收暫緩，不得修改 client；改為對應 API 驗收及既有 client 相容性 smoke test。key 選填，queued／processing 必須阻擋文件與簽署人異動並回固定 worker 執行中訊息。


**What to build:** 建立人重登入後仍能找回失敗名單、查看問題並修正；暫時故障可重試原輸入，回應遺失不產生第二個子工作。

**Blocked by:** [04 重整與重新登入後追蹤工作](04-progress-tracking.md)、[05 中斷後有限恢復且不重複發起](05-bounded-recovery.md)

**Status:** resolved

**Spec:** [022 規格](../../../specs/022-background-signature-initiation/spec.md) — US3；FR-005、006、008、011、018；SC-004、005、007、009。

**Tasks:** [T025–T028](../../../specs/022-background-signature-initiation/tasks.md)。精確實作位置與約束見 tasks／plan，不複製整份規格。

**執行約定:** 前置票皆 resolved 才可開始；開始改 claimed。使用 `feat/022-background-signature-initiation` 作整合分支，驗收通過且整合後才改 resolved，追加驗證與 commit 紀錄並保留原驗收條件。測試只用隔離合成資料，不部署、不建立遠端 issues／PR。

## 驗收條件

- [x] input 按需回原名單／欄位／期間／選項，不含內部檔案版本或 token；issues 只在 failed 可讀、offset 非負、limit 1–100 預設 100，外部項目只用 index。
- [x] 只有建立人能讀取或重試，非 failed issues 回 409，已清理明細回 410；來源樹消失員工仍顯示原員編供修正，不悄悄丟掉。
- [x] retry 新 key／新 job／parent 關聯，僅新受理檢查 latest failed、retryable、輸入保留、版本、有效建立人及期限；修改輸入用新的 initiation。
- [x] 同 key retry 先找既存 child；即使 parent 不再 latest 或 child 已 succeeded，重播仍 200 原 child，不再正式發起。
- **原 UI 驗收暫緩／後端部分仍適用：** 前端分辨修正與重試，回應未知保留 key；重整後完整還原、分頁問題、越權、版本競態與 retry 回應遺失驗收通過。

## 實作與驗證紀錄

2026-11-03，`impl/022-06` 基於 `fa81529c`，T025–T028 完成，維持 claimed 等待整合。

- creator-only input、failed issues 分頁、410 清理回應；外部問題只回索引／分類，輸入還原可回建立人原填信箱。查詢加 private/no-store。
- worker 收集每批問題及原員編，鎖內員工身分失效也對回 inputIndex；系統故障無人員問題可為 0。processedCount 計已查核項目，501 人含 1 問題為 501／issueCount=1，不產生部分指派。
- retries 使用 OriginGuard、必填新 UUID、空 body；users → document → job 鎖序，先查 child/key/parent hash 重播，才以 current read 驗 latest/failed/retryable/input/version/deadline。保留 05 heartbeat/recovery。
- 紅綠證據：input 路由缺失、issues 路由／實際問題缺失、retry 路由缺失、外部問題定位及鎖內停用問題定位各先失敗後通過；Origin 測試發現 guard 缺漏並補上。
- 隔離 MySQL `feastogether_intranet_test022_t06`、Redis DB6、合成檔案；pnpm frozen 安裝。新 retry 8 項，與 acceptance/query/capacity/recovery 共 5 suites／53 tests 通過；unit 113 suites／1,175 tests、server build 通過；lint 0 errors／272 既有 warnings。
- 未改 client、schema 或新增 config；07 的自動保留清理與08整體效能驗收仍由後續票完成，本票以合成已清理狀態驗證 replay／410。

## 本輪後端補充驗收

- [x] 不修改 client；既有無 key 發起可受理，API 仍正確區分受理與完成。
- [x] 本票涉及異動時，queued／processing 拒絕文件或簽署人修改並回固定 409 worker 執行中訊息；其他權限與終態規則不放寬。

## 整合驗收紀錄

- 實作 commit `eb4c8358dfb4c152d59ae800101c4aaba0708728` 已由 `impl/022-06` 無衝突合併至 `impl/022-integration`，merge commit `a1a20fd2af3e0f518e78310cb68430255edaed66`。
- 合併 hook：lint 0 errors／272 既有 warnings、單元 113 suites／1,175 tests 通過；實作五套 e2e 53／53（retry 8／8，含跨批 issues）、server build 通過。
- T025–T028 完成並整合，狀態改 resolved，07 可開始；無 client／schema 變更。


### 草稿版本完整性後續補修（2026-11-03，待整合）

- 真 HTTP 重現 failed 後只改 fields、signers、note 或同秒 title／period，舊 retry 仍被 202 受理；原因為子資料未觸及文件 dirty 欄位，及 ORM updatedAt 自動更新僅整秒。
- DocumentRepository.save 對既有 draft 先鎖讀原 raw 微秒值，save 後以窄 SQL 推進至 max(UTC now6, save前值+1µs, save後值+1µs)，再重讀回傳 entity 的 updatedAt。成功同值儲存也推進版本；此 SQL 是避免ORM／JS精度損失的必要例外，業務欄位仍save。
- 公開 fields.replace、draft signer note 在同一文件鎖／交易末touch；updateDraft與softDeleteDraft的窄UPDATE自身單調遞增。新建無舊版；正式core activate已active，不會在驗job後的buildFields中途touch而自我衝突。非草稿note不改正式文件版本。
- integrity新增12項API/DB驗收全過：PUT/PATCH fields、PDF、title、draftSave／draft-settings純名單、期間、選項、note、同秒dirty/no-dirty、busy／無效異動不提交、worker正式成功與軟刪。隔離MySQL session SET timestamp控制同秒，最後重設，不調全域時鐘。
- 專用 `feastogether_intranet_test022_integrity`、Redis DB11，無前端、schema或env新增；整體回歸結果於補修commit交付。

- 補修驗證：integrity／retention／retry／query／acceptance／capacity／recovery 共7 suites／72 tests通過；unit113 suites／1,175 tests、server build通過；lint0errors／272既有warnings。額外草稿設定舊suite有1個201→202期望待08遷移（其餘15項通過），本補修未改該檔。
