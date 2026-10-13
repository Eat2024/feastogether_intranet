import type { ReactNode } from "react";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

type PageHeaderProps = {
  title: ReactNode;
  /** 標題下方的頁面說明 */
  description?: ReactNode;
  /** 右側操作區（按鈕等） */
  actions?: ReactNode;
  /** 被入口網 iframe 嵌入時隱藏標題（入口網頁面已顯示同一標題）；說明照常顯示 */
  hideTitleWhenEmbedded?: boolean;
  /** 被入口網 iframe 嵌入時隱藏右側操作區（功能已由入口網選單提供時使用） */
  hideActionsWhenEmbedded?: boolean;
};

export default function PageHeader({
  title,
  description,
  actions,
  hideTitleWhenEmbedded = false,
  hideActionsWhenEmbedded = false,
}: PageHeaderProps) {
  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{ alignItems: "center", justifyContent: "space-between" }}
    >
      <Stack spacing={1} sx={{ minWidth: 0 }}>
        <Typography
          variant="pageTitle"
          className={hideTitleWhenEmbedded ? "hide-when-embedded" : undefined}
        >
          {title}
        </Typography>
        {description && <Typography variant="description">{description}</Typography>}
      </Stack>
      {actions && (
        <Stack
          direction="row"
          spacing={1}
          sx={{ flexShrink: 0 }}
          className={hideActionsWhenEmbedded ? "hide-when-embedded" : undefined}
        >
          {actions}
        </Stack>
      )}
    </Stack>
  );
}
