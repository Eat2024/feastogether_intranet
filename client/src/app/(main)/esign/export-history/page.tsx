import PageHeader from "@/components/PageHeader";
import { ROUTES } from "@/constants/routes";
import ExportHistoryView from "@/features/export-history/ExportHistoryView";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = { title: ROUTES.esignExportHistory.label };

// 紀錄由後端 GET /api/esign/history/export 取得（ExportHistoryView，瀏覽器端呼叫）；所有員工皆可查看（Spec 015）
export default function ExportHistoryPage() {
  return (
    <>
      <PageHeader
        title={ROUTES.esignExportHistory.label}
        hideTitleWhenEmbedded
        description="查看所有人匯出的簽署紀錄與已簽署文件，並可重新下載。"
      />
      {/* useSearchParams 需要 Suspense 邊界 */}
      <Suspense>
        <ExportHistoryView />
      </Suspense>
    </>
  );
}
