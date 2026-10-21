# 前端 Agent 交接：Spec 010

本次已實作後端能力及契約，**沒有修改 client，也未部署**；驗證結果與限制見 [quickstart](../quickstart.md)。前端依 Swagger／以下契約另行串接，部署後先確認 migration 與 HTTP／worker 為同一相容版本。既有內部 mock 流程不能視為已完成正式功能。

契約入口：[員工與發起](employee-email-api.md)、[Email 簽署與通知](signing-notifications-api.md)。後續遵循 client/AGENTS.md 與既有 src/api 分層；不要直接 import server source 或呼叫 fgapi。

## 建立人串接順序

1. 讀 `GET /api/esign/signer-candidates/org-chart` 顯示組織。後端已有兩小時共用快取，前端不加 refresh 參數，不載全公司信箱。
2. 選到員工後呼叫 `POST /api/esign/signer-candidates/resolutions` 取得本機 userId；大量選取自動每批最多 100（6,000 人為 60 次解析請求）。以 employeeNo 精確對應，員編不能填入 userId；不同人同 email 不合併。GET candidates 已改為只查本機，不能再依賴 GET 建帳。
3. 拿 userIds 呼叫該草稿 employee-email-checks，呈現 ready／unavailable 與遮罩信箱；不提供手填員工地址。請求格式、數量或額外欄位錯誤回 400 `INVALID_REQUEST`；帳號不可用或 ID 超出安全整數範圍仍回 422。上游失敗呈現暫時不可用，不當作無人。
4. 草稿仍傳 `{type:'user',userId}`，外部仍 `{type:'email',name,email}`。沒有信箱可暫存；既有 draftSave／draft-settings 各自回應形狀依契約處理。
5. 發起仍送完整名單／欄位／期間／選項。後端必定重查地址，不能把預覽 ready 視為保證。422 details.userIds 對應已選名單提示移除或待來源修正；502 可重試，409 身分變更重新取得候選資料。
6. 成功後顯示 active 與逐人寄送狀態；同信箱每人皆有自己的邀請紀錄。發起回應遺失先查文件，不直接重建或重複發起。

### 全公司名單與等待邊界

- 對同份草稿呼叫一次 `POST /api/esign/documents/:id/employee-email-checks`，可帶最多 6,000 個 userIds；後端自動每 100 人查一批、最多 4 批併發。發起同樣由後端拆批，使用者無須手動分成多份文件。
- 信箱不使用 org-chart 的兩小時快取。任何一批失敗都不能當作部分成功；缺地址不能自行略過或改成外部簽署人。
- 容量測試是本機已有帳號、合成來源、HTTP 直連；不是實際 HR／Next rewrite／反向代理的時限保證。60 批在每批接近 10 秒時約需 15 波、來源等待可接近 150 秒，另加資料庫與入列；前端串接時須驗證實際代理與請求期限，不自行新增背景發起。
- 本機缺帳號的資格查詢目前逐人處理，冷匯入可能明顯較慢；超出 staff_lookup 的 5–8 碼範圍且本機不存在者回 unavailable，不得以組織樹資料冒充已建帳。

## 簽署人串接順序

1. Email 連結進後端 HTML 邀請確認頁。OTP 寄送／驗證也是 HTML form，不另用 Axios 重建寄碼流程。
2. 驗證成功 303 到現有 `/external-signatures/:signerPublicId`。這個路徑名稱不代表只能外部員工；不要要求額外一般登入。
3. 頁面以受限 cookie 呼叫 POST external-signing-task；比對回傳 signerPublicId 與頁面。簽署／拒簽提交使用頁面 UUID，同次網路重試保留 requestId。
4. signer.type=user 也走相同簽署元件及 API；日期由後端填，條款版本取回應，allowReject 控制拒簽。不要顯示員工內部 metadata 或建立人資訊。
5. 已簽狀態直接顯示完成頁，以 GET task 輪詢 completion pending／processing；ready 下載、failed 顯示聯絡發起人。沿用既有每 3 秒輪詢並於終態停止。
6. 401 引導重開邀請驗證；409 signer mismatch 不可繼續送出；尚未開始依 startAt 顯示台北時間。不可把受限通道的 401 當作一般員工登入失效而強制導回 Portal。
7. 「我的簽署」此次未正式化；舊個人操作回 403 ESIGN_EMAIL_OTP_REQUIRED 時提示從邀請信開啟，不重試舊免 OTP API。不可在前端直接取得／設定 HttpOnly cookie。

## 催簽與補簽

- 全部／指定催簽均可選內部人員，移除僅外部限制；202 是受理，依 notification-batches 的逐人結果顯示，不推定已送達。
- 日額度跟每位簽署人走，與 OTP 冷卻分開；不依 email 去重。
- 補簽後自動寄新邀請，以 invitation 通知批次顯示進度。舊 reopening-invitations 可能 []，因寄送後密文清除，不把 [] 顯示成補簽失敗。
- 已簽者維持原邀請下載；無須要求所有人重新簽署。

## 前端接續驗收與已知限制

- 新 POST、錯誤碼與 migration 已實作；仍須由實際環境確認已部署的版本，不能僅因本機文件存在就假定 dev 已更新。
- 明列後端測試結果及未驗證限制；前端需另驗桌面／手機簽名、邀請導頁、同源 cookie、錯誤提示與下載。
- 不擴充為完整「我的簽署」或無關 forms 原型重構；如要擴大，另以需求決定。
- 舊無固定信箱／邀請世代的指派不自動回填或補寄；舊通知 log 缺少 generation 也不寄送。請以新發起文件驗收，不能以員工登入繞過 OTP。
- 既有 DELETE session 路徑不在 credential cookie Path 下，本次未修完整登出；不要將該操作當作已驗證的全域撤銷。8 小時到期、單一指派授權與補簽世代驗證仍由後端執行。
