# Data Model：前端導覽與能力快照

本 spec 不新增 DB table、migration、環境變數或後端 endpoint。以下是前端 TypeScript 資料責任；後端權限與角色模型以 [028](../028-module-authorization/data-model.md) 為準。

## 1. AuthMeView（消費 028）

| 欄位 | 型別／來源 | 驗證與用途 |
|---|---|---|
| actor | employee `{kind,userId}` 或 super_user `{kind,displayName}` | 沿用 027 session actor union；employee userId 為正整數，super_user 不偽造員工ID |
| user | 027員工白名單本人資料或 `null` | employee保留必要顯示資料；super_user固定為null，不從role推導假員工 |
| expiresAt | ISO日期時間字串 | 目前本機session期限，不作功能授權依據 |
| modules | `{moduleKey:string, permissions:string[]}[]` | 缺某 module 等於沒有該能力，不是全權限；完整權限鍵不拆成 role |

每次 request 回應把同一個目前操作者的session view與能力快照一起取得，不與另一個session查詢結果混合推算。正常回應可含目前employee本人的白名單員編等既有session資料，但不含任何角色ID／code／name、其他人員名單、入口、token、cookie或權限指派歷史。

Request boundary 檢查 actor discriminant、必要欄位、陣列與字串形狀；同 module 重複或格式不合法整份拒絕為能力讀取錯誤。合法未知 module／permission 可忽略但不賦予任何已知選單。不能把 malformed response 當成 Super user 或完整能力。schema 所有者為 028，029 只消費，不另維護矛盾的 OpenAPI 定義。

## 2. RouteDefinition

路徑與名稱集中放在 `client/src/constants/routes.ts`，供 redirect、頁面標題、Breadcrumb 與選單共用；`client/src/components/sidebar/services.ts` 只引用 route 定義並組合 stable key、圖示、階層與權限需求。初始導覽只有 documents=`/esign/forms`、signingTasks=`/esign/my-signature`、exportHistory=`/esign/export-history`，目錄另包含既有首頁及旅遊權限頁面。不要從 path 最後一節產生 key，以免不同父階層同名碰撞。

目前路徑選取以 `pathname === href || pathname.startsWith(href + '/')`；不以裸 startsWith 使 `/esign/forms-other` 誤選。分組沒有 href；不要把未知父路徑渲染成可點連結。

## 3. MenuNode（程式設定，非使用者輸入）

以 `kind:link|group` 區分，避免空 children 被誤認為不需檢查的獨立項目。

| 類型 | 必要欄位 | 禁止／限制 |
|---|---|---|
| link | key、routeId、icon、moduleKey、requiredPermissions | requiredPermissions 必須至少1項；每項在對應 module 的已知導覽能力清單；不支援空集合全開 |
| group | key、label、icon、children | children只能是link，不含href；初期最多一層分組，禁止空群組 |

link label/href從 routes取，不再重複存兩份。icon用 MUI SvgIconComponent，為 client-only設定，不跨Server Component邊界序列化函式。`requiredPermissions`採全部具備語意；目前三個項目各只有一項，不加入任意 AND／OR 運算式語言。

已知導覽能力僅 `esign.document.read`、`esign.signing.read`、`esign.export.read`；這是本前端已使用能力的型別白名單，不是後端全部權限字典。新增項目時必須同步對應 028 目錄及真實頁面。Super user也不可繞過未知鍵或不存在頁面的設定驗證。

## 4. VisibleMenuNode（衍生結果）

只在有效 snapshot 下以純函式過濾，不修改原始常數陣列：link需要 module相符且所有requiredPermissions精確存在；group只保留可見children，0個則移除。不得以label、role name、字串前綴或actor.kind直接放行。Super user因028回傳全部登錄能力而自然看到全部有效配置。

## 5. NavigationAuthorizationState（呈現狀態）

狀態為 loading／ready／empty／error／unauthorized。查詢key為 `[AUTH_ME, pathname]`，只含路徑、不含cookie／員編。pathname變更使用新key；gcTime=0不保留無observer的舊路徑快照。

| 事件 | 下一狀態／處理 |
|---|---|
| 首次mount／路徑變更／聚焦重驗／人工重試 | loading，沒有業務links；不得讀舊data當fallback |
| 目前query成功且idle，合法可見項目>0 | ready，僅顯示新snapshot結果 |
| 同上但項目=0 | empty，顯示「目前沒有可使用的功能」 |
| 網路中斷、paused、503、格式錯誤或能力query的403 | error／可重試，不顯示舊links；paused呈現離線提示 |
| 401 | unauthorized，清能力並沿既有session失效流程 |
| 同頁已知登入／登出／切換 | cancel＋remove身份相關queries，重新取得能力，不恢復舊資料 |

queryFn將signal交Axios，取消的舊回應不得提交為目前snapshot。`status=success`但`fetchStatus=fetching|paused`仍不可顯示舊項目。新的actor識別（employee:userId或super_user）與上次不同時，延用027清理身份相關業務快取，不能把前任資料交給新身分。識別僅存在記憶體，不保存任何session fingerprint。

## 6. 與共用 QueryClient 的邊界

`auth/me` query用專屬設定覆寫現有五分鐘／不聚焦刷新預設；不改其他query。已知身份切換沿027清cache流程加入AUTH_ME key；跨分頁cookie改變在下一次focus／路徑／refresh重驗時發現，不新增輪詢或跨分頁通訊。

只對內部業務的403 AUTHORIZATION_DENIED做一次失效／取消與refetch，排除AUTH_ME本身以及登入／外部／公開API。多個同時403可合併為同一in-flight重驗；不自動retry已被拒絕的業務mutation。`auth/me` query 403不觸發自己失效循環。

## 7. CommonPermissionInterface

`PermissionProvider` 從已安全採用的 `AuthMeView.modules` 建立 `hasPermission(moduleKey, ...permissions)`。它只在精確相同 module 內以 AND 判斷完整 permission；缺 module、空需求或缺任一 permission 均回 `false`。導覽是第一個正式消費端，其他前端呈現可逐步沿用，但這個布林結果永遠不能取代後端 API 授權。

## 8. CommonShell

內部 `(main)` 路由由 AppShell 統一組合 Sidebar、AppHeader、PageBreadcrumbs、UserProfile 與可捲動內容區。Breadcrumb 只從 route 目錄解析名稱；無已知名稱的動態片段維持可辨識 fallback。公開、登入與外部簽署頁不包入此殼層，既有 iframe 隱藏及 `InternalIdentityBoundary` 仍位於業務內容之外的安全邊界。
