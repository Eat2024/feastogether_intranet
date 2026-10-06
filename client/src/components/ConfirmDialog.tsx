"use client";

// 確認型 dialog（刪除／提醒／結果回饋）：設計系統的確認型不屬於 MUI maxWidth 尺寸，
// 寬度、圓角、陰影、外距由 tokens 的 dialog 設定在這裡指定
import { useId, type ReactNode } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import Typography from "@mui/material/Typography";
import { dialog, radius } from "@/theme/tokens";

type ConfirmDialogProps = {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  /** 標題上方的大圖示 */
  icon?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** 確認按鈕顏色；破壞性動作用 error */
  color?: "primary" | "error";
  onConfirm: () => void;
  onClose: () => void;
};

export default function ConfirmDialog({
  open,
  title,
  description,
  icon,
  confirmLabel,
  cancelLabel = "取消",
  color = "primary",
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const titleId = useId();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      slotProps={{
        paper: {
          sx: {
            width: dialog.widthConfirm,
            // 視窗 < 392px 時為 100vw − 32px
            maxWidth: `calc(100% - ${dialog.marginSm * 2}px)`,
            m: `${dialog.marginSm}px`,
            p: 3,
            borderRadius: `${radius.dialogConfirm}px`,
            boxShadow: dialog.shadowConfirm,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 1,
            textAlign: "center",
          },
        },
      }}
      aria-labelledby={titleId}
    >
      {icon && (
        <Box sx={{ display: "flex", color: `${color}.main`, "& svg": { fontSize: 48 } }}>
          {icon}
        </Box>
      )}
      <Typography id={titleId} variant="sectionTitle">
        {title}
      </Typography>
      {description && <Typography variant="description">{description}</Typography>}
      {/* 確認型按鈕垂直堆疊、滿寬、gap 8px */}
      <Box sx={{ width: "100%", display: "flex", flexDirection: "column", gap: 1, mt: 2 }}>
        <Button fullWidth size="large" variant="contained" color={color} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button
          fullWidth
          size="large"
          variant="outlined"
          color="inherit"
          sx={{ color: "text.primary", borderColor: "grey.400" }}
          onClick={onClose}
        >
          {cancelLabel}
        </Button>
      </Box>
    </Dialog>
  );
}
