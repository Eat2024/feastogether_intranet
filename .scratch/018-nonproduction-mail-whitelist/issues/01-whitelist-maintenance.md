# 01: 白名單建立、撤銷與恢復

**What to build:** 建立七欄白名單與受控一次性資料維護，讓維運可追加、撤銷及恢復精確部門或員編。

**Blocked by:** 無，可立即開始

**Status:** claimed

- [ ] 七欄 entity、repository、migration、schema 與註冊一致；精確 type/value 唯一鍵及 CHECK 拒絕非法資料，保留前導零。
- [ ] 四筆初始規則為部門 1029030000、1029090000、1029010000 與員編 09005001；seed 與 schema 分離，重跑不變更既有列或復活撤銷規則。
- [ ] 新增、軟刪除與恢復原列的程序可審查，有預期 key／影響筆數與安全回滾說明；無管理 API、UI、排程、額外欄位。
- [ ] 以隔離測試 DB 驗證 constraint、重複／已撤銷資料、up/down/up 與 schema 一致；不得操作 UAT。
