"use client";

import { usePdfDocument, usePdfRenders } from "@/features/forms/pdf/usePdf";
import { fieldSize, type SignLayout } from "@/features/forms/signLayout";
import type { EFormDoc, Signer, UploadField } from "@/features/forms/types";
import DrawRoundedIcon from "@mui/icons-material/DrawRounded";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect } from "react";
import SignatureQr from "./SignatureQr";

type DocumentViewerProps = {
  form: Pick<EFormDoc, "id" | "name" | "docNumber" | "upload">;
  /** 系統簽署確認頁顯示的文件資訊 */
  docInfo: Pick<EFormDoc, "name" | "docNumber">;
  /** 原始 PDF 的同源網址；沒有原始檔（舊資料）時為 null，顯示示意版面 */
  pdfUrl: string | null;
  /** 已在外層讀好的 PDF；提供時不再讀取 pdfUrl */
  pdfDoc?: PDFDocumentProxy | null;
  signer: Pick<Signer, "name" | "employeeNo">;
  layout: SignLayout;
  /** 欄位 id → 手寫簽名 PNG */
  signatures: Record<number, string>;
  /** 欄位 id → 簽名識別碼（顯示追蹤 QR code） */
  signatureIds?: Record<number, string>;
  /** 日期欄位顯示的日期 */
  dateText: string;
  activePage: number;
  onPageChange: (page: number) => void;
  /** 提供時簽名欄位可點擊（進行簽名）；未提供為唯讀 */
  onSignField?: (field: UploadField) => void;
  /** 已讀取的原始 PDF；未提供時讀取 `/files/forms/{id}` */
  pdf?: PDFDocumentProxy;
};

/** 頁面縮圖：需簽名的頁面標示「需簽名」，該頁都簽完改為「已簽名」 */
function PageThumb({
  label,
  active,
  signCount,
  signedCount,
  image,
  onClick,
}: {
  label: string;
  active: boolean;
  signCount: number;
  signedCount: number;
  /** 原始文件的頁面縮圖；沒有時顯示示意版面 */
  image?: string;
  onClick: () => void;
}) {
  const done = signCount > 0 && signedCount === signCount;
  return (
    <Stack spacing={0.5} sx={{ alignItems: "center", flex: "none" }}>
      <Box
        component="button"
        type="button"
        onClick={onClick}
        aria-pressed={active}
        aria-label={`${label}${signCount ? `，需簽名 ${signCount} 處` : ""}`}
        sx={{
          width: 96,
          height: 132,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 1,
          bgcolor: "background.paper",
          border: 1.5,
          borderColor: active ? "primary.main" : "grey.300",
          boxShadow: (theme) =>
            active ? `0 0 0 3px ${theme.palette.primary.less}` : "none",
          borderRadius: 1,
          cursor: "pointer",
          font: "inherit",
          overflow: "hidden",
          p: image ? 0.5 : 0,
        }}
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- 瀏覽器端產生的 data URL
          <img
            src={image}
            alt=""
            style={{
              width: "100%",
              flex: 1,
              minHeight: 0,
              objectFit: "contain",
            }}
          />
        ) : (
          <Stack spacing={0.5} sx={{ width: "70%" }}>
            {[100, 70, 85].map((w) => (
              <Box
                key={w}
                sx={{
                  height: 3,
                  width: `${w}%`,
                  bgcolor: "grey.300",
                  borderRadius: 1,
                }}
              />
            ))}
          </Stack>
        )}
        <Typography variant="helper" sx={{ lineHeight: image ? 1 : undefined }}>
          {label}
        </Typography>
      </Box>
      {signCount > 0 && (
        <Chip
          size="small"
          variant="soft"
          color={done ? "success" : "warning"}
          icon={<DrawRoundedIcon />}
          label={done ? "已簽名" : `需簽名 ${signCount - signedCount} 處`}
        />
      )}
    </Stack>
  );
}

