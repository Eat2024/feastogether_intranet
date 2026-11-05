# 01: 安全產生與驗證 Super user 專用帳密設定

**What to build:** 維護者透過不連外的互動工具產生 Super user 專用密碼雜湊；服務只接受符合契約的唯一 Super user 帳密設定，並能穩定辨識設定版本。這組設定與 OAuth 無關，不用於員工登入或 OAuth client 驗證。

**Status:** ready-for-agent

**Blocked by:** 無（可直接開始）

**Source:** [Spec](../../../specs/027-super-user-access/spec.md)、[Plan](../../../specs/027-super-user-access/plan.md)、[Tasks](../../../specs/027-super-user-access/tasks.md)、[資料模型](../../../specs/027-super-user-access/data-model.md)、[API 行為](../../../specs/027-super-user-access/contracts/api-behavior.md)、[維運契約](../../../specs/027-super-user-access/contracts/operations.md)、[驗收指南](../../../specs/027-super-user-access/quickstart.md)。

**Scope:** T005、T011、T027。

## Acceptance Criteria

- [ ] 離線工具以 TTY 無回顯輸入及二次確認取得密碼，只輸出 hash；不接命令列密碼、不載入 Nest／DB、不留密碼歷史。
- [ ] 僅使用 server-only 的 `SUPER_USER_ACCOUNT`／`SUPER_USER_PASSWORD_HASH` 驗證 Super user；不讀取、修改或共用 OAuth 員工帳密、client ID／client secret，不將這組帳密送往 OAuth 專案。一般員工保留 OAuth／WebView，後續僅共用 intranet 會話機制。
- [ ] 僅接受兩個 Super user 專用 server-only 帳密設定與固定 scrypt 格式：N=32768、r=8、p=1、salt 16 bytes、derived key 64 bytes、maxmem 64 MiB；缺漏或格式錯誤明確失敗，沒有預設密碼或 fallback。
- [ ] 帳號及密碼不 trim／normalize；非同步 KDF、固定長度安全比較，錯帳號仍執行相同 KDF 工作量。
- [ ] fingerprint 使用契約既定 domain separation 與序列化；同一 hash 穩定，新 salt 視為新版本；本張不自動啟用 DB 版本。
- [ ] 使用合成 fixture 驗證合法／非法設定、輸入邊界與 fingerprint 行為；不提交真實 secret、不新增密碼 dependency。

## Comments & Implementation Results

（尚未開始）
