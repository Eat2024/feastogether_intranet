# Spec 009 實作紀錄

## Ticket 01：草稿完整設定

- 基線：整合分支 `feature/009-esign-document-delivery`，commit `f28272b`；工作分支 `009/01-draft-settings` 由此建立，沒有覆寫根工作目錄變更。
- 六故事對照：US1 草稿由 Ticket 01 交付；US2 浮水印 → 02、US3 ZIP → 07–09、US4 拒簽 → 03、US5 催簽 → 05–06、US6 管理 → 04；整體驗收 → 10。
- 新增 PATCH `documents/:id/draft-settings`，名單／日期／選項在既有文件鎖交易內保存；舊 PUT `draftSave` 委派相同服務、HTTP 回應仍為簽署人陣列。
- 草稿日期允許單端／過去日期；未傳保留、null 清空；明確帶時區的 ISO 日期，兩端皆有時須開始早於結束。正式發起維持原驗證。建立人詳情回傳 watermark／allowReject，沒有憑證或簽名新增洩漏。
- 正式設定頁回填混合／外部名單、日期、選項；使用台北日界線、提供清空日期操作；發起送選取值。水印繪製與拒簽流程仍依賴 Tickets 02／03，必須隨完整 Spec 009 整合發布。
- migration `1792454400000-DraftSettings` 只改現有期間 CHECK，正式狀態需要完整期間；有單端草稿時 down 拒絕清值回滾。沒有新增環境變數或相依套件。

### 驗證

- TDD：新增 service 公開入口測試先失敗（缺少 saveDraftSettings），實作後通過。
- `pnpm -C server test --runInBand`：92 suites／815 tests 通過。
- `DB_MYSQL_DB=feastogether_intranet_test_009_01 pnpm -C server test:e2e esign-draft-settings`：16 tests 通過，含登入後回填、舊 API、單端／清空／省略、非法日期及名單全不變、名單替換後注入資料庫失敗亦完整回滾、session／Origin／建立人／正式狀態保護、暫存不建立邀請、實際同時儲存與發起後僅完整發起設定生效。
- `DB_MYSQL_DB=feastogether_intranet_test pnpm -C server test:schema`：2 suites／6 tests 通過；schema helper 建立隨機隔離資料庫，含 no drift、指定歷史版本升級、單端草稿拒絕 down。schema helper 會追加 UUID，因此不使用超過 MySQL 64 字元上限的長前綴。
- `pnpm build` 與 `pnpm lint`：通過；server lint 有既有 warnings。client 未新增自動測試框架；另以本機既有 Playwright core + Chrome 執行臨時瀏覽器驗收，詳見下節。
- T004／T009 的原未完成驗收已在第二輪補齊，不再留待 Ticket 10。
- 工作目錄使用 frozen lockfile 安裝依賴；初始共用 node_modules symlink 被 Turbopack 拒絕後已移除，沒有修改 lockfile。

### 第二輪：實際並發與瀏覽器驗收（2026-10-20）

- 基於整合 commit `489a0bd`，新增永久 HTTP e2e 同時發出保存與發起兩請求；允許保存先成功或被409拒絕，最終名單、完整期間及兩選項必須全為發起版本，不能混入草稿內容。永久 suite 16/16 通過。
- 使用本機既有 Playwright core 1.57 + Google Chrome，Next dev `39002` → 真正 Nest HTTP `39001` → 隔離 MySQL，沒有 mock API。臨時 suite 含永久16項與瀏覽器1項，17/17 通過。
- Chrome 時區刻意設為 `America/Los_Angeles`。以合成組織與一內部一外部名單載入，確認台北起迄日期與選項；畫面新增外部人、取消 watermark、清空開始日並按暫存，API回傳草稿、三位完整名單、null 開始日、台北結束日、watermark=false／allowReject=true。關閉 browser context 後重新進入，同樣回填名單與日期選項，無發起。
- 實測修正舊 tooltip／按鈕／成功訊息，清楚表示暫存名單、期間與選項。
- 合成截圖：`/tmp/esign009-draft-roundtrip.png`；臨時自動化腳本 `/tmp/esign009-draft-browser.cjs`。測試腳本只從環境取合成 session，不輸出 cookie。臨時 Jest spec、合成 org-chart.json、Next 生成 AGENTS 區塊均已移除，Next已停止；未新增專案框架或提交個資。

## Ticket 02 — 後端依固定設定繪製浮水印

程式、字型來源、TDD、實際渲染與下載一致性結果見 [浮水印驗證紀錄](implementation-notes-watermark.md)。保留 watermark 選擇，由後端在副本 hash 前加印；繁體字型為改名 OFL TrueType 子集，正式下載不重畫。已實際渲染八頁並解碼四種旋轉頁的 QR。ZIP 一致性待 Ticket 10 整合。

## Ticket 05 — 單人外部催簽

- 真API先提交batch/log後入列；目前沿用外部邀請queue與既有maintenance，不新增排程或環境變數。通知worker按kind分流，原邀請digest不旋轉；提醒token獨立雜湊/密文且綁原邀請世代，SMTP接受後清密文、保留OTP入口。
- 明確未寄送最多三次；SMTP資料階段斷線等不確定結果及過期lease均標unknown，不自動再寄。pending/processing跨午夜阻擋新申請，delivered/unknown按實際派送台北曆日佔額度。
- 新增notification欄位migration `1792454402000`，同步entity/schema、時間索引、唯一鍵及舊邀請寫入預設。已有reminder紀錄時拒絕down，避免抹掉憑證與稽核。
- 單人通知正式元件透過API、同操作requestId與結果輪詢；原邀請狀態不會被催簽結果蓋掉。完整多選/全部及分頁歷史仍由ticket06交付。
- 驗證：server 830 unit tests、schema 6 tests、reminder API/worker 8 e2e tests；server/client build與lint通過（server既有warning）。純資格測試覆蓋台北23:59:59/00:00及跨日in-flight；e2e覆蓋新舊邀請OTP、世代撤銷、SMTP unknown、有限重試、寄前停止、過期lease、並發受理與migration回退保護。

### Ticket 05 整合與瀏覽器驗證

- 已merge `9f22302`，保留ticket04管理備註/拒簽/歷程。合併後root build/lint、98 suites/833 tests及schema6 tests通過。
- 真Chrome（台北時區）對真Nest/API+MySQL執行單人催簽→202受理→worker fake SMTP投遞→當日限制→reload仍已寄出，全部通過。截圖 `/tmp/esign009-reminder-browser.png`；臨時fixture及server已清除，沒有新增測試框架。
- 發布順序：先通知migration，再以新worker取代所有舊邀請worker，最後開啟新催簽API；不能讓舊worker消費reminder。若需回退，先停新API受理與worker並保留通知資料，已有reminder時migration拒絕down；原邀請寫入可使用public UUID資料庫預設。
