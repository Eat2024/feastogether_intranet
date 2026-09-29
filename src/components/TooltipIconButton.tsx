"use client";

// 必須是 client 元件：Tooltip 以 isValidElement 判斷子元素，若子元素由伺服器元件傳入，
// dev 模式下會是尚未解析的延遲參照而被多包一層 span，造成 hydration mismatch。
import type { ReactNode } from "react";
import IconButton, { type IconButtonProps } from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";

type TooltipIconButtonProps = {
  /** Tooltip 文字，同時作為 aria-label */
  label: string;
  icon: ReactNode;
  color?: IconButtonProps["color"];
  disabled?: boolean;
  onClick?: IconButtonProps["onClick"];
};

export default function TooltipIconButton({
  label,
  icon,
  color = "default",
  disabled,
  onClick,
}: TooltipIconButtonProps) {
  return (
    <Tooltip title={label}>
      {/* 停用的按鈕不會觸發滑鼠事件，外包 span 讓 Tooltip 仍可顯示 */}
      <span>
        <IconButton
          size="small"
          color={color}
          disabled={disabled}
          aria-label={label}
          onClick={onClick}
        >
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  );
}
