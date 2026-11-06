# Quickstart：029實作後驗證

這是驗證指南，新增前端程式尚未實作；目前未執行lint/build、瀏覽器或真實API測試。

## 前置與檢查

- 027與028已實作，備妥一般同仁、具有匯出能力員工、電子簽管理員與Super user測試身分；不在文件／快照保存個資、入口或cookie。
- 028的GET /api/me/authorization回應符合[消費契約](contracts/authorization-consumer.md)，後端實際執行功能及資料授權；無後端時只能驗呈現，不能宣稱本規格全數通過。
- 使用原pnpm workspace與client Node版本，不新增測試框架或lockfile。

```bash
pnpm -C client lint
pnpm -C client build
pnpm -C client dev
```

client沒有test script，不宣稱跑自動前端測試。若實作只改client，用client檢查；若跨後端／root變更才加對應server測試與root build/lint。實際後端越權驗證沿028的隔離測試資料庫，不對正式資料做測試。

## A. 集中設定與可見性（US1、US4）

按[選單矩陣](contracts/navigation.md)登入各角色，確認三個原路徑、名稱、順序、圖示與選取狀態。子路徑如/forms/123選電子簽列表，/forms-other不應誤選。

在受控開發fixture驗證：不同module同尾名權限不放行；多需求只具一個時隱藏；無children的獨立link缺權限隱藏；group全空隱藏；未知／空需求／跨module／重複key設定可定位且不放行。只用fixture驗group，不把虛構功能加入正式menu。

調整集中label或順序後SideNav隨之改變，不在元件重複改字串。確認filter未修改原陣列或能力回應。現有SideNav是permanent模式，不需要為驗收新增收合UI。

## B. Super user與身分切換（US2）

Super user顯示全部三個真實業務項目，不出現角色管理、員工管理或隱藏登入入口。查看網路回應與前端選單資料，不應有部署帳號、完整隱藏網址、cookie或其他員工資料。

從Super user切回同仁，確認取消／移除舊身份query後重新取得能力，匯出選單不殘留。用開發工具延遲舊能力請求再切身分，舊回應即使晚到也不能覆蓋目前query；重驗完成前不顯示舊links。

另一分頁建立不同session後，回到原分頁聚焦；目前能力回應的新actor被採用，舊內部資料快取不得交給新身分。測試只保留所需的測試憑證於瀏覽器，不輸出到log。

## C. 撤權、重新驗證與失敗（US3）

以028 API／REPL撤銷額外匯出角色：當下直接呼叫實際匯出API應被後端拒絕；重新整理、切到不同內部pathname、離開再聚焦頁面都須重抓能力，成功後匯出項目隱藏，不必重新登入。

延遲能力回應時顯示loading；使其503、斷線、paused或回傳錯誤shape時顯示可理解錯誤／重試，舊全權限項目不顯示。重試只重新取得能力，不重送先前業務mutation。確認其他業務query沒有因本次改動全部改成focus refetch。

內部業務403 AUTHORIZATION_DENIED觸發一次能力重驗；同時多個403合併。能力query自身403不得形成無限refetch；CSRF403、外部簽署錯誤不觸發此重驗。401沿適用session失效流程；027隱藏登入頁錯密碼401仍只在登入表單顯示，不彈員工過期對話框。

## D. iframe、可及性與直接存取（US1、US4）

從既有入口網嵌入，SideNav持續由hide-when-embedded隱藏，不能出現重複導覽；新分頁正常呈現。EmbedBridge的origin／parent驗證與launch-required不改。

鍵盤可依序操作可見links與重試按鈕，焦點清楚、current page可辨識；loading／error／empty有可讀狀態。無任何可見功能時不顯示空群組。

手動輸入被隱藏頁面或直接呼叫對應真實API，資料仍由028拒絕。既有mock／原型頁面不是本規格正式化成果，不拿mock回應當後端授權證據；完整按鈕與深連結UI改善不在本次範圍。

## 紀錄結果

後續implementation記錄實際lint/build結果、角色矩陣、請求次數、延遲舊回應、401/403與iframe驗證，以及未完成項。可以附遮蔽敏感值的截圖／network摘要，不附真實隱藏入口或session。本plan只完成文件設計與靜態一致性檢查。
