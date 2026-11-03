# 02: 寄送政策套用信箱規則

**What to build:** 非 production 寄信時，命中信箱規則的完整地址直接允許；收件人全部命中時不查人資來源。外部簽署人的邀請、催簽與 OTP 因此可寄給明確列入的外部測試信箱，其他地址仍被阻擋。

**Blocked by:** 01-email-rule-schema

**Status:** resolved

**Source:** [Spec 021](../../../specs/021-external-mail-whitelist/spec.md)、[Plan](../../../specs/021-external-mail-whitelist/plan.md)、[Tasks](../../../specs/021-external-mail-whitelist/tasks.md)。

**Scope:** US1、US2，對應 T007–T013。

- [x] 政策服務讀取 `email` 規則，以正規化後的完整地址精確比對；同網域其他地址、plus alias、子網域、相近地址阻擋。
- [x] 收件人全部命中信箱規則時，組織樹與 `staff_emails` 查詢 0 次，人資來源故障也允許；仍有未命中者時沿用 Spec 018 解析並取聯集，人資故障時整次 check-failed。
- [x] 不修改 guarded sender、worker processor、OTP service、repository、seed 與 client；不新增 log、快取或環境變數。
- [x] OTP e2e：信箱規則命中且人資來源故障時回 200、可驗證、`external_otp.sent` 一筆。
- [x] Worker e2e：外部催簽命中信箱規則且人資來源故障時為 delivered。
- [x] Spec 018 的 spec、data-model、contract 相關段落註明已由 Spec 021 修訂，不改寫歷史驗證紀錄。
- [x] 執行 021 quickstart 全部指令並記錄結果；完成 Standards／Spec 雙軸 code review 並修正確認的發現。
- [x] 驗收通過後整合至功能整合分支，追加驗證與 commit 紀錄，再改為 resolved。

## Comments & Implementation Results

後續結果追加於此，保留上述驗收條件。

### 2026-11-03 實作結果（`implement/spec021-02`）

- 實作 commit：`d14c01e`（`implement/spec021-02`），pre-commit hook（root lint、server 單元測試 109 suites／1,085 tests）通過。
- 基準：整合分支 `docs/spec-021-external-mail-whitelist` tip `a7dbc7e`（含 Ticket 01）；隔離 MySQL 8.4（`127.0.0.1:13321`、`feastogether_intranet_test*`）、Redis 7（`127.0.0.1:16321`），未操作 UAT。
- 程式只改 `mail-recipient-policy.service.ts`：規則加 `emails` 集合，`loadActiveRules()` 以依 type 取值的小函式取代三段 filter／map；`allowedRecipients()` 先比對信箱規則，全數命中即回傳，否則只以未命中地址走原解析並取聯集。未改 guarded sender、worker processor、OTP service、repository、seed、client；未新增 log、快取或環境變數。

TDD 紅→綠：

1. 「信箱規則只放行完整相同地址」：紅燈為回傳 `Set {}`（預期含 `tester@example.test`）；加入 `emails` 集合與聯集後綠燈，同網域其他地址、plus alias、子網域、相近地址皆阻擋，組織樹與 `staff_emails` 0 次。
2. 「全數命中信箱規則時人資故障仍允許」：紅燈為拋出 `MailWhitelistCheckFailedError`；加入未命中地址為空即回傳的短路後綠燈，組織樹與 `staff_emails` 0 次。
3. 「信箱與員編並存取聯集」、「仍有未命中且人資故障時 check-failed」：寫入時即綠（前兩片實作已涵蓋）。以變異確認有效：拿掉聯集只回人資結果時案例 3 失敗；吞掉人資錯誤時案例 4 與既有來源故障案例失敗；還原後政策單元 15 項通過。
4. E2E：暫時換回變更前的政策服務執行，新 OTP 案例回 403（預期 200）、新外部催簽案例 `upstream.post` 被呼叫 1 次（預期 0）；換回新服務後 OTP 與 worker 兩個 suites 共 20 tests 通過。

驗證（T012，結果同步記於 021 quickstart）：

- `pnpm -C server test --runInBand`：109 suites／1,085 tests 通過（Ticket 01 後 1,081，新增 4 項）。
- `pnpm -C server test:schema`：4 suites／25 tests 通過。
- `pnpm -C server test:e2e:security`：14 suites／84 tests 通過。
- `pnpm -C server test:e2e`：34 suites／379 tests 通過，178.751 秒。
- `pnpm -C server lint:check`：0 errors、268 warnings（皆在未變更檔案；本次 4 個 server 檔 ESLint 0 problems）。
- `pnpm -C server build`：通過。
- 未執行：021 quickstart「環境上版」三步驟（部署時維運程序）、T013 Standards／Spec code review（由主控另行執行）。

與 plan 的差異：

