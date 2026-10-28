# 05：員工拒簽、完成結果與本人副本

**What to build:** 員工可依文件規則拒簽；已簽者能在我的電子簽查看副本產製狀態並下載，不需回邀請信。

**Blocked by:** 04 員工閱讀與簽署。

**Status:** claimed

**Tasks coverage:** T017/T022；T012/T013/T018/T019/T021/T023 的拒簽、副本與完成頁部分。

- [x] 允許拒簽的文件可完成拒簽及選填原因；不允許者 server 也拒絕，重送不重複寫入，列表同步。
- [x] 已簽者看到產生中／ready／failed，使用唯讀查詢輪詢；完成、失敗或離開頁面停止輪詢，不重複寫開啟事件。
- [x] 可下載本人已簽副本，保留完整性檢查與到期後既有存取規則；其他人的副本與未簽者均不可取得。
- [x] 正常內部流程不含返回 Email 指示；拒簽、下載、期限、失效、跨人與外部共用畫面回歸通過。

## 實作與驗證（2026-10-28）

- 本人拒簽使用員工 session，仍在 document→signer 鎖內驗證身分、pending、簽署期間及 allowReject。相同 requestId／trim 原因可回原結果；不同原因／requestId 衝突；稽核只寫一次。
- 本人副本入口移除 OTP 限制，重用 personalCopy 的已簽／ready、證據、PDF、hash／size 與歸屬檢查；已到期仍可下載本人副本，未簽與未 ready 回 409，跨人／外部指派回 404。
- 前端接拒簽 API／結果與列表同步、本人下載網址。產製期間僅 GET 列表每 2 秒輪詢，ready／failed／查詢錯誤停止，卸載由 query observer 清理。POST open 只進頁一次，回應寫入列表快取；後續 UI 使用最新 GET task，不被舊 open.data 覆蓋。
- 本人已簽結果保留公開驗證入口；新的 internal_session 補 server DTO、client type 與顯示文案，歷史 employee_session／email_invitation 保留。列表待簽操作改為「前往簽署」，移除舊 Email 指示及 Swagger 註解。
- TDD：先觀察 8 個本人拒簽／下載測試因舊 OTP 阻擋失敗，再改授權通過。目標 service 3 suites／54 tests 通過；完整 server 106 suites／974 tests 通過。root build、server lint:check、client lint 通過，未增加 dependency／schema／環境變數。
- 新增 internal-portal-completion suite 並註冊一般／security configs。隔離 DB feastogether_intranet_test_spec016_t05、儲存 /tmp/feastogether-spec016-t05。真實 worker 產生 PDF，驗證拒簽併發、allowReject／時間／狀態、本人副本、過期後 bytes 不變、公共驗證 internal_session、跨人、未簽與 hash 損毀。與 internal-portal-signing／security-core-esign-flow 共 3 suites／27 tests 通過。
- Chrome CDP 合成 API/PDF（/tmp/ft05-browser.mjs）：桌面1280×900 processing→ready 後停止 GET、POST open 恰一次、下載 PDF bytes 相同；窄版嵌入390×844 failed 停止、離頁停止、無水平溢出、拒簽原因與 503 重試 UUID 相同、結果與列表更新。公開驗證頁顯示新驗證方式。沒有 Runtime exception；截圖 /tmp/ft05-ready.png。
- 上述 browser fixtures 不代表正式 Portal 整合；舊內部 OTP 測試 fixture 由 ticket09 遷移，未刪除既有安全斷言。等待 merger 整合後標 resolved。
