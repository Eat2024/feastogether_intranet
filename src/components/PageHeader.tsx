import type { ReactNode } from "react";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

type PageHeaderProps = {
  title: ReactNode;
  /** 標題下方的頁面說明 */
  description?: ReactNode;
  /** 右側操作區（按鈕等） */
  actions?: ReactNode;
};

export default function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{ alignItems: "center", justifyContent: "space-between" }}
    >
      <Stack spacing={1} sx={{ minWidth: 0 }}>
        <Typography variant="pageTitle">{title}</Typography>
        {description && <Typography variant="description">{description}</Typography>}
      </Stack>
      {actions && (
        <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
          {actions}
        </Stack>
      )}
    </Stack>
  );
}
