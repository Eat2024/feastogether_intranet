# Portal 登入導頁契約

## Email 入口

電子簽 UAT 與 PRD 一律使用：

```text
http://portal.feastogether.com.tw/portal/login?redirect_to=hr/esign/mine
```

這是本次初始目的地，參數尚待 Portal 實作。回跳機制供各頁面共用：以 `application/config/login_redirect.php` 集中定義輸入值到站內路徑的允許映射，初始為 `hr/esign/mine → hr/esign/mine`。未來登記其他頁面只需擴充映射，登入與改密碼不增加電子簽專用分支。清單採版控設定，不含 secret、不新增環境變數或設定後台。

新增薄的 `application/libraries/Login_redirect.php`，供 Login、Account 與 Logout 共用目的地驗證、保存、取出並清除及重設；session 名為 `login_redirect_target`。回跳前再次驗證保存值仍在清單，以清單右側的站內路徑呼叫 base_url；缺少／失效值回原首頁。清單值本身也須限定站內路徑，不允許外部 URL、query 或 fragment，不能把輸入直接當網址。

只接受單一純字串，URL decode 一次後精確匹配清單；陣列、重複參數、完整 URL、`//host`、穿越、未知值皆不接受。未來可登記頁面代碼作為 key，但本次不增加額外別名。目的地只負責導覽，頁面權限由原 controller 執行。

## 登入狀態表

| 請求／狀態 | 行為 |
| --- | --- |
| GET login，合法值，未登入 | 保存目的地，顯示原登入頁 |
| GET login，合法值，已登入且無改密碼待辦 | 消費目的地，導到 mine；仍執行選單權限 |
| GET login，已登入且有改密碼待辦 | 保存合法目的地，先到 modifyPassword |
| 新 GET login，無參數或不合法值 | 清除目的地，依原登入／首頁流程；不清除改密碼待辦 |
| POST login/post，驗證失敗 | 原錯誤畫面，保留目的地，不因 query 缺少而清除 |
| POST 成功，非預設密碼 | 消費合法目的地並轉址；沒有則原首頁 |
| POST 成功，需要改密碼 | 保存待辦及目的地，先到 account/modifyPassword |
| 改密碼失敗 | 原 JSON 錯誤，保留目的地及待辦，不導頁 |
| 改密碼成功 | DB 更新成功後消費目的地、清待辦；沒有目的地則首頁 |
| 登出 | 共用 Logout 清除目的地與待辦 |

沿用 Portal 原有 redirect helper 與狀態碼，不改登入表單欄位與驗證規則。`Login` constructor 的已登入分支必須在解析目的地之後執行。`updatePassword` 的 `{status,msg}` 保持相容，成功時追加 server 產生的 `redirectTo`；view 只在 status 成功時使用，不接受 client 指定回跳。新增 session 欄位見 data-model。

共用機制驗收另以測試專用的第二個站內頁面映射驗證：不修改 Login／Account 即可返回另一頁，移除映射後舊 session 不再被接受。測試值不加入正式清單。

## 嵌入契約沿用

`hr/esign/mine` → `_showWebview('mine')` → iframe `/embed` → `esign:ready` → `esign:navigate {target:'my-signature',empid}`。沒有或不同人的電子簽 session 時走既有 launch，再 ready/navigate。Portal 保留 origin、frame window 與選單權限檢查；電子簽保留員工 session 比對，不把訊息裡的 empid 當登入憑證。

既有 launch 仍回固定首頁，不新增任意 redirect URL，不把 Email 目的地塞入 JWT。此改動不需修改 WebView 登入協定。

## 環境邊界

兩套電子簽的通知都連 Portal 正式機。Portal 正式機接哪一套電子簽由其既有 `esign_webview` 配置決定，本次不改該配置、不傳電子簽來源環境或文件 ID。UAT 文件不會自動出現在另一環境，也不新增跨環境同步。

完整端到端驗收須在 Portal 實際對應的電子簽環境使用合成資料；UAT 可獨立驗證本人 API 與畫面，但僅收到 UAT 通知並開啟正式 Portal 不足以證明 UAT 全流程通過。部署版本與瀏覽器 cookie 另列驗收紀錄。
