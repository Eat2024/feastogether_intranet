import type { Metadata } from "next";
import Button from "@mui/material/Button";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import PageHeader from "@/components/PageHeader";
import FormsTable from "@/features/forms/FormsTable";
import { MOCK_FORMS } from "@/features/forms/mock";

export const metadata: Metadata = { title: "電子簽列表" };

export default function FormsPage() {
  return (
    <>
      <PageHeader
        title="電子簽列表"
        description="建立內部電子簽文件、設定簽署人員並追蹤簽署進度；已有人簽署的文件將無法再修改內容。"
        actions={
          <Button variant="contained" startIcon={<AddRoundedIcon />}>
            新增電子簽文件
          </Button>
        }
      />
      <FormsTable forms={MOCK_FORMS} />
    </>
  );
}
