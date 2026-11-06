# Spec 030 整合分支審查

日期：2026-11-06。比較範圍 `git diff 29469e7e1e143e6ec8b5c29fdd52734c00c8b741...7165290`；以開發前 dev 為基準，涵蓋 4 張 tickets。兩個獨立代理唯讀審查，未重跑共享資料庫測試。審查前完整驗證見 [validation.md](validation.md)。

## Standards

0 項發現。依 root/client/server AGENTS、constitution、domain 與 issue-tracker 規則，檢視前後端、worker、repository、測試及容量工具，未發現需修正的明確規範違反或具實質影響的 baseline smell。

- 權限及快照判斷保留在後端，資料操作沿用傳入的 EntityManager。
- 新版發布與舊版狀態變更在交易內完成，實體清理位於交易後；清理失敗不降級成功工作。
- 文件 expired、非 ZIP 共用相容與 expiresAt/index 保留，無 migration/schema 變更。
- 容量工具限制專用測試 DB 與本機儲存路徑；提交證據為合成資料，未見 cookie、token 或真實個資。

## Spec

0 項可確認的缺漏、錯誤實作或範圍外變更。已比對 FR-001–FR-016 與 API／資料模型契約：固定快照、共用工作、不自動追新、成功後才取代清理、提交結果不明保護、刪後回寫恢復、共享物件參照、舊 URL／Range／權限，以及 requestedId 與取代後快取刷新。

expired 界線符合使用者最新指示。容量查詢避免攜帶大型 JSON 排序，已有 6,000→6,001 實際產製、內容完整性與舊檔清除證據。

Standards 0 項、Spec 0 項；兩軸均無需修正的最嚴重問題。審查不替代部署環境容量驗收。
