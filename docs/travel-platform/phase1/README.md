# 旅遊平台重購 phase 1 需求紀錄

> 來源：ClickUp doc「旅遊平台重購 PRD」（workspace `90181017325`，doc `2kzka7qd-9618`）的 phase 1。整理日期 2026-11-05。

## 讀這批文件前要知道的事

- **ClickUp 頁面只是入口**：phase 1 的 ClickUp 頁面大多只有連結和開發提醒，需求本體在頁面連結的 Google Drive PRD（專案管理部 Hadid 撰寫，HTML＋zip）。各文件開頭都寫了實際依據的 PRD 版本。
- **有三類連結讀不到**：
  - 每頁都連到一份 Claude artifact「PRD_claude」，我們沒有權限。它和 Drive 版哪一份比較新，還沒確認。
  - Figma 原稿沒有讀。
  - 投票活動設定的 PRD.zip 超過 10 MB，下載失敗。
- **「首頁」是空白頁**：投票入口卡片屬於還沒寫的〈S1-01 首頁／活動總覽〉PRD。
- **「(央廚)」不是旅遊平台的需求**：兩份「(央廚)」頁是另一套系統「庫存驗收系統（央廚驗收系統）」的 PRD。旅遊平台沿用它的程式再改寫規則，放在這裡供對照。
- **截圖沒有存進 repo**：截圖已轉成文字。從截圖推論的內容標「（依截圖）」，推測一律放在各文件的「待釐清問題」。

## 頁面索引

| ClickUp 頁面 | 文件 | 依據的 PRD | 需求編號 |
|---|---|---|---|
| 首頁 | （空白，未建檔） | — | — |
| 權限管理-角色管理 (央廚) | [roles-central-kitchen.md](roles-central-kitchen.md) | 央廚驗收系統角色管理（ClickUp 頁本文） | ROLE-CK-01～25 |
| 權限管理-帳號管理 (央廚) | [accounts-central-kitchen.md](accounts-central-kitchen.md) | 庫存驗收系統帳號管理 PRD v1.0 | ACCT-CK-01～22 |
| 角色管理 | [roles.md](roles.md) | 角色管理 PRD v0.7（草稿） | ROLE-01～48 |
| 帳號管理 | [accounts.md](accounts.md) | 帳號管理 PRD v0.9（草稿） | ACCT-01～62 |
| 操作紀錄_最後有時間再做 | [operation-log.md](operation-log.md) | 帳號管理、角色管理 PRD 的稽核章節（無獨立規格） | LOG-01～06 |
| 投票設定（列表） | [voting-list.md](voting-list.md) | 投票活動設定 PRD v0.79 | VOTE-LIST-01～22 |
| 投票活動設定(含名單匯入&候選行程) | [voting-activity-settings.md](voting-activity-settings.md) | 投票活動設定 PRD v0.79 | VOTE-SET-01～76 |
| 投票頁 | [voting-page.md](voting-page.md) | 投票頁 PRD v0.63（待審閱） | VOTE-PAGE-01～41 |

## 相關文件

- [../system-flow-overview.md](../system-flow-overview.md)：PRD 首頁連結的「系統操作主流程」drawio 轉成文字，涵蓋 phase 1 和 phase 2。
- [../architecture-issues.md](../architecture-issues.md)：在本專案落實這些需求前，要先處理的架構議題。
- PRD 首頁另外連結了《功能清單初稿》Google Sheet，我們沒有存取權限，所以沒有讀到。
