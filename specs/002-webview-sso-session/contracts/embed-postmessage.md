# 主平台 iframe 嵌入與 postMessage 換頁契約

主平台（入口網）以 iframe 嵌入電子簽時，在電子簽各頁之間切換**不重新 launch**：
主平台以 `postMessage` 告訴電子簽要開哪一頁與目前登入者員編，電子簽確認 session 是同一人後直接換頁。
只有「沒有 session」或「session 不是同一人」時，才走 [main-platform-jwt.md](./main-platform-jwt.md) 的 JWT launch。
launch 一律導向電子簽首頁；要開哪一頁只由本契約的 `esign:navigate` 決定，JWT 與 session 都不帶頁面資訊。

## 1. 流程

```text
主平台頁面                                        電子簽 iframe
Portal 先掛 message listener，再載入 iframe <esign-origin>/embed（載入中畫面）
                        ◀── esign:ready ───────── 取得 embed-origins 後送出一次
esign:navigate { target, empid } ───────────────▶ GET /api/auth/session，比對 user.empId
                                                  ├ 相同 → router.replace(target 路徑)
                        ◀── esign:navigated ──────┘
                                                  ├ 不同 → DELETE /api/auth/session（撤銷舊 session）
                        ◀── esign:launch-required ┘ 無 session 亦同
iframe 導向主平台 launch（簽 JWT）
→ bridge → session → 303 首頁 → 再次 esign:ready → navigate（同一人）→ 換到 target 頁 → navigated
```

主平台在電子簽各選單之間切換時不重新載入自己的頁面，只再送一次 `esign:navigate`，並以 `history.pushState` 更新網址、標題與選單狀態。

## 2. 訊息

| 方向 | `type` | 欄位 | 說明 |
| --- | --- | --- | --- |
| 主平台 → 電子簽 | `esign:navigate` | `target`、`empid` | `target` 只接受 `forms-new`、`forms`、`my-signature`；`empid` 為 1–32 個英數字 |
| 電子簽 → 主平台 | `esign:ready` | — | 電子簽頁面可接收指令；Portal 必須先掛 message listener 再載入 iframe |
| 電子簽 → 主平台 | `esign:navigated` | `target` | session 與 `empid` 相同，已換到該頁 |
| 電子簽 → 主平台 | `esign:launch-required` | `target` | 沒有 session，或 session 不是同一人（已撤銷）；主平台應改走 launch |

格式不符的訊息一律忽略。主平台每次換頁只送一次 `esign:navigate`。

## 3. 來源檢查（雙方都必須做）

- 電子簽只接受 `event.source === window.parent` 且 `event.origin` 在 `GET /api/auth/embed-origins` 清單內的訊息；送出時只指定清單內的 origin，不使用 `'*'`。
- 主平台只接受 `event.origin` 等於電子簽 origin、且 `event.source` 是自己 iframe 的訊息；送出時指定電子簽 origin。
- 訊息只影響畫面與「是否需要重新 launch」，不授予任何權限；登入身分一律由 JWT launch 建立，權限由電子簽 session 判斷。
- 訊息不含 token、cookie 或 session 內容；電子簽不把 session 的員工資料傳給主平台，比對在電子簽內完成。

## 4. `GET /api/auth/embed-origins`

Public、`Cache-Control: no-store`。回傳 `.env` 的 `AUTH_TRUSTED_ORIGINS`，與 bridge 的 `frame-ancestors` 為同一份清單；未設定時回傳空清單。

```json
{ "success": true, "data": { "origins": ["https://portal.example.internal"] } }
```

## 5. 失敗與退回

- 主平台 10 秒內沒收到 `esign:ready` 或回覆（電子簽連不上、版本不支援 `/embed`）時，直接走 launch；
  此時沒有 postMessage 可換頁，會停在電子簽首頁（電子簽列表）。
- launch 之後仍收到 `esign:launch-required`（例如瀏覽器封鎖 cookie）時，主平台顯示錯誤，不再重試，避免無限循環。
- 撤銷舊 session 失敗時仍繼續 launch：新的 session cookie 會取代瀏覽器中的舊 cookie。

## 6. 嵌入時的畫面

電子簽 `<head>` 在畫面繪製前判斷 `window.self !== window.top`，標記 `<html data-embedded>`；
`.hide-when-embedded`（側邊欄、與主平台選單重複的標題與按鈕）只在嵌入時隱藏，新分頁開啟時照常顯示。
