# 03: 完整大量與混合名單背景發起

> **範圍修訂**：只改後端，依 [最新範圍](../../../specs/022-background-signature-initiation/backend-only-scope.md) 與更新後 tasks 執行。下列原前端 UI／輪詢／畫面還原驗收暫緩，不得修改 client；改為對應 API 驗收及既有 client 相容性 smoke test。key 選填，queued／processing 必須阻擋文件與簽署人異動並回固定 worker 執行中訊息。


**What to build:** 建立人一次提交完整內外部名單，由背景分批查核並整份正式發起，不必拆文件或因缺信箱刪掉簽署人。

**Blocked by:** [02 單人背景發起完整流程](02-background-initiation.md)

**Status:** claimed

**Spec:** [022 規格](../../../specs/022-background-signature-initiation/spec.md) — US1；FR-001、003、007、010、013–015；SC-001、002、005、007。

**Tasks:** [T012–T015](../../../specs/022-background-signature-initiation/tasks.md)。精確實作位置與約束見 tasks／plan，不複製整份規格。

**執行約定:** 前置票皆 resolved 才可開始；開始改 claimed。使用 `feat/022-background-signature-initiation` 作整合分支，驗收通過且整合後才改 resolved，追加驗證與 commit 紀錄並保留原驗收條件。測試只用隔離合成資料，不部署、不建立遠端 issues／PR。

## 驗收條件

- [x] 1／100／101／5,001／6,001、混合名單與全外部均走背景；移除 helper 6,000 總數守門，不截斷、不引入同步門檻。
- [x] 500 人一批本機查核，鎖內重驗員編映射、帳號與建立人資格；缺帳號整份失敗，缺信箱及白名單只影響通知。
- [x] 250 筆一批寫入但同一正式交易提交；快照順序與全部指派數正確，無部分發起、重複 audit 或初邀批次。
- **原 UI 驗收暫緩／後端部分仍適用：** 正式交易前提交 committing 階段供輪詢，但成功必須等完整 commit；微秒版本及原檔 metadata 鎖內重核。
- **原 UI 驗收暫緩／後端部分仍適用：** 前端送完整名單、既有去重與外部正規化保留，Network 無前置逐批 resolutions；容量與中途失敗回滾驗證通過。

## 實作與驗證紀錄

開始實作並完成本票驗收；狀態保持 claimed，待整合後由 merger 結案。

## 本輪後端補充驗收

- [x] 不修改 client；既有無 key 發起可受理，API 仍正確區分受理與完成。
- [x] 本票涉及異動時，queued／processing 拒絕文件或簽署人修改並回固定 409 worker 執行中訊息；其他權限與終態規則不放寬。

## 實作紀錄（2026-11-03，impl/022-03）

- 基準 `bf36b658`，前置 01／02 已 resolved；本票沒有修改 client、schema、環境變數定義或排程。
- 移除本機信箱 helper 的 6,000 人總數守門，保留格式、資格、使用者升冪鎖序與既有 500 人 repository 批次。
- worker 每 500 個輸入逐批查核內部 userId／employeeNo，保留完整內外部順序及本輪 processedCount；預查捕捉員編映射，正式 users→document→job 交易再次核對，沒有每批 commit。
- 每批與階段更新以 lease／期限 CAS；committing 在正式交易之前單獨提交，GET 摘要可見而不提前宣告成功。獨立 heartbeat、有限重試及 maintenance 仍由票 05 完成。
- 原檔版本的微秒 timestamp 與 metadata 改為 current read；即使正式交易已有 RR 舊快照，也能拒絕外部原檔識別變動。
- 真實 DB／HTTP 容量案例完整驗證 1／100／101／5,001／6,001，包含重播後唯一指派／初邀／audit、確認名單順序、全外部／混合名單、缺信箱、實際通知 processor 白名單跳過、名單第二批缺資料、預查後身分變更、建立人停用與跨批寫入後全回滾。

### 驗證

- TDD：新增 6,001 人 helper 測試先因原上限 422 失敗，移除上限後 15／15 通過；committing 可讀性案例先失敗，再補 CAS 階段與批次查核後通過。
- 容量＋票 02 受理回歸：2 suites／23 tests 通過；進一步將原檔變更案例加強為 RR 快照競態，該案例單獨重跑通過。
- server build 通過；lint 0 errors／272 既有 warnings，新增檔案無 warnings。完整單元另由提交 hook 執行並於交接回報。
- 專用 MySQL localhost:13322，DB `feastogether_intranet_test022_t03`；Redis localhost:16322 DB3，避免不同票的 DB 流水號碰撞同 queue ID。只有合成資料／fake mail，容量 fixture 清除自身文件、指派、audit、通知、工作、queue 工作及檔案。
- 未修改前端：既有無 key userId/email body 可受理，但前置 resolutions 與 flash=published 的已知限制仍存在；本票不宣稱已提供進度畫面或取消前置解析。
- 受理 P95 20 次量測、混合排隊與延遲復原等整體驗收留票 08，不以本票一次執行時間冒稱完成效能門檻。
