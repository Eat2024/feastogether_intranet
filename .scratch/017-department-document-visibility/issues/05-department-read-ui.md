# 05: 部門列表與前端唯讀檢視

**What to build:** 前端使用部門列表並依 isCreator 呈現草稿及文件唯讀畫面，封住直接進入編輯頁的操作。

**Blocked by:** [04](./04-department-read-api.md)

**Status:** resolved

**Spec:** [Spec 017](https://github.com/Eat2024/feastogether_intranet/blob/a827699743ccf306900f33a05064c76f954c13b0/specs/017-department-document-visibility/spec.md)；US1；FR-005/006/008；SC-001/003/004。

**Tasks:** T017、T018、T019、T020、T021；[原始清單](https://github.com/Eat2024/feastogether_intranet/blob/a827699743ccf306900f33a05064c76f954c13b0/specs/017-department-document-visibility/tasks.md)。

**執行約定:** 遵循 [切分索引](../README.md) 的共用約定；前置 tickets 皆 resolved 才可開始。開始改 claimed，驗收通過且合併功能整合分支後改 resolved，追加驗證命令、結果與 commit，保留原驗收條件。

## 驗收條件

- [x] 列表固定 role=dep，API 型別對齊判別 DTO；建立人／文件名稱、日期、狀態、排序及分頁保留且只作用於授權集合。
- [x] 非建立人可檢視草稿與已發起文件、來源與必要進度；不 mount 通知歷史、備註 mutation、催簽與補簽管理元件。
- [x] 非建立人直接進 /edit、/signers 導回唯讀頁且不進可寫 editor；管理按鈕受限，匯出資格留給 ticket 08，不以 isCreator 推定。
- [x] 重跑 T011／T012、雙帳號 UI 與日期搜尋案例，client lint/build 通過，validation.md 留存資料裁切及無管理副作用證據。

## 原始任務範圍

- [x] T017 [US1] 在 `client/src/api/types/esignDocuments.ts` 對齊 dep 與 isCreator 判別 DTO，更新 `client/src/features/esign-documents/DocumentsListView.tsx` 固定 role=dep；保留 `client/src/features/esign-documents/listQuery.ts` 的原關鍵字／日期／狀態邏輯，不新增後端搜尋 API。
- [x] T018 [US1] 修改 `client/src/features/esign-documents/DocumentRowActions.tsx`、`DocumentsTable.tsx`，讓非建立人可進草稿與已發起文件的檢視，但不能顯示修改／發起／停止／補簽／刪除操作；匯出按鈕留待 US4 以部門授權串接，不能以 isCreator 當匯出資格。
- [x] T019 [US1] 修改 `client/src/features/esign-documents/DocumentDetailView.tsx` 與 `DocumentSignerTable.tsx` 呈現唯讀 DTO；非建立人不 mount `NotificationHistory.tsx`、備註 mutation、催簽與補簽邀請控制，保留來源預覽與必要進度，避免先讀取敏感資料再 UI 隱藏。
- [x] T020 [US1] 在 `client/src/features/esign-documents/DocumentEditView.tsx`、`DocumentSignersEditor.tsx` 加建立人判斷，直接進 /edit／/signers 的同部門非建立人導回唯讀頁，不進可寫 editor；確認 backend mutation 一律仍驗證建立人與文件狀態。
- [x] T021 [US1] 執行 T011／T012 及 `specs/017-department-document-visibility/quickstart.md` 的前端雙帳號／日期搜尋／草稿檢視案例，於 `specs/017-department-document-visibility/validation.md` 記錄 isCreator、隱私欄位及無管理 side effect 驗收；client 跑 lint/build。

## Ticket 05（T017–T021）與 08 client 提前整合

- client lint／build通過；無新增測試框架或dependency。
- 以原始碼臨時副本啟動獨立Next server（13000），保留使用者既有3000 dev process；Chrome156三個隔離context搭配真實Nest API（13017，DB feastogether_intranet_test017ui、Redis1）驗收，不替換HTTP回應。
- 23個API請求檢查通過：兩位同部門看到彼此、跨部門不可見；文件／建立人搜尋、狀態、單邊／雙邊日期篩選與清除；草稿來源預覽入口及進度；無Email／note／管理控制；直接edit/signers導回唯讀且無通知／邀請／組織查詢；建立人保留管理；跨部門直接詳情拒絕。
- 同部門非建立人view=export獨立cache／API取得核准Email欄位，與一般唯讀DTO分離。瀏覽器測試用合成快照與文件，建立交易正確性另由ticket06驗證。
- 為同一組判別DTO／頁面保持可建置，T033／T034的client修改一併整合：Excel預覽、PDF canExport與history/ZIP失敗顯示；ticket08尚未完成，等待07與全匯出安全回歸，不能宣稱整體隔離可上線。

整合commit：`git log --grep="feat(spec017): render department read-only document views"`。
