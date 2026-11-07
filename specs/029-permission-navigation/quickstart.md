# Quickstart：029實作後驗證

這是驗證指南。前端程式與純函式測試已實作；瀏覽器角色矩陣及真實API情境仍待環境驗證。

## 前置與檢查

- 027與028已實作，備妥一般同仁、具有匯出能力員工、電子簽管理員與Super user測試身分；不在文件／快照保存個資、入口或cookie。
- 028的GET /api/auth/me回應符合[消費契約](contracts/authorization-consumer.md)，後端實際執行功能及資料授權；無後端時只能驗呈現，不能宣稱本規格全數通過。
- 使用原pnpm workspace與client Node版本，不新增測試框架或lockfile。

```bash
pnpm -C client lint
pnpm -C client test
pnpm -C client build
pnpm -C client check:bundle
pnpm -C client dev
```

client 的 Node 內建 test runner涵蓋純filter，不宣稱涵蓋元件與瀏覽器整合。若實作只改client，用client檢查；若跨後端／root變更才加對應server測試與root build/lint。實際後端越權驗證沿028的隔離測試資料庫，不對正式資料做測試。

## A. 集中設定與可見性（US1、US4）

按[選單矩陣](contracts/navigation.md)登入各角色，確認三個原路徑、名稱、順序、圖示與選取狀態。子路徑如 `/esign/forms/123` 選電子簽列表，`/esign/forms-other` 不應誤選。

在受控開發fixture驗證：不同module同尾名權限不放行；多需求只具一個時隱藏；無children的獨立link缺權限隱藏；group全空隱藏；未知／空需求／跨module／重複key設定可定位且不放行。只用fixture驗group，不把虛構功能加入正式menu。

調整集中label或順序後Sidebar兩種模式隨之改變，不在元件重複改字串。確認filter未修改原陣列或能力回應，並回歸既有展開／收合行為。

## B. Super user與身分切換（US2）

Super user顯示全部三個真實業務項目，不出現角色管理、員工管理或隱藏登入入口。查看網路回應與前端選單資料，不應有部署帳號、完整隱藏網址、cookie或其他員工資料。

從Super user切回同仁，確認取消／移除舊身份query後重新取得能力，匯出選單不殘留。用開發工具延遲舊能力請求再切身分，舊回應即使晚到也不能覆蓋目前query；重驗完成前不顯示舊links。

另一分頁建立不同session後，回到原分頁聚焦；目前能力回應的新actor被採用，舊內部資料快取不得交給新身分。測試只保留所需的測試憑證於瀏覽器，不輸出到log。

## C. 撤權、重新驗證與失敗（US3）

以028 API／REPL撤銷額外匯出角色：當下直接呼叫實際匯出API應被後端拒絕；重新整理、切到不同內部pathname、離開再聚焦頁面都須重抓能力，成功後匯出項目隱藏，不必重新登入。

延遲能力回應時顯示loading；使其503、斷線、paused或回傳錯誤shape時顯示可理解錯誤／重試，舊全權限項目不顯示。重試只重新取得能力，不重送先前業務mutation。確認其他業務query沒有因本次改動全部改成focus refetch。

內部業務403 AUTHORIZATION_DENIED觸發一次能力重驗；同時多個403合併。能力query自身403不得形成無限refetch；CSRF403、外部簽署錯誤不觸發此重驗。401沿適用session失效流程；027隱藏登入頁錯密碼401仍只在登入表單顯示，不彈員工過期對話框。

## D. iframe、可及性與直接存取（US1、US4）

從既有入口網嵌入，Sidebar持續由hide-when-embedded隱藏，不能出現重複導覽；新分頁正常呈現。EmbedBridge的origin／parent驗證與launch-required不改。

鍵盤可依序操作可見links與重試按鈕，焦點清楚、current page可辨識；loading／error／empty有可讀狀態。無任何可見功能時不顯示空群組。

手動輸入被隱藏頁面或直接呼叫對應真實API，資料仍由028拒絕。既有mock／原型頁面不是本規格正式化成果，不拿mock回應當後端授權證據；完整按鈕與深連結UI改善不在本次範圍。

## E. CKS 共用前端慣例（US1、US3、US4）

逐頁確認內部路由均由 AppShell 顯示 Sidebar、AppHeader、Breadcrumb與UserProfile，內容區獨立捲動；公開／登入／外部簽署頁不應被包入。確認 iframe 隱藏及 actor 重新採用期間的遮蔽仍有效。

修改一個 `ROUTES` label fixture，確認 Sidebar、Breadcrumb與使用該路徑的頁面標題共用名稱；redirect只能引用href。驗證已知階層能產生Breadcrumb，未知動態片段維持可辨識fallback。

以同module完整權限、多權限缺一、其他module同名權限、未知module及空需求呼叫 `hasPermission`；結果應依序為true、false、false、false、false。這只控制前端呈現，直接API仍須由028拒絕越權。

觸發info／success／warning／error Snackbar，確認位置為頂端置中且Alert為filled；再驗證401、內部AUTHORIZATION_DENIED 403及一般錯誤仍走原本分類與訊息來源。

## 紀錄結果

2026-11-07 自動驗證：`pnpm -C client test` 21 tests passed；`lint`、`build`、`check:bundle` 與 `git diff --check` 均通過。測試包含 auth/me 精確 DTO、actor與角色欄位拒絕、同 actor focus重驗保留掛載／actor A→B卸載採用邊界、401清理範圍、403合併與no-loop、paused/error及收合空狀態，以及同 module精確比對、多能力AND、空群組、重複key fail-closed、共用`hasPermission`與route/Breadcrumb目錄。

尚未在本機建立真實員工／Super user session 執行瀏覽器角色矩陣、聚焦競態、iframe 與 401／403 網路驗收；這些項目不宣稱完成。後續可附遮蔽敏感值的截圖／network摘要，不附真實隱藏入口或session。
