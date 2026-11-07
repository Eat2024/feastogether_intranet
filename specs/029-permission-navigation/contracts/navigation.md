# 選單設定與呈現契約

## 初始mapping

| key | 路徑／label | moduleKey | requiredPermissions | 圖示 |
|---|---|---|---|---|
| documents | /esign/forms／電子簽列表 | esign | esign.document.read | 現有ListAltRounded |
| signingTasks | /esign/my-signature／我的電子簽 | esign | esign.signing.read | 現有DrawRounded |
| exportHistory | /esign/export-history／歷史匯出文件 | esign | esign.export.read | 現有HistoryRounded |

順序維持現況。初版三個link不包進新群組；資料模型支援一層group，供明確新增實際頁面時使用，測試fixture可驗空群組及多children。不存在的角色管理／員工管理頁面不加入，平台管理能力沒有對應前端入口。

## 規則

1. link 必須對應已知routeId、module及非空能力陣列；每項權限必須屬於同module且在本前端已使用的能力清單。
2. 當所有需求精確存在於該module.permissions才可見；其他module即使出現相同尾名也不能授權。
3. group 只作標題／分組、不具有href；遞迴過濾一層children，空組移除。獨立link同樣檢查，不依children缺少而直接放行。
4. malformed設定開發／驗證階段回報具體key，runtime仍隱藏該項；Super user不繞過設定驗證。
5. pure filter回新陣列，不改原menu或response。順序不變，key唯一，icon與label保留。
6. selected為路徑相等或以href加`/`為前綴，不用裸startsWith；group的任何child選取可標示group但不能新增未知導向。
7. ready才顯示links；loading有進度提示；error有重新取得按鈕；empty顯示「目前沒有可使用的功能」。不得把載入畫面做成空白永久側欄。
8. 保留MUI語意nav、keyboard focus、aria-current與既有theme tokens。Drawer展開與mini UI必須共用同一filter結果。
9. 保留Sidebar的hide-when-embedded與root data-embedded，不在iframe強制顯示導覽。內部頁面改由共用AppShell組合Sidebar、AppHeader、Breadcrumb、UserProfile及內容捲動區，不改Marco既有theme、Root Layout日期／字型架構。
10. `ROUTES` 是路徑與名稱的單一目錄；redirect、頁面標題、Breadcrumb與選單不得各自重複硬編同一名稱。權限需求留在menu設定，不混入純route定義。
11. `hasPermission(moduleKey, ...permissions)` 只接受同module的完整permission並採AND；空需求、缺module或缺任一permission均為false。選單filter與後續呈現共用此介面，仍不取代server授權。
12. 全站Snackbar位置與CKS一致為頂端置中，Alert採filled；只同步視覺，不改401／403分類、訊息來源或重試行為。
13. 選單只是入口呈現，不保護現有mock store或替代後端。029不正式化歷史匯出原型，也不改所有按鈕／深連結可見性；安全驗收針對028已保護的真實API。

## 可見性矩陣

| 有效能力來源 | 電子簽列表 | 我的電子簽 | 歷史匯出文件 |
|---|---|---|---|
| 同仁 | 顯示 | 顯示 | 隱藏 |
| 同仁＋文件建立者 | 顯示 | 顯示 | 顯示 |
| 同仁＋電子簽管理員 | 顯示 | 顯示 | 顯示 |
| Super user | 顯示 | 顯示 | 顯示 |
| 只有其他子功能能力 | 隱藏 | 隱藏 | 隱藏 |
| 未取得／查詢失敗／失效 | 隱藏 | 隱藏 | 隱藏 |

同仁已是有效員工固定資格，「只有其他功能能力」屬隔離fixture用於驗證filter，不是目前正式員工預設狀態。缺部門仍有功能權限，資料API可依既有規則拒絕部門資料；不能把前端能力清單當成某筆資料一定存在或可讀的證明。
