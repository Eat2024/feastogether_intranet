"use client";

// 單行截斷，滑鼠移上去以 Tooltip 顯示全文。
// 須為 client 元件：Tooltip 的子元素要在 client 端建立（原因見 TooltipIconButton）
import Tooltip from "@mui/material/Tooltip";
import Typography, { type TypographyProps } from "@mui/material/Typography";

type TruncatedTextProps = {
  text: string;
  maxWidth: number;
  variant?: TypographyProps["variant"];
};

export default function TruncatedText({ text, maxWidth, variant = "content" }: TruncatedTextProps) {
  return (
    <Tooltip title={text}>
      <Typography variant={variant} noWrap sx={{ maxWidth }}>
        {text}
      </Typography>
    </Tooltip>
  );
}
