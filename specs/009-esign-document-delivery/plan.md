# Implementation Plan: 電子簽文件與簽署人管理補強

**Branch**: `dev`（實際 git 分支；setup-plan 回傳的 `009-esign-document-delivery` 為 feature 識別，未切換分支）
**Date**: 2026-10-20 | **Spec**: [spec.md](spec.md)
**Status**: Phase 0／1 設計完成；本地 role／permission 依使用者決定延後。計畫階段已完成；後續依使用者授權產生 [tasks.md](tasks.md)，尚未實作。

## Summary

在現有 esign feature 內擴充草稿設定、依 watermark 產製副本、拒簽終態、外部人工催簽、管理備註與歷程身分。大量副本匯出重用既有完成 PDF，由獨立匯出 queue 的 worker 串流生成 ZIP64；完成後七天內，所有有權限的申請人共用同一文件的固定成果。人資可跨建立人查找及匯出全部文件，其他管理寫入不因此擴權。

## Technical Context

| 項目 | 設計 |
|---|---|
| Language/Version | TypeScript，server Node >=20.19、NestJS 11／Fastify；client Next.js 16／React 19 |
| Primary Dependencies | TypeORM 0.3、MySQL 8.4、Redis 7、BullMQ、pdf-lib、nodemailer、AWS S3 SDK；新增 archiver、@aws-sdk/lib-storage、@pdf-lib/fontkit 及對應必要型別，僅在實作時安裝 |
| Storage | 既有 MySQL 業務與稽核紀錄、Redis session／queue、local 或 S3 私有檔案；保留既有表並擴充欄位 |
| Testing | server Jest unit／MySQL+Redis e2e／schema／security；client lint+build+手動瀏覽器驗收，現無 test script |
| Target Platform | 既有 HTTP process 與獨立 worker；同源 Next.js proxy；受權限保護的原生瀏覽器下載 |
| Project Type | pnpm workspace Web 應用 |
| Performance Goals | 6,000 份、多於 4 GiB；受理 p95 ≤5 秒；相同簽署負載 p95 增幅 ≤20%；未宣稱已測達成 |
| Constraints | 不將整包讀入 Buffer、不重繪已有 PDF、沒有內部催簽、沒有新補簽流程、不改已成立證據 |
| Scale/Scope | 六個故事、FR-001–041；一次一份文件所有已簽副本，非跨文件總 ZIP |

## Constitution Check

| Gate | Phase 0 | Phase 1 設計檢查 |
|---|---|---|
| I KISS/YAGNI | 通過：利用既有 esign entities／maintenance | 匯出快照使用既有 job JSON；不新增通用權限框架、outbox 表或 scheduler |
| II Server 權威與證據 | 通過：固定 watermark／allowReject、原證據不改 | 文件鎖→簽署人鎖；簽與拒互斥；ZIP 校驗來源；結案只等待 signed 的 PDF |
| III 最小權限 | 通過：spec 明確授權人資跨文件匯出 | 通過：依最新明確需求，跨建立人匯出暫以有效員工 session 授權，不宣稱已驗人資；外部 session 不可存取 |
| IV 邊界／REST | 通過：新路由資源化、既有草稿舊路由相容 | Controller 薄層，Service 控制交易，Repository 經 MysqlModule 註冊；GET 不寫業務資料 |
| V 驗證 | 通過：文件規劃沒有執行產品測試 | 快照重用、午夜、競態、越權、token、migration 及大檔具驗收矩陣 |

最終 gate 已通過：Portal 管理發起入口，本專案暫不新增角色／permission。跨建立人匯出相關 API 可供所有有效員工 session 使用；保留資源歸屬、期限、資料裁切與既有管理寫入規則。後續角色機制另立規格，不預建權限表、欄位或旗標。

## Project Structure

```text
specs/009-esign-document-delivery/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── document-delivery-http-api.md
│   └── signer-management-http-api.md
└── checklists/requirements.md

server/src/features/esign/{controllers,dto,entities,repositories,services}/
server/src/worker/esign/                    # 匯出 processor，既有寄信／結案／維護擴充
server/src/infrastructure/file-storage/     # 串流寫入、Range、暫存物清理
server/src/infrastructure/database/         # migrations、MysqlModule 註冊
server/src/common/errors/                  # 集中錯誤碼／文案
client/src/api/                            # endpoints/types/requests/queries
client/src/features/esign-documents/       # 正式管理頁
client/src/features/external-signing/      # 外部本人拒簽
client/src/features/my-signature/          # 本次拒簽需要的正式 API 接點
```

## Phase 0：研究決策

詳見 [research.md](research.md)。原始碼已有拒簽欄位、通知表與匯出表，但沒有對應正式流程，不能當成功能完成。草稿已有外部名單支援，重點為前端回填與期間的原子保存；schema 目前不允許單端日期，必須修正草稿條件。

## Phase 1：設計順序與責任

