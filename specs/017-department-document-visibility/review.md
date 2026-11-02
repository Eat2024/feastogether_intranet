# Spec 017 PR review

日期：2026-11-02。比較固定點 `6f81e3ae71286ed7bcdb1c49c9a2bc5741ea0a64`（整合 PR 37 規格後、實作前）至實作分支；使用 `code-review` skill，兩個代理平行、分別核對 Standards 與 Spec。基準之後的實作提交見 `git log 6f81e3a..HEAD --oneline`；最後契約與 fixture 補正亦經額外唯讀核對。

## Standards

0 項硬性違規，0 項需修正的 smell。

依 root/client/server AGENTS.md、constitution、issue-tracker、triage-labels、domain 與 skill smell baseline 核對。授權及敏感資料裁切位於 server service；Controller 保持 HTTP 邊界，前端沿用 requests/queries 分層。Schema 同步 entity、migration、註冊、schema.sql 與驗證，未新增永久表、dependency 或環境變數。

管理、唯讀與匯出 DTO 明確區分，沿用既有 mapper。舊 E2E 的 outsider 改為不同合成部門，容量建立人明列合成部門；保留負向斷言。沒有額外 CODING_STANDARDS、CONTRIBUTING、GLOSSARY 或 ADR 規範。

## Spec

0 項可具體指出的缺漏、非必要擴張或錯誤實作。

目前有效 User 部門與文件快照精確比對；一般匯出沒有建立人例外。唯讀 DTO 裁切管理資料；寫入及邀請憑證仍要求建立人。Excel／PDF／ZIP 驗證當下部門及各層 ID 關聯，拒絕先於下載或新增紀錄。登入缺值清 NULL，建立交易鎖 User 保存快照。前端直接 edit/signers 路由不掛載非建立人的管理元件。

view=export／canExport 已記錄在補充契約，未增加新 API 路徑。T042 歷史規格與目前實作一致。OAuth 安全測試只 stub HR HTTP 邊界，保留正式 parser、state/nonce、重放拒絕、session、logout 與 mapping 斷言。

此為靜態 review，不能代替執行驗證；測試與 UI 證據見 [validation.md](validation.md)。真實 UAT 盤點／回填／部署不在本次已完成範圍。

Standards：0 findings；Spec：0 findings；兩軸皆無需優先修正項目。
