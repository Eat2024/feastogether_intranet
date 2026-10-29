import PageHeader from "@/components/PageHeader";
import ExportHistoryView from "@/features/export-history/ExportHistoryView";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = { title: "歷史匯出文件" };

// 紀錄由後端 GET /api/esign/history/export 取得（ExportHistoryView，瀏覽器端呼叫）；所有員工皆可查看（Spec 015）
export default function ExportHistoryPage() {
  return (
    <>
      <PageHeader
        title="歷史匯出文件"
        description="查看所有人匯出的簽署紀錄與已簽署文件，並可重新下載。"
      />
      {/* useSearchParams 需要 Suspense 邊界 */}
      <Suspense>
        <ExportHistoryView />
      </Suspense>
    </>
  );
}
