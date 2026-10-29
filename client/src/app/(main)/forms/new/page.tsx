import LinkTabs from "@/components/LinkTabs";
import PageHeader from "@/components/PageHeader";
import StepFlow from "@/components/StepFlow";
import UploadEditor from "@/features/forms/editor/UploadEditor";
import { CREATE_STEPS, SHEET_STEPS } from "@/features/forms/editor/steps";
import SheetEditor from "@/features/forms/sheet/SheetEditor";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import { Alert, Box, Button } from "@mui/material";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "新增電子簽文件" };

// TODO: 後端完成簽到表後改為串接 API，並拿掉「尚未完成」標示與提示
const TYPES = [
  { value: "upload", label: "一般文件（上傳）", href: "/forms/new" },
  {
    value: "sheet",
    label: "簽到表（尚未完成）",
    href: "/forms/new?type=sheet",
    // 後端尚未支援簽到表，先停用此分頁
    disabled: true,
  },
];

export default async function NewFormPage({
  searchParams,
}: PageProps<"/forms/new">) {
  const isSheet = (await searchParams).type === "sheet";

  return (
    <>
      {/* 嵌入入口網時隱藏：入口網已有「電子簽列表」選單 */}
      <Box className="hide-when-embedded">
        <Button
          variant="text"
          startIcon={<ArrowBackRoundedIcon />}
          href="/forms"
        >
          返回電子簽列表
        </Button>
      </Box>

      <PageHeader
        title="新增電子簽文件"
        description={
          isSheet
            ? "設定簽到表的表頭資訊，表格會依簽署名單自動產生，每位簽署人在自己那一列簽到。"
            : "上傳 PDF 文件，逐頁預覽並指定簽名要落在哪裡。"
        }
      />
      <LinkTabs value={isSheet ? "sheet" : "upload"} tabs={TYPES} />
      {/* 簽到表仍是前端原型（mock store），尚未串接後端 */}
      {isSheet && (
        <Alert severity="warning" variant="outlined">
          簽到表功能尚未完成（後端尚未支援），目前僅供預覽流程：建立的簽到表只存在暫存資料中，
          不會出現在電子簽列表，也不會通知簽署人，系統重新啟動後就會消失。
        </Alert>
      )}
      <StepFlow steps={isSheet ? SHEET_STEPS : CREATE_STEPS} activeIndex={0} />
      {isSheet ? <SheetEditor /> : <UploadEditor />}
    </>
  );
}