1. 政策服務與 plan Implementation Design 第 4 點一致；只多更新 `allowedRecipients()` 註解說明全數命中時不查人資。
2. OTP e2e 的 `allow()` 改為可帶 `(type, value)`，預設仍為員編規則；`beforeEach` 另刪除同一信箱規則。合成 `hr.post` 非 jest mock，「人資查詢 0 次」以 `sourceFailed` 時 `post` 必丟錯仍回 200，加上既有 `afterEach` 的 `hr.get` 0 次斷言證明。
3. Worker e2e 每案使用獨立 schema DB，不需清除；fixture 原有員編規則 `WL0301`，若未短路就會呼叫已設為失敗的 `upstream.post`，案例直接斷言 0 次。
4. Spec 018 註記：spec 的 US4-2、FR-002、FR-004、Assumptions 各加一行巢狀項目；data-model 除「不存 Email」外，欄位表下也加一行（表中 `type`／`value` 定義同被修訂）；contract 於「可信收件人政策」開頭加一行。018 maintenance 已於 Ticket 01 更新，本票未再修改；018 歷史驗證紀錄未改寫。

### 2026-11-03 Code review 修正（`implement/spec021-review-fixes`）

基準為整合分支 `docs/spec-021-external-mail-whitelist` tip `c1fafec`。只改 server 測試、政策服務命名與文件，不動 client、migration、seed、guarded sender、worker processor 或 OTP service。

Standards 發現與處理：

1. 命名：`allowedRecipients(emails)` 的參數與 `rules.emails` 同名易混。改名為 `recipients`，`matchRecipientEmails()` 參數一併對齊；JSDoc 註明「收件地址須已由寄送邊界正規化（trim、小寫）」。行為不變。
2. 測試重複：`mail-whitelist-schema.e2e-spec.ts` 自寫的「最後一支 migration」SQL 與 `revertAfter` 相同。`schema-migration.helper.ts` 匯出 `lastMigrationName()`，`revertAfter()` 與回滾測試共用；回滾測試另抽出 `tableDefinitionBefore021()`，主測試只留 down／up 流程。
3. 測試重複：政策單元測試兩個新案例重複的三行「不查人資」斷言抽成 `expectNoHrLookup()`；worker e2e 的 `manager.save(MailRecipientWhitelist, manager.create(...))`（fixture 員編規則、群發新增規則、信箱規則共三處）抽成 `saveRule()`，remark 統一為「合成規則」。

Spec 發現與處理：

1. FR-010：回滾測試未證明既有規則 id 保留。新增斷言：成功 down 與再 up 後，員編規則 `E001` 的 id 與 down 前相同。紅燈以暫時在 down 後刪除並重新插入 `E001` 確認斷言會失敗（Expected/Received 不同），移除變異後綠燈。
2. SC-001／FR-004：worker e2e 只涵蓋外部催簽。原案例改為 `it.each(['invitation', 'reminder'])`，兩者皆斷言人資 `post` 0 次、delivered、`external_<kind>.delivered` 稽核一筆。暫時讓政策的信箱規則比對恆為 false 時兩案皆失敗，還原後通過。
3. Spec 狀態過時：`spec.md` Status 改為 Implemented（未部署）；Assumptions「本次交付僅規格與品質檢查」改為 server 已實作、上版程序待執行。
4. 行為變更未記載：Edge Cases 補「群發輸入全部不是合法單一信箱時，白名單檢查收到空清單，不查人資即全數 blocked，與單封不合法地址一致；取代先前可能因人資故障記為 check-failed 的結果」，並註明規則表讀取失敗仍為 check-failed。
5. US3-2 過度承諾：改為只承諾 DB 拒絕列舉的格式錯誤，並補「DB 不做完整信箱格式驗證，規則值須為寄送端可接受的地址，否則永遠不會命中」；`specs/018-nonproduction-mail-whitelist/maintenance.md` 信箱格式段落加註同一句。
6. US2-2 無 021 專屬測試：不新增，於 quickstart 註明由既有 `guarded-invitation-mail-sender.service.spec.ts`「單一地址正規化後核對並將相同地址交付 adapter」案例涵蓋。

驗證（同步記於 021 quickstart）：

- `pnpm -C server test --runInBand`：109 suites／1,085 tests 通過。
- `pnpm -C server test:schema`：4 suites／25 tests 通過。
- `pnpm -C server test:e2e:security`：14 suites／84 tests 通過。
- `pnpm -C server test:e2e`：34 suites／380 tests 通過，181.167 秒（新增外部邀請案例）。
- `pnpm -C server lint:check`：0 errors、268 warnings（皆在未變更檔案；本次 5 個 server 檔 ESLint 0 problems）。
- `pnpm -C server build`：通過。
- 未執行：021 quickstart「環境上版」三步驟（部署時維運程序）。Status 維持 `claimed`，待整合後改為 resolved。

### 2026-11-03 整合

- 主控檢視後以 fast-forward 整合至 `docs/spec-021-external-mail-whitelist`：實作 `1a1e410..c1fafec`、code review 修正 `c1fafec..a8c9d01`，皆無衝突；Status 改為 resolved。