1. **資料與契約基礎**：更新期間 check、拒簽狀態、通知結果、匯出 metadata；加入驗證與 mapper。匯出驗證有效員工 session，不新增本地人資辨識；保持 creator 管理寫入與跨建立人匯出分離。
2. **草稿／水印**：新增資源式草稿設定入口，舊 draftSave 委派同一 service；發起仍固定 payload。完成副本於 hash 前讀取固定 watermark，使用後端內建中文字型；前端恢復選項及完整暫存，不於下載時畫水印。
3. **拒簽／歷程／備註**：共用簽署資格及文件鎖；拒簽事件寫 audit chain，不建 signature record。統一結案 predicate，修改驗證 manifest 支援 mixed／all-rejected。mapper 使用事件 signer 身分，備註不入證據與本人 DTO。
4. **外部催簽**：DB 批次與明細先提交、queue 後入列；maintenance 補送漏入列。依台北曆日限制逐文件逐人，寄送前再驗證；同批去重及 requestId 防重。初次邀請與 reminder 共用投遞基礎，但各自保留類型及限額。
5. **大量匯出**：在短交易中固定已簽 record IDs；文件鎖保證同時只有一個可重用工作。背景等待原副本、逐份驗證與 ZIP64 串流、落檔後發布；七天內跨申請人共用，同文件新簽不觸發重新匯出。
6. **前端與驗收**：正式 API 的建立人管理、外部拒簽、人資查找及匯出歷史；原生下載使用同源 session，不先取得 Blob。以 quickstart 的風險矩陣驗收，不把 mock 頁等同正式串接。

此處記錄設計依賴；具體執行清單已整理於 [tasks.md](tasks.md)。

## 匯出資源與恢復策略

新增 `esign-export` queue，起始全域 concurrency=1，避免多 worker 各自 concurrency=1 合計無上限；與現有 PDF finalization queue 分開。按固定順序逐份開來源流、計算 SHA-256，完成一份才開下一份，不開 6,000 個流。STORE 為首版基準，驗收時比較 DEFLATE 1／6；只有量測支持才調整。

首版輸出一個 ZIP64（spec 允許單包），不預先做分包系統；以來源 metadata 計算 S3 part 大小，至少 16 MiB、queueSize=2，保證預估 part 數不超過 10,000。實測若單包對使用者下載明顯不合適，再在本 spec 允許範圍內採獨立 ZIP；不允許不完整部分先發布。

所有流與 multipart 共用 abort signal。`finalize()` 不是成功落檔，必須等 storage 完成並取得 size/hash，再以交易保存 file metadata 與 job completed。工作採 generation/lease fencing，過期 worker 不可發布新 worker 的成果。重試從同一快照重新建立 ZIP，不聲稱壓縮串流可從中段恢復；下載 Range 則直接讀已完成物件。

既有 30 秒 maintenance 加入有界批次：漏入列工作、過期 lease、完成滿七天成果及殘留暫存物清理，不新增 scheduler。期限到即禁止新下載／續傳，即使實體刪除尚未完成；已開始的下載可完成。保留歷史 metadata。local temp 以工作 generation 命名並掃描逾期檔；S3 multipart uploadId 與 generation 記入 job，維護時 abort，包含初始化後記錄前中斷的 prefix 孤兒掃描。只掃本功能前綴。

## Migration／設定／發布

- 只修改必要既有表；新欄位先 nullable/default，歷史批次標記 invitation，既有 jobs 不猜造快照，標為 legacy 不可重用。
- 新拒簽結果與日限額的索引／check、文件草稿日期 check、entity、schema.sql 及 schema tests 一起交付。
- 既有 watermark=true 而尚未產生副本者按固定設定生成；已存完成檔不覆寫。字型與授權檔由 server assets 隨 build 部署，不依賴作業系統字型。
- 不新增環境變數；沿用 storage／SMTP／worker 配置。必要 queue 常數與資源初始值放 feature；實測前不調高 production 併發。
- 回滾先停新 worker/API 寫入，保留所有已成立拒簽與證據。存在 rejected 或新通知結果時，down migration 必須拒絕縮回舊 check，不能刪資料硬降版；採相容版本回退或修正向前。

## Complexity Tracking

| 必要複雜度 | 當前需求／較簡單方案不足 | 移除成本 |
|---|---|---|
| 串流 storage＋ZIP64 | 6,000 份可能數 GB；全 Buffer 無法滿足資源限制 | 可移除匯出入口及專用方法，不改既有 PDF |
| 匯出 JSON 快照與 lease | 重試、七天重用及並發需要持久狀態；只靠 Redis 不夠 | 保留既有紀錄，移除 worker 即可 |
| 外部 reminder credential | 原邀請明文寄後清除，不能重寄或旋轉原 digest 損及已簽下載 | 保留原邀請不動，新增憑證可按作用域撤銷 |

以上為已確認功能的必要設計，非 constitution 例外；本輪使用者已明確決定延後本地 role／permission，無剩餘設計澄清阻礙。