/** 原文件頁面的示意內容（與上傳編輯器相同） */
function OriginalPageContent({
  page,
  isLast,
}: {
  page: number;
  isLast: boolean;
}) {
  return (
    <>
      <Typography variant="label" component="div" sx={{ mb: 2 }}>
        第 {page} 頁
      </Typography>
      {[40, 80, 60, 80, 40, 80, 60].map((w, i) => (
        <Box
          key={i}
          sx={{
            height: 7,
            width: `${w}%`,
            mb: 1,
            bgcolor: "grey.100",
            borderRadius: 1,
          }}
        />
      ))}
      {isLast && (
        <Stack spacing={1.5} sx={{ mt: 3 }}>
          {["甲方", "乙方", "日期"].map((t) => (
            <Typography key={t} variant="helper">
              {t}：＿＿＿＿＿＿＿＿
            </Typography>
          ))}
        </Stack>
      )}
    </>
  );
}

/** 系統簽署確認頁的內容 */
function ConfirmPageContent({
  docInfo,
  signer,
  pages,
}: {
  form: DocumentViewerProps["form"];
  docInfo: DocumentViewerProps["docInfo"];
  signer: DocumentViewerProps["signer"];
  pages: number;
}) {
  return (
    <>
      <Typography
        variant="subheading"
        component="div"
        sx={{ textAlign: "center", mb: 2 }}
      >
        電子簽署確認書
      </Typography>
      <Stack>
        <Typography variant="helper">文件名稱：{docInfo.name}</Typography>
        <Typography variant="helper">
          文件編號：{docInfo.docNumber ?? "—"}
        </Typography>
        <Typography variant="helper">文件頁數：{pages} 頁</Typography>
      </Stack>
      <Typography variant="helper" component="div" sx={{ my: 3 }}>
        本人確認已閱讀並同意上述文件內容。
      </Typography>
      <Stack>
        <Typography variant="helper">簽署人：{signer.name}</Typography>
        <Typography variant="helper">員工編號：{signer.employeeNo}</Typography>
      </Stack>
    </>
  );
}

function FieldBox({
  field,
  signature,
  signatureId,
  dateText,
  onSign,
}: {
  field: UploadField;
  signature?: string;
  /** 簽名識別碼；有值時在欄位右下角顯示追蹤 QR code */
  signatureId?: string;
  dateText: string;
  onSign?: () => void;
}) {
  const position = {
    position: "absolute",
    left: `${field.x}%`,
    top: `${field.y}%`,
    width: `${fieldSize(field).w}%`,
    height: `${fieldSize(field).h}%`,
    borderRadius: 1,
  } as const;

  if (field.type === "date") {
    return (
      <Box
        sx={{
          ...position,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderBottom: 1,
          borderColor: "grey.400",
          borderRadius: 0,
        }}
      >
        <Typography variant="helper" sx={{ color: "text.primary" }}>
          {dateText}
        </Typography>
      </Box>
    );
  }

  const content = signature ? (
    // 簽名在左、追蹤 QR code 在右下角，互不遮擋
    <Box
      sx={{
        display: "flex",
        alignItems: "flex-end",
        gap: 0.5,
        width: "100%",
        height: "100%",
      }}
    >
      <Box
        component="img"
        src={signature}
        alt="你的簽名"
        sx={{ flex: 1, minWidth: 0, height: "100%", objectFit: "contain" }}
      />
      {signatureId && (
        <Box sx={{ height: "72%" }}>
          <SignatureQr signatureId={signatureId} />
        </Box>
      )}
    </Box>
  ) : (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
      <DrawRoundedIcon fontSize="small" />
      <Typography variant="helper" sx={{ color: "inherit", flex: "0 0 auto" }}>
        {onSign ? "點此簽名" : "未簽名"}
      </Typography>
    </Box>
  );

  const signedStyle = {
    border: 1,
    borderColor: "transparent",
    bgcolor: "transparent",
  };
  const pendingStyle = {
    border: 1.5,
    borderStyle: "dashed",
    borderColor: "warning.main",
    bgcolor: "warning.less",
    color: "warning.dark",
  };

  if (!onSign) {
    return (
      <Box
        sx={{
          ...position,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 0.5,
          ...(signature ? signedStyle : pendingStyle),
        }}
      >
        {content}
      </Box>
    );
  }

  return (
    <Box
      component="button"
      type="button"
      onClick={onSign}
      aria-label={signature ? "重新簽名" : "簽名"}
      title={signature ? "點擊重新簽名" : undefined}
      sx={{
        ...position,
        p: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 0.5,
        cursor: "pointer",
        font: "inherit",
        ...(signature
          ? {
              ...signedStyle,
              "&:hover": { borderColor: "primary.main", borderStyle: "dashed" },
            }
          : pendingStyle),
      }}
    >
      {content}
    </Box>
  );
}

