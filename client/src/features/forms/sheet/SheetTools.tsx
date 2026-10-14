"use client";

import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import FileDownloadRoundedIcon from "@mui/icons-material/FileDownloadRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Snackbar from "@mui/material/Snackbar";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState, useSyncExternalStore } from "react";
import { getSheetExport } from "../actions";

// 簽到連結需要網站網址，只在瀏覽器端取得（伺服器端渲染時為空字串）
const subscribe = () => () => {};
const useOrigin = () =>
  useSyncExternalStore(
    subscribe,
    () => window.location.origin,
    () => "",
  );

/** 檢視頁的簽到表工具：名單外人員的簽到連結、匯出整份簽到表 PDF */
export default function SheetTools({
  formId,
  walkInSlots,
  remaining,
  canWalkIn,
}: {
  formId: string;
  walkInSlots: number;
  remaining: number;
  /** 文件簽署中且還有空白列 */
  canWalkIn: boolean;
}) {
  const origin = useOrigin();
  const link = origin ? `${origin}/my-signature/${formId}` : "";
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setMessage({ ok: true, text: "已複製簽到連結" });
    } catch {
      setMessage({ ok: false, text: "無法複製，請手動選取連結" });
    }
  };

  const exportSheet = async () => {
    setBusy(true);
    try {
      const res = await getSheetExport({ formId });
      if ("error" in res) return setMessage({ ok: false, text: res.error });
      // 產生 PDF 的套件較大，點擊時才載入
      const { downloadSheet } =
        await import("@/features/my-signature/sign/signedPdf");
      await downloadSheet(res.form, res.rows, res.attendance, res.fileName);
    } catch {
      setMessage({ ok: false, text: "匯出失敗，請稍後再試" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",

          // alignItems: "flex-start",
          // justifyContent: "space-between",
          gap: 2,
          flexWrap: "wrap",
        }}
      >
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            flex: "1 1 auto",
            minWidth: 0,
          }}
        >
          <Box>
            <Typography variant="subheading" component="div" sx={{ mb: 0.5 }}>
              名單外人員簽到
            </Typography>
            <Typography variant="helper" component="div" sx={{ mb: 1.5 }}>
              {walkInSlots === 0
                ? "此簽到表沒有保留空白列，名單外人員無法簽到。"
                : `空白列剩 ${remaining} / ${walkInSlots} 列。不在名單中的同仁可透過下方連結使用空白列簽到。`}
            </Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={<FileDownloadRoundedIcon />}
            loading={busy}
            onClick={exportSheet}
          >
            匯出簽到表 PDF
          </Button>
        </Box>
        {walkInSlots > 0 && (
          <Box sx={{ display: "flex", gap: 1 }}>
            <TextField
              size="small"
              fullWidth
              value={link}
              disabled={!canWalkIn}
              slotProps={{
                htmlInput: { readOnly: true, "aria-label": "簽到連結" },
              }}
              onFocus={(e) => e.target.select()}
            />
            <Button
              variant="outlined"
              startIcon={<ContentCopyRoundedIcon />}
              onClick={copy}
              disabled={!canWalkIn || !link}
              sx={{ flexShrink: 0 }}
            >
              複製
            </Button>
          </Box>
        )}
        {walkInSlots > 0 && !canWalkIn && (
          <Typography variant="helper" component="div" sx={{ mt: 1 }}>
            {remaining === 0
              ? "空白列已用完。"
              : "文件目前不在簽署期間，連結暫時無法簽到。"}
          </Typography>
        )}
      </Box>
      <Snackbar
        open={!!message}
        autoHideDuration={3000}
        onClose={() => setMessage(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {message ? (
          <Alert
            severity={message.ok ? "success" : "error"}
            onClose={() => setMessage(null)}
          >
            {message.text}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Paper>
  );
}
