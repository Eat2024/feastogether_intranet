# Specification Quality Checklist: 簽署人候選組織架構與兩小時快取

**Created**: 2026-10-19

**Feature**: [spec.md](../spec.md)

## 需求完整性

- [x] 包含使用者情境、可獨立驗證案例、功能需求、邊界情況與可量測成功條件。
- [x] 定義 candidate 路由、內部 session 驗證、允許欄位及既有回應 envelope。
- [x] 區分兩小時 TTL、讀取不續期、過期後按需更新與背景排程。
- [x] 明確定義成功空陣列可以快取，錯誤不得轉成空陣列；任一筆必要資料格式錯誤整批拒絕，不略過資料。
- [x] 跨實例共用快取；依使用者要求移除併發協調，允許同時未命中重複呼叫。
- [x] 涵蓋上游 401/403、逾時、格式錯誤與 Redis 讀寫失敗的 502／503 契約。
- [x] 明確說明失敗重試與 Redis 清空可能在兩小時內增加上游嘗試；不宣稱硬性限流。
- [x] 明確說明上游 60 秒快取造成的額外資料年齡。
- [x] 明確標示逾時與失敗處理為草稿預設，無待填入模板佔位符。

## 範圍與專案原則

- [x] 不批次建立帳號、不建立資料表或 Repository、不新增環境變數／排程／過期資料 fallback。
- [x] 新 GET 不產生 MySQL 業務寫入；指出既有 candidate GET 的帳號匯入行為屬另案問題。
- [x] 組織樹不取代 Server 的簽署資格與授權檢查，也不宣稱既有本機查詢能即時驗證在職。
- [x] 不揭露 API Key／session，禁止名冊進入日誌；只快取及回傳必要欄位。
- [x] 前端介面、即時 HR 資格驗證與 Role／Permission／部門授權列為範圍外；組織樹只列正式員工，API 僅驗證既有員工 session。
- [x] 技術契約及 Redis 約束限定於本次 API／快取需求，無預先建立通用框架。
- [x] 沿用 Redis get/set，不新增鎖或專用命令，符合 KISS。
- [x] 未將文件建立或已可用的上游 API 描述成 intranet 功能已實作。

## 驗證紀錄

- 已對照根目錄 AGENTS.md、Constitution 1.3.0、既有 candidate controller/service、饗賓 client/config、RedisService 與 response interceptor。
- Spec 05 已被既有規劃保留給一般匯出，本文件使用 Spec 06。
- 本次為 Markdown 文件變更，執行相對連結、必要段落與差異檢查；未執行應用程式 lint/test/build，原因是未修改任何執行碼或設定。功能與併發行為仍須在後續實作驗證。

- 2026-10-19 grilling 共識已整理到 spec 的 Clarifications、功能需求與驗收情境；已完成 plan、research、data-model、API contract 與 quickstart。依使用者要求採 KISS，停在規劃階段，未產生 tasks 或執行碼。