/** 文件逐頁預覽：縮圖標示需簽名的頁面，頁面上顯示簽名／日期欄位 */
export default function DocumentViewer({
  docInfo,
  pdfUrl,
  pdfDoc,
  signer,
  layout,
  signatures,
  signatureIds = {},
  dateText,
  activePage,
  onPageChange,
  onSignField,
  pdf,
}: DocumentViewerProps) {
  const pages = Array.from({ length: layout.pageCount }, (_, i) => i + 1);
  const pageLabel = (p: number) =>
    p === layout.confirmPage ? "簽署確認頁" : `第 ${p} 頁`;
  const signPages = [
    ...new Set(
      layout.fields.filter((f) => f.type === "sign").map((f) => f.page),
    ),
  ];
  const pageFields = layout.fields.filter((f) => f.page === activePage);
  // 有原始檔時顯示實際內容（系統簽署確認頁除外）；沒有時（舊資料）顯示示意版面
  const { doc: storedDoc } = usePdfDocument(
    !pdf && form.upload?.fileId ? `/files/forms/${form.id}` : null,
  );
  const doc = pdf ?? storedDoc;
  const { doc: loaded } = usePdfDocument(pdfDoc === undefined ? pdfUrl : null);
  const doc = pdfDoc ?? loaded;
  const { thumbs, pageImage, requestPage } = usePdfRenders(doc);
  const isOriginalPage = (p: number) => p !== layout.confirmPage;
  const activeImage = isOriginalPage(activePage)
    ? pageImage(activePage)
    : undefined;
  useEffect(() => {
    if (activePage !== layout.confirmPage) requestPage(activePage);
  }, [activePage, layout.confirmPage, requestPage]);

  return (
    <Stack spacing={2}>
      <Box>
        {/* 只預覽文件（沒有簽名欄位）時不顯示 */}
        {signPages.length > 0 && (
          <Typography variant="secondary" component="div" sx={{ mb: 1 }}>
            需簽名的頁面：{signPages.map(pageLabel).join("、")}
          </Typography>
        )}
        <Box sx={{ display: "flex", gap: 1.5, overflowX: "auto", pb: 1 }}>
          {pages.map((p) => {
            const signs = layout.fields.filter(
              (f) => f.page === p && f.type === "sign",
            );
            return (
              <PageThumb
                key={p}
                label={pageLabel(p)}
                active={p === activePage}
                signCount={signs.length}
                signedCount={signs.filter((f) => signatures[f.id]).length}
                image={isOriginalPage(p) ? thumbs[p] : undefined}
                onClick={() => onPageChange(p)}
              />
            );
          })}
        </Box>
      </Box>

      <Box
        sx={{
          position: "relative",
          width: "100%",
          // maxWidth: 460,
          aspectRatio: "210 / 297",
          mx: "auto",
          px: activeImage ? 0 : 3,
          py: activeImage ? 0 : 4,
          overflow: "hidden",
          bgcolor: "background.paper",
          border: 1,
          borderColor: "grey.300",
          borderRadius: 1,
          boxShadow: 2,
          // 實際頁面以等比縮放置中（與上傳時指定欄位的畫面相同）
          ...(activeImage && {
            backgroundImage: `url(${activeImage})`,
            backgroundSize: "contain",
            backgroundRepeat: "no-repeat",
            backgroundPosition: "center",
          }),
        }}
      >
        {activePage === layout.confirmPage ? (
          <ConfirmPageContent
            docInfo={docInfo}
            signer={signer}
            pages={layout.originalPages}
          />
        ) : activeImage ? null : (
          <OriginalPageContent
            page={activePage}
            isLast={activePage === layout.originalPages}
          />
        )}
        {pageFields.map((f) => (
          <FieldBox
            key={f.id}
            field={f}
            signature={signatures[f.id]}
            signatureId={signatureIds[f.id]}
            dateText={dateText}
            onSign={onSignField && (() => onSignField(f))}
          />
        ))}
      </Box>
    </Stack>
  );
}
