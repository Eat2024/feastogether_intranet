import LinkTabs from "@/components/LinkTabs";
import PageHeader from "@/components/PageHeader";
import StepFlow from "@/components/StepFlow";
import UploadEditor from "@/features/forms/editor/UploadEditor";
import { CREATE_STEPS, SHEET_STEPS } from "@/features/forms/editor/steps";
import SheetEditor from "@/features/forms/sheet/SheetEditor";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import { Box, Button } from "@mui/material";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "新增電子簽文件" };

const TYPES = [
  { value: "upload", label: "一般文件（上傳）", href: "/forms/new" },
  { value: "sheet", label: "簽到表", href: "/forms/new?type=sheet" },
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
            : "上傳 Word／PDF 文件，逐頁預覽並指定簽名要落在哪裡。"
        }
      />
      <LinkTabs value={isSheet ? "sheet" : "upload"} tabs={TYPES} />
      <StepFlow steps={isSheet ? SHEET_STEPS : CREATE_STEPS} activeIndex={0} />
      {isSheet ? <SheetEditor /> : <UploadEditor />}
    </>
  );
}
