# 04：員工從我的電子簽完成閱讀與簽署

**What to build:** 有效登入的員工可直接開啟本人待簽文件、閱讀、同意並簽署；成功後看到已簽結果與更新後的列表，不需 Email OTP。

**Blocked by:** 02 共用簽署表單。

**Status:** resolved

**Tasks coverage:** T014–T016；T012/T013/T018/T019/T021/T023 的開啟、原檔、簽署、權限、狀態及重送部分。

- [x] 以任一正式支援的員工 session 操作本人指派，沒有 Email 或未點邀請信不影響授權；非本人／外部指派拒絕，未登入及過期拒絕。
- [x] 正式畫面與 API 完成閱讀、同意、簽名及提交，移除待簽回 Email 提示；換文件重置，pending 防連點，session 失效不自動提交。
- [x] 後端交易前與鎖內核對本人、期限、狀態、聲明、欄位、PNG 與文件完整性；同 requestId 重送回原結果，併發不建立重複證據。
- [x] 新內部證據記 internal_session，外部保持原驗證方式；歷史簽章、PDF 及稽核證據不變。
- [x] 完成結果與列表同步；單元、API／安全測試及桌面／窄螢幕路徑通過。本票不宣稱舊 OTP 切換已完成，整體上線須等 09／10。

## 實作與驗證（2026-10-28）

- 本人 open/source/sign 已改用員工 session；草稿、刪除、外部指派及跨人回 404，待簽期間仍由 server 驗證。POST open 記 document.opened，GET source 不新增事件，PDF 保留 no-store/nosniff。
- 交易前、鎖內與兩處重送均核對本人；內部不使用邀請世代。新證據 internal_session，外部維持 email_invitation；同 requestId 併發回 201/200，只留一筆證據。
- 前端接本人 API、共用聲明／PDF／簽名表單，成功更新結果及 invalidate 列表。換任務重置，重試 requestId 不變；401 顯示既有入口網重登提示，不自動提交。拒簽 callback 改為選填，本票不顯示拒簽按鈕，待 ticket05 接通拒簽／副本。
- 單元先確認舊 OTP 阻擋造成失敗，再通過內部重送案例；新增鎖內重送、鎖內身分變更等案例。server 104 suites／951 tests、client lint/build、server lint/build 通過；既有 lint warnings 保留。
- MySQL 使用隔離 DB `feastogether_intranet_test_spec016_t04`，檔案 `/tmp/feastogether-spec016-t04`。新增 internal-portal-signing API suite（8 cases）註冊於一般及 security configs；連同 security-core-esign-flow、esign-document-delivery-security 共 3 suites／24 tests 通過。涵蓋真正過期 session、無 Email/無 token 既有指派、跨人、外部、Origin、重送、併發、聲明／PNG／欄位／payload／source 竄改、未開始／過期／停止／草稿／刪除與不可變證據。
- Chrome CDP 合成 API/PDF，1280×900 完成閱讀、鍵盤同意、滑鼠簽名、503 同 requestId 重試與結果；390×844 嵌入版面（沿 Portal 的 data-embedded）驗證切換任務為 0/1、無水平溢出、手寫簽名及 401 後停止不重送。沒有 Runtime exception。腳本 `/tmp/ft04-browser.mjs`、截圖 `/tmp/ft04-desktop.png`／`ft04-narrow.png`，不是正式 Portal 整合驗收。
- 窄版檢查發現短聲明在字型／版面改變後可能無法勾選，TermsStep 以 ResizeObserver 重新判斷並在卸載清理。既有 standalone 常駐側欄在手機仍占 240px，本次主要 Portal iframe 版面會隱藏側欄，未擴大改版導覽。
- 舊內部 OTP 封鎖、Email 發起及正式部署驗收仍由後續 tickets 負責；未改歷史簽章、PDF 或稽核紀錄。

### 與 ticket06 整合後

- 實作 commit `f239ed4`；合併整合分支 commit `9b017b2` 保留兩個新增 e2e suite。合併 hooks 為 106 suites／973 tests 通過，root lint 無錯誤。
- 重驗 internal-portal-signing 與 security-core-esign-flow 通過；esign-document-delivery-security 的 3 個舊案例在 `signInternal → external → decrypt(null)` 失敗，因 ticket06 已取消內部邀請 token。這是待 ticket09 遷移的舊內部 OTP fixture，未刪除安全覆蓋或恢復舊授權；整體安全套件尚未全綠。

### 整合紀錄

- 實作 `f239ed4` 已隨 `impl/016-04` 的 `69ee7cc` fast-forward 整合至 `feat/016-internal-portal-signing`；本人閱讀／簽署的局部 API、安全與桌面／窄螢幕驗收完成。
- Ticket 05 接續拒簽與副本；因 06 取消內部 token 而失效的舊安全 fixture 保留給 09 遷移，不降低授權或刪除覆蓋。
