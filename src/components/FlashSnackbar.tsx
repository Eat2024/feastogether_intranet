"use client";

// 導頁後的一次性提示：讀取網址 ?flash=<key>，顯示後把參數從網址移除
import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export default function FlashSnackbar({
  messages,
}: {
  /** flash key → 訊息；訊息中的 {count} 會替換為網址的 ?count= */
  messages: Record<string, string>;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const key = params.get("flash");
  const template = key ? messages[key] : undefined;
  const message = template?.replace("{count}", params.get("count") ?? "");

  const close = () => {
    const next = new URLSearchParams(params);
    next.delete("flash");
    next.delete("count");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <Snackbar
      open={!!message}
      autoHideDuration={3000}
      onClose={(_, reason) => reason !== "clickaway" && close()}
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
    >
      <Alert severity="success" onClose={close}>
        {message}
      </Alert>
    </Snackbar>
  );
}
