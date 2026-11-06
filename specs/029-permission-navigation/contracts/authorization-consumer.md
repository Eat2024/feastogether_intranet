# 本人能力消費契約（029）

本文件定義前端如何使用028契約，不新增後端操作。權威schema為 [028 OpenAPI](../../028-module-authorization/contracts/openapi.json)，操作者沿 [027 API行為](../../027-super-user-access/contracts/api-behavior.md)。

## Request／response

- `GET /api/me/authorization`；透過既有Axios同源 `/api` baseURL，endpoints新增相對值 `me/authorization`。
- FT_ESIGN_SESSION由瀏覽器自動帶入；JS不讀取或序列化cookie，不需要module query parameter，也不在URL帶userId。
- 200使用既有 `{success:true,data,timestamp}`；Axios攤開後得到 `{actor,modules}`。
- actor：employee `{kind:'employee',userId:number}`；super_user `{kind:'super_user',displayName:'Super user'}`。
- modules：`[{moduleKey:string,permissions:string[]}]`；permission為完整穩定字串。沒有能力的module可省略。Super user回全部已登錄能力，不回`*`。
- response為no-store；不能把後端snapshot寫入長期storage或cookie。
- 不含role清單、員編、部門、隱藏入口、credential generation、帳密或其他人的資料。

## API層責任

`getCurrentAuthorization({signal})`沿既有request pattern回傳解析後data，將AbortSignal傳Axios；只驗證消費端必要結構，不建立第二套角色計算。格式錯誤以本地「無法取得功能權限，請重試」呈現，不能轉成空陣列後默認允許。

`useGetCurrentAuthorizationQuery(pathname)`的key為 `[queryKeys.CURRENT_AUTHORIZATION, pathname]`，專用選項：staleTime0、gcTime0、retry0、refetchOnWindowFocus true、refetchOnMount always。沒有placeholderData、initialData或持久化。只在既有main頁面Sidebar使用；外部簽署／公開驗證／隱藏登入不因全站provider而多打一個需要員工身分的能力請求。

只有當query成功且idle，才交給filter形成選單；fetching、paused、error或undefined data都沒有業務links。pathname變更先拿新key；舊request被取消，舊結果不得填入新路徑query。

## 401／403／503與重試

| 結果 | 前端行為 |
|---|---|
| 401 | 清能力；交現有／027 session失效流程，不查找或導向隱藏入口 |
| 能力query的403 | 權限讀取錯誤與人工重試，不invalidate自己，不轉登入過期 |
| 內部業務403且code=AUTHORIZATION_DENIED | 既有Snackbar提示；取消／失效目前能力並合併一次refetch；不重送被拒的mutation |
| CSRF403、外部憑證403、公開API錯誤 | 保留原處理，不觸發本功能重驗 |
| 503、網路／解析錯誤 | 顯示「無法取得功能權限」與重試，不沿用舊snapshot |
| paused／離線 | 顯示離線／待重新連線，沒有舊業務links；不新增輪詢 |

能力query設定suppressGlobalErrorToast，避免inline錯誤與Snackbar重複；這個meta目前不抑制401，029不得用它假設Super user密碼錯誤已獲豁免。027的登入401獨立處理保持，不把此查詢加在登入頁。

## 身分切換與競態

027登入成功／登出成功的既有清理流程加入CURRENT_AUTHORIZATION取消及移除；同頁切換先清再導航，能力query重新mount／refetch。由WebView full navigation建立的新session自然重建記憶體；其他分頁cookie變更在focus、route或refresh時確認，不新增BroadcastChannel。

後端回應actor與上次不同時，不把新permissions和舊actor混合；取消／移除舊內部身分相關query，再依新快照顯示。針對query key白名單清理內部session與ESIGN_*資料，不清除外部簽署憑證或改其存取流程。舊請求的取消結果不能再展示；不讀token來建立cache key。

本契約只確保導覽呈現及必要身分cache銜接，不承諾閒置分頁立刻推送更新。後端下一次請求授權由028立即生效，即使瀏覽器暫時仍畫出舊選單也不能取得資料。
