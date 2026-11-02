# 01: 白名單建立、撤銷與恢復

**What to build:** 建立七欄白名單與受控一次性資料維護，讓維運可追加、撤銷及恢復精確部門或員編。

**Blocked by:** 無，可立即開始

**Status:** resolved

- [x] 七欄 entity、repository、migration、schema 與註冊一致；精確 type/value 唯一鍵及 CHECK 拒絕非法資料，保留前導零。
- [x] 四筆初始規則為部門 1029030000、1029090000、1029010000 與員編 09005001；seed 與 schema 分離，重跑不變更既有列或復活撤銷規則。
- [x] 新增、軟刪除與恢復原列的程序可審查，有預期 key／影響筆數與安全回滾說明；無管理 API、UI、排程、額外欄位。
- [x] 以隔離測試 DB 驗證 constraint、重複／已撤銷資料、up/down/up 與 schema 一致；不得操作 UAT。

## 實作驗證紀錄

- 實作 commit：`3c4cdef`（`implement/spec018-01`）；已合併整合分支基準 `7e4b0f0`，已由 merger 快轉整合至 `docs/spec-018-mail-whitelist`（整合點 `3c4cdef`）。
- TDD：先確認 entity/migration 註冊測試失敗，再實作；維護行為測試先因 repository 缺漏失敗，實作後通過。
- 隔離 MySQL 8.4（本機專用容器 `127.0.0.1:13318`、`feastogether_intranet_test*`）schema：3 suites／14 tests 通過，含 up/down/up、無 drift、非法值、唯一鍵、七欄、前導零、seed 重跑及恢復原列。
- root lint 通過（server 既有 265 warnings、0 errors）；server 全單元 106 suites／964 tests 通過；server build 通過。
- schema.sql 從隔離 DB migration 後的 mysqldump 產生，僅新增白名單表；未操作 UAT、正式 DB 或真實 SMTP。
- 新增維護程序：`specs/018-nonproduction-mail-whitelist/maintenance.md`；repository 提供 `findActive(manager)`，由 MysqlModule 註冊匯出。
