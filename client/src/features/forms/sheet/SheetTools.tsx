"use client";

import FileDownloadRoundedIcon from "@mui/icons-material/FileDownloadRounded";
import PersonAddAlt1RoundedIcon from "@mui/icons-material/PersonAddAlt1Rounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Snackbar from "@mui/material/Snackbar";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { getSheetExport } from "../actions";
import AddSignersDialog from "./AddSignersDialog";

/** 檢視頁的簽到表工具：追加簽署人（臨時參加的人）、匯出整份簽到表 PDF */
export default function SheetTools({
  formId,
  addBlock,
  existingIds,
  existingEmails,
}: {
  formId: string;
  /** 目前無法追加的原因；可以追加時為 null */
  addBlock: string | null;
  existingIds: string[];
  existingEmails: string[];
}) {
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

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
          justifyContent: "space-between",
          alignItems: "center",
          gap: 2,
          flexWrap: "wrap",
        }}
      >
        <Box sx={{ flex: "1 1 320px", minWidth: 0 }}>
          <Typography variant="subheading" component="div" sx={{ mb: 0.5 }}>
            簽到名單
          </Typography>
          <Typography variant="helper" component="div">
            {addBlock ??
              "有臨時參加的人時，可追加組織架構中的同仁或以 Email 加入，追加的人會排在原名單後面。"}
          </Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 1, flexShrink: 0 }}>
          <Button
            variant="outlined"
            startIcon={<PersonAddAlt1RoundedIcon />}
            disabled={!!addBlock}
            onClick={() => setAddOpen(true)}
          >
            追加簽署人
          </Button>
          <Button
            variant="contained"
            startIcon={<FileDownloadRoundedIcon />}
            loading={busy}
            onClick={exportSheet}
          >
            匯出簽到表 PDF
          </Button>
        </Box>
      </Box>
      <AddSignersDialog
        open={addOpen}
        formId={formId}
        existingIds={existingIds}
        existingEmails={existingEmails}
        onClose={() => setAddOpen(false)}
        onAdded={(count) => {
          setAddOpen(false);
          setMessage({ ok: true, text: `已追加 ${count} 位簽署人` });
        }}
      />
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
