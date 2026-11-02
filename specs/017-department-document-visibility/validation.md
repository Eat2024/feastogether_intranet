# Spec 017 實作驗證

## 基線與範圍（T001／T002）

- 整合分支：`implement/spec-017-department-visibility`；review 基準：`6f81e3ae71286ed7bcdb1c49c9a2bc5741ea0a64`（已合併 PR 37 規格）。
- 開始前僅 `.scratch/017-department-document-visibility/` tickets 未追蹤，無使用者程式 diff；保留原檔案。已讀 root/client/server AGENTS、憲章及全部 Spec 017 設計文件。
- requirements checklist：13 checked、0 unchecked；只代表規格品質。無 extensions.yml hooks；ignore 已涵蓋 env、node_modules、dist、.next、coverage、私有 storage。
- 基線查核：client 固定 role=created，server DTO 只允許 created/assigned，無 role=all 試作。
- 前置腳本需用 SPECIFY_FEATURE_DIRECTORY 明確指定本 feature；原環境指向不存在的 Spec 019，已用本次命令覆寫，未改專案腳本。
- 本機專用容器 intranet-spec017-mysql（127.0.0.1:13317，MySQL 8.4）、intranet-spec017-redis（127.0.0.1:16317）；測試 DB feastogether_intranet_test017，保留原測試 DB 前綴保護。不用既有 UAT／正式連線或其他專案 Redis。
- 基線 `pnpm lint`：0 errors、267 warnings；server unit：108 suites／1,004 tests 通過（merge hook）。
- 本機明確覆寫 DB／Redis 連線及清空 SSL 設定後 `pnpm -C server test:schema`：3 suites／14 tests 通過。過往 MySQL 驗證失敗已由本次可用的獨立環境排除；mysqladmin ping、Redis ping 均成功。
- 後續命令沿用上述環境，schema／E2E 序列執行。尚未實作、未驗證本功能、未執行 UAT。

## 需求與驗收追蹤

| 需求 | 主責 tickets | 驗收案例／證據（待實作） |
| --- | --- | --- |
| FR-001/002、SC-001 | 04/05/10 | 同部門精確列表、兩部門每部門兩位建立人、六狀態與刪除排除 |
| FR-003、SC-002 | 02/06 | 新建非空快照、交易失敗清檔、調職／流程不覆寫 |
| FR-004 | 03/06/09 | 三種正式登入、缺碼清空、上游失敗、舊 session |
| FR-005、SC-003 | 04/05/08/10 | 唯讀 DTO、管理 GET、憑證／個資裁切 |
| FR-006、SC-004 | 05/10 | 姓名／員編／標題、日期、狀態篩選與清除 |
| FR-007 | 04/10 | all／偽造部門拒絕、個人查詢回歸 |
| FR-008 | 03/04/05/10 | 草稿唯讀、直接路由／mutation 拒絕且無副作用 |
| FR-009/012、SC-005 | 09/10 | 隔離回填／回復、舊 ID 清單及簽署證據不變 |
| FR-010 | 07/08/10 | Excel/PDF/ZIP／歷史／計數、直接 ID／Range、調職拒絕 |
| FR-011 | 07/08/10 | 本人跨部門簽署／副本、外部 OTP／副本與公開驗證回歸 |

## 實作決策差異

- Spec 018 已使用 migration timestamp 1793577600000；Spec 017 改用後續唯一 timestamp 1793664000000，功能及 schema 範圍不變。
