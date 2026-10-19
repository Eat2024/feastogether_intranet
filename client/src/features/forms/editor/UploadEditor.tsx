"use client";

import { queryKeys } from "@/api/query-keys";
import { createDocument } from "@/api/requests";
import { toFieldPlacements } from "@/features/esign-documents/fields";
import { ACTION_FAILED_MESSAGE, isNavigationError } from "@/lib/actionError";
import { getErrorMessage } from "@/lib/apiError";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import DrawRoundedIcon from "@mui/icons-material/DrawRounded";
import EventRoundedIcon from "@mui/icons-material/EventRounded";
import UploadFileRoundedIcon from "@mui/icons-material/UploadFileRounded";
import { AlertTitle } from "@mui/material";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { color } from "@/theme/tokens";
import { saveUploadDocument } from "../actions";
import { clampFieldSize, fieldSize } from "../signLayout";
import { isPdfFile, MAX_PDF_BYTES, openPdf } from "../pdf/pdfjs";
import { usePdfDocument, usePdfRenders } from "../pdf/usePdf";
import type { EFormDoc, UploadField } from "../types";

// 目前只在瀏覽器端以 pdf.js 讀取 PDF；Word 需串接後端轉檔後才支援
const ACCEPT = ".pdf,application/pdf";

// 預覽縮放：各倍率對應的頁面繪製寬度（px，約為畫面寬度的 2 倍，放大時不模糊）
const ZOOM_LEVELS = [
  { value: 1, label: "100%", renderWidth: 1600 },
  { value: 1.5, label: "150%", renderWidth: 2400 },
  { value: 2, label: "200%", renderWidth: 3200 },
] as const;
type Zoom = (typeof ZOOM_LEVELS)[number]["value"];

/**
 * 以放開的滑鼠位置為欄位中心，換算成左上角的頁面百分比（w、h 為欄位寬高的百分比），
 * 並確保整個欄位留在頁面內
 */
function toFieldPosition(e: DragEvent, rect: DOMRect, w: number, h: number) {
  const x = ((e.clientX - rect.left) / rect.width) * 100 - w / 2;
  const y = ((e.clientY - rect.top) / rect.height) * 100 - h / 2;
  return {
    x: Math.min(100 - w, Math.max(0, x)),
    y: Math.min(100 - h, Math.max(0, y)),
  };
}

const FIELD_META: Record<
  UploadField["type"],
  { label: string; icon: ReactNode }
> = {
  sign: { label: "簽名欄位", icon: <DrawRoundedIcon fontSize="small" /> },
  date: { label: "日期欄位", icon: <EventRoundedIcon fontSize="small" /> },
};

type Errors = {
  name?: string;
  file?: string;
  fields?: string;
  submit?: string;
};

/** 表單區塊標題 */
function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <Typography variant="label" component="div" sx={{ mb: 1 }}>
      {children}
    </Typography>
  );
}

/** 頁面縮圖：點擊切換目前編輯的頁面，綠點表示此頁已有欄位 */
function PageThumb({
  page,
  active,
  hasField,
  image,
  onClick,
}: {
  page: number;
  active: boolean;
  hasField: boolean;
  /** 實際頁面縮圖；沒有時顯示示意版面 */
  image?: string;
  onClick: () => void;
}) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`第 ${page} 頁`}
      sx={{
        flex: "none",
        width: 96,
        height: 132,
        position: "relative",
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
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- 瀏覽器端產生的 data URL */}
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
          <Typography variant="helper" sx={{ lineHeight: 1 }}>
            第 {page} 頁
          </Typography>
        </>
      ) : (
        <>
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
          <Typography variant="helper">第 {page} 頁</Typography>
        </>
      )}
      {hasField && (
        <Box
          sx={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 8,
            height: 8,
            borderRadius: "50%",
            bgcolor: "success.main",
          }}
        />
      )}
    </Box>
  );
}

/** 可拖曳到頁面上的欄位來源 */
function FieldSource({
  type,
  disabled,
  getFieldPx,
}: {
  type: UploadField["type"];
  disabled: boolean;
  /** 新欄位在目前頁面（含縮放）上的實際尺寸（px）；拖曳時的預覽圖用這個大小 */
  getFieldPx: () => { width: number; height: number } | null;
}) {
  const meta = FIELD_META[type];
  return (
    <Box
      draggable={!disabled}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/field-type", type);
        // 拖曳中看到的方塊與放下後的欄位同大小，且游標在正中央（放下時以游標為欄位中心）
        const size = getFieldPx();
        if (!size) return;
        const ghost = document.createElement("div");
        ghost.textContent = meta.label;
        Object.assign(ghost.style, {
          position: "fixed",
          top: "-1000px",
          left: "-1000px",
          width: `${size.width}px`,
          height: `${size.height}px`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: `1.5px dashed ${color.primary}`,
          borderRadius: "4px",
          background: color.primarySurface,
          color: color.primaryDark,
          font: "12px sans-serif",
        });
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, size.width / 2, size.height / 2);
        // 瀏覽器在 dragstart 當下擷取預覽圖，之後即可移除
        setTimeout(() => ghost.remove(), 0);
      }}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        px: 2,
        py: 1,
        border: 1.5,
        borderStyle: "dashed",
        borderColor: "grey.300",
        borderRadius: 1,
        bgcolor: "grey.50",
        color: "text.secondary",
        cursor: disabled ? "default" : "grab",
      }}
    >
      {meta.icon}
      <Typography variant="label">{meta.label}</Typography>
    </Box>
  );
}

/** 系統簽署確認頁（公版 A4）預覽 */
function ConfirmPagePreview({
  name,
  docNumber,
  pages,
}: {
  name: string;
  docNumber: string | null;
  pages: number;
}) {
  return (
    <Paper
      variant="outlined"
      sx={{
        maxWidth: 560,
        mx: "auto",
        px: 5,
        py: 6,
        boxShadow: 2,
        minHeight: 400,
      }}
    >
      <Typography
        variant="sectionTitle"
        component="div"
        sx={{ textAlign: "center", mb: 2 }}
      >
        電子簽署確認書
      </Typography>
      <Stack>
        <Typography variant="helper">
          文件名稱：{name || "（未命名文件）"}
        </Typography>
        <Typography variant="helper">
          文件編號：{docNumber ?? "（建立後產生）"}
        </Typography>
        <Typography variant="helper">文件頁數：{pages} 頁</Typography>
      </Stack>
      <Typography variant="content" sx={{ my: 5 }}>
        本人確認已閱讀並同意上述文件內容。
      </Typography>
      <Stack>
        <Typography variant="helper">簽署人：（簽署人姓名）</Typography>
        <Typography variant="helper">員工編號：（簽署人員工編號）</Typography>
      </Stack>
      <Box
        sx={{
          mt: 4,
          height: 90,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: 1.5,
          borderColor: "grey.300",
          borderRadius: 1,
          bgcolor: "grey.100",
        }}
      >
        <Typography variant="secondary">手寫簽名區</Typography>
      </Box>
      <Typography variant="helper" component="div" sx={{ mt: 2 }}>
        簽署時間：（簽署時自動帶入）
      </Typography>
      <Typography
        variant="helper"
        component="div"
        sx={{ textAlign: "center", mt: 3 }}
      >
        — 公版 A4，將附加於原文件第 {pages + 1} 頁 —
      </Typography>
    </Paper>
  );
}

/**
 * 新增／編輯上傳文件（流程第一步）。
 * 新增文件時串接後端（POST /api/esign/documents 建立草稿）；編輯既有的 mock 文件仍走 Server Action。
 */
export default function UploadEditor({
  form,
  locked = false,
}: {
  form?: EFormDoc;
  locked?: boolean;
}) {
  // 新增文件時直接送到後端；PDF 由後端保存與驗證，不再上傳到 mock 的 /files/upload
  const viaBackend = !form;
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const create = useMutation({
    mutationFn: createDocument,
    // 錯誤顯示在表單上方，不另外跳全域提示
    meta: { suppressGlobalErrorToast: true },
    onSuccess: ({ id }) => {
      void queryClient.invalidateQueries({ queryKey: [queryKeys.ESIGN_DOCUMENTS] });
      router.push(`/forms/${id}/signers`);
    },
    onError: (err) => setErrors({ submit: getErrorMessage(err, "建立文件失敗，請稍後再試") }),
  });
  const up = form?.upload;
  const [name, setName] = useState(form?.name ?? "");
  const [fileName, setFileName] = useState(up?.fileName ?? "");
  const [pages, setPages] = useState(up?.pages ?? 0);
  const [confirmMode, setConfirmMode] = useState(up?.mode === "confirmPage");
  const [fields, setFields] = useState<UploadField[]>(up?.fields ?? []);
  const [activePage, setActivePage] = useState(up?.fields[0]?.page ?? 1);
  const [errors, setErrors] = useState<Errors>({});
  const [dragOverFile, setDragOverFile] = useState(false);
  const [pending, startTransition] = useTransition();
  // 本次上傳的 PDF；編輯既有文件且沒有重新上傳時，從伺服器讀取原始檔
  const [uploadedDoc, setUploadedDoc] = useState<PDFDocumentProxy | null>(null);
  const uploadedDocRef = useRef<PDFDocumentProxy | null>(null);
  const existing = usePdfDocument(
    !uploadedDoc && up?.fileId && form ? `/files/forms/${form.id}` : null,
  );
  const doc = uploadedDoc ?? existing.doc;
  const [zoom, setZoom] = useState<Zoom>(1);
  const renderWidth = ZOOM_LEVELS.find((z) => z.value === zoom)!.renderWidth;
  const { thumbs, pageImage, requestPage } = usePdfRenders(doc, renderWidth);
  const [reading, setReading] = useState(false);
  // 伺服器保存的原始檔 id；上傳中為 undefined
  const [fileId, setFileId] = useState(up?.fileId);
  const [uploading, setUploading] = useState(false);
  const uploadSeq = useRef(0);

  // 離開頁面時釋放 pdf.js 佔用的記憶體
  useEffect(() => () => void uploadedDocRef.current?.loadingTask.destroy(), []);
  // 目前頁面的預覽圖需要時才畫
  useEffect(() => requestPage(activePage), [activePage, requestPage]);

  const nextFieldId = useRef(
    Math.max(0, ...(up?.fields ?? []).map((f) => f.id)) + 1,
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const uploaded = pages > 0;
  const pageFields = fields.filter((f) => f.page === activePage);
  const activeImage = pageImage(activePage);

  const selectPage = (page: number) => setActivePage(page);

  /** 把原始檔上傳到伺服器保存（簽署人簽署時要閱讀原始文件），並確認伺服器讀到的頁數一致 */
  const uploadFile = async (file: File, pageCount: number) => {
    const seq = ++uploadSeq.current;
    setUploading(true);
    setFileId(undefined);
    let error: string | null = null;
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/files/upload", { method: "POST", body });
      const data = (await res.json()) as
        | { id: string; pages: number }
        | { error: string };
      if (seq !== uploadSeq.current) return;
      if ("error" in data) error = data.error;
      else if (data.pages !== pageCount)
        error = "伺服器讀到的頁數與預覽不同，請重新上傳";
      else setFileId(data.id);
    } catch {
      if (seq !== uploadSeq.current) return;
      error = "檔案上傳失敗，請檢查網路後重新上傳";
    }
    if (error) setErrors((e) => ({ ...e, file: error }));
    setUploading(false);
  };

  // 先在瀏覽器以 pdf.js 讀取頁數與預覽，再把原始檔上傳到伺服器保存
  const acceptFile = async (file: File | undefined) => {
    if (!file || locked || reading) return;
    if (!isPdfFile(file)) {
      setErrors((e) => ({
        ...e,
        file: "目前只支援 PDF 檔，Word 文件請先另存為 PDF 再上傳",
      }));
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setErrors((e) => ({
        ...e,
        file: `檔案超過 ${MAX_PDF_BYTES / 1024 / 1024}MB，請壓縮後再上傳`,
      }));
      return;
    }
    setReading(true);
    let opened: PDFDocumentProxy;
    try {
      opened = await openPdf(file);
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      setErrors((e) => ({
        ...e,
        file:
          name === "PasswordException"
            ? "此 PDF 有密碼保護，請移除密碼後再上傳"
            : "無法讀取此 PDF，檔案可能已損毀",
      }));
      setReading(false);
      return;
    }
    void uploadedDocRef.current?.loadingTask.destroy();
    uploadedDocRef.current = opened;
    setUploadedDoc(opened);
    const n = opened.numPages;
    setFileName(file.name);
    setPages(n);
    // 簽名通常在最後一頁，預設停在最後一頁
    setActivePage(n);
    setFields([]);
    setErrors((e) => ({ ...e, file: undefined }));
    setReading(false);
    if (viaBackend) setPdfFile(file);
    else await uploadFile(file, n);
  };

  const handleFileDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOverFile(false);
    acceptFile(e.dataTransfer.files[0]);
  };

  const handleFieldDrop = (e: DragEvent) => {
    e.preventDefault();
    if (locked || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const type = (e.dataTransfer.getData("text/field-type") ||
      "sign") as UploadField["type"];
    const { w, h } = fieldSize({});
    setFields((prev) => [
      ...prev,
      { id: nextFieldId.current++, page: activePage, ...toFieldPosition(e, rect, w, h), w, h, type },
    ]);
    setErrors((err) => ({ ...err, fields: undefined }));
  };

  /** 新欄位在目前畫面上的尺寸（px），拖曳新增時的預覽圖用 */
  const newFieldPx = () => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const { w, h } = fieldSize({});
    return { width: (rect.width * w) / 100, height: (rect.height * h) / 100 };
  };

  /**
   * 移動既有欄位：欄位直接跟著游標移動（保留按下時游標在欄位內的相對位置），
   * 放開時的位置就是看到的位置。
   */
  const startMove = (e: ReactPointerEvent<HTMLElement>, field: UploadField) => {
    if (e.button !== 0) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const { w, h } = fieldSize(field);
    const startX = e.clientX;
    const startY = e.clientY;
    const onMove = (ev: PointerEvent) => {
      const dx = ((ev.clientX - startX) / rect.width) * 100;
      const dy = ((ev.clientY - startY) / rect.height) * 100;
      const x = Math.min(100 - w, Math.max(0, field.x + dx));
      const y = Math.min(100 - h, Math.max(0, field.y + dy));
      setFields((prev) => prev.map((f) => (f.id === field.id ? { ...f, x, y } : f)));
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  };

  /** 調整欄位大小（w、h 為頁面百分比，會限制在允許範圍內） */
  const resizeField = (id: number, w: number, h: number) =>
    setFields((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...clampFieldSize(f.x, f.y, w, h) } : f)),
    );

  /** 拖曳欄位右下角的把手調整大小 */
  const startResize = (e: ReactPointerEvent<HTMLElement>, field: UploadField) => {
    // 避免觸發欄位本身的拖曳移動
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      resizeField(
        field.id,
        ((ev.clientX - rect.left) / rect.width) * 100 - field.x,
        ((ev.clientY - rect.top) / rect.height) * 100 - field.y,
      );
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  const validate = () => {
    const next: Errors = {};
    if (!name.trim()) next.name = "請輸入文件名稱";
    if (!uploaded) next.file = "請先上傳文件";
    else if (viaBackend && !pdfFile) next.file = "請先上傳文件";
    // 後端模式由後端保存檔案，沒有 mock 的 fileId
    else if (!viaBackend && uploading) next.file = "檔案上傳中，請稍候";
    else if (!viaBackend && uploadedDoc && !fileId) next.file = "檔案尚未上傳成功，請重新上傳";
    else if (!confirmMode && fields.length === 0) {
      next.fields = "請至少指定一個簽名位置，或改用系統簽署確認頁";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = () => {
    if (!validate()) return;
    if (viaBackend) {
      create.mutate({
        title: name.trim(),
        file: pdfFile!,
        // 系統簽署確認頁後端尚未支援：建立草稿時不帶欄位，設定簽署頁會提示無法發起
        fields: confirmMode ? [] : toFieldPlacements(fields),
      });
      return;
    }
    startTransition(async () => {
      try {
        const result = await saveUploadDocument({
          id: form?.id,
          name,
          upload: {
            fileName,
            fileId,
            pages,
            mode: confirmMode ? "confirmPage" : "inline",
            fields,
          },
        });
        if (result?.error) setErrors({ submit: result.error });
      } catch (err) {
        if (isNavigationError(err)) throw err;
        setErrors({ submit: ACTION_FAILED_MESSAGE });
      }
    });
  };

  const isDraftOrNew = !form || form.status === "draft";

  return (
    <Stack spacing={3}>
      {locked && (
        <Alert severity="info" variant="outlined">
          此文件已有人簽署或已停止，內容與簽名位置已鎖定，僅能查看。
        </Alert>
      )}
      {errors.submit && <Alert severity="error">{errors.submit}</Alert>}

      <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
        <Stack spacing={3}>
          <TextField
            fullWidth
            label="文件名稱"
            placeholder="例如：供應商保密協議（NDA）"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (errors.name)
                setErrors((err) => ({ ...err, name: undefined }));
            }}
            disabled={locked}
            error={!!errors.name}
            helperText={errors.name}
          />

          <Box>
            <FieldLabel>上傳文件</FieldLabel>
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              hidden
              onChange={(e) => {
                acceptFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <Paper
              variant="outlined"
              role="button"
              tabIndex={locked ? -1 : 0}
              aria-disabled={locked}
              onClick={() => !locked && fileInput.current?.click()}
              onKeyDown={(e) => {
                if (!locked && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  fileInput.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (!locked) setDragOverFile(true);
              }}
              onDragLeave={() => setDragOverFile(false)}
              onDrop={handleFileDrop}
              sx={{
                p: 6,
                textAlign: "center",
                borderStyle: "dashed",
                borderColor: errors.file
                  ? "error.main"
                  : dragOverFile
                    ? "primary.main"
                    : "grey.300",
                bgcolor: dragOverFile ? "primary.less" : "background.paper",
                cursor: locked ? "default" : "pointer",
              }}
            >
              <Stack spacing={1} sx={{ alignItems: "center" }}>
                <UploadFileRoundedIcon
                  sx={{ fontSize: 40, color: "text.secondary" }}
                />
                <Typography variant="subheading" component="div">
                  {reading
                    ? "讀取 PDF 中…"
                    : uploaded
                      ? fileName
                      : "點擊或拖曳 PDF 文件到這裡上傳"}
                  {uploading && "（上傳中…）"}
                </Typography>
                <Typography variant="helper">
                  {uploaded
                    ? `共 ${pages} 頁・點擊可重新上傳（重新上傳會清除已指定的欄位）`
                    : `僅支援 PDF，${MAX_PDF_BYTES / 1024 / 1024}MB 以內；簽署人簽署時會看到這份原始文件`}
                </Typography>
              </Stack>
            </Paper>
            {errors.file && (
              <Typography
                variant="helper"
                component="div"
                sx={{ color: "error.dark", mt: 1 }}
              >
                {errors.file}
              </Typography>
            )}
          </Box>

          {uploaded && (
            <>
              <Box>
                <FieldLabel>逐頁預覽（點擊選擇頁面）</FieldLabel>
                {uploaded && !doc && !existing.loading && (
                  <Typography
                    variant="helper"
                    component="div"
                    sx={{ mt: -0.5, mb: 1 }}
                  >
                    原始檔案沒有保存，目前顯示示意版面；重新上傳 PDF
                    即可看到實際內容。
                  </Typography>
                )}
                <Box
                  sx={{ display: "flex", gap: 1.5, overflowX: "auto", pb: 1 }}
                >
                  {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
                    <PageThumb
                      key={p}
                      page={p}
                      active={p === activePage}
                      hasField={
                        !confirmMode && fields.some((f) => f.page === p)
                      }
                      image={thumbs[p]}
                      onClick={() => selectPage(p)}
                    />
                  ))}
                </Box>
              </Box>

              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 2,
                  px: 2,
                  py: 1.5,
                  bgcolor: "grey.100",
                  borderRadius: 1,
                }}
              >
                <Box>
                  <Typography variant="subheading" component="div">
                    原文件版面不便標記，改用系統簽署確認頁
                  </Typography>
                  <Typography variant="helper" component="div">
                    適用：掃描文件、不允許改動原版面、找不到合適簽名位置
                  </Typography>
                  {viaBackend && confirmMode && (
                    <Typography variant="helper" component="div" sx={{ color: "warning.dark" }}>
                      後端尚未支援系統簽署確認頁，選擇此方式的文件可以先建立草稿，但暫時無法發起簽署。
                    </Typography>
                  )}
                </Box>
                <Switch
                  checked={confirmMode}
                  disabled={locked}
                  onChange={(e) => {
                    setConfirmMode(e.target.checked);
                    setErrors((err) => ({ ...err, fields: undefined }));
                  }}
                  slotProps={{ input: { "aria-label": "改用系統簽署確認頁" } }}
                />
              </Box>

              {confirmMode ? (
                <Box>
                  <FieldLabel>
                    系統將自動產生「簽署確認頁」（公版
                    A4），附加於原文件最後一頁
                  </FieldLabel>
                  <ConfirmPagePreview
                    name={name}
                    docNumber={form?.docNumber ?? null}
                    pages={pages}
                  />
                </Box>
              ) : (
                <Box>
                  <FieldLabel>將欄位拖曳到頁面上你要的位置</FieldLabel>
                  <Box sx={{ display: "flex", gap: 1, mb: 2, alignItems: "center", flexWrap: "wrap" }}>
                    <FieldSource type="sign" disabled={locked} getFieldPx={newFieldPx} />
                    <FieldSource type="date" disabled={locked} getFieldPx={newFieldPx} />
                    <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 1 }}>
                      <Typography variant="label" component="span">
                        預覽縮放
                      </Typography>
                      <ToggleButtonGroup
                        size="small"
                        exclusive
                        value={zoom}
                        onChange={(_, v: Zoom | null) => v && setZoom(v)}
                        aria-label="預覽縮放"
                      >
                        {ZOOM_LEVELS.map((z) => (
                          <ToggleButton key={z.value} value={z.value} sx={{ px: 1.5 }}>
                            {z.label}
                          </ToggleButton>
                        ))}
                      </ToggleButtonGroup>
                    </Box>
                  </Box>

                  {/* 放大時頁面比可視範圍大，可左右／上下捲動 */}
                  <Box sx={{ overflow: "auto", maxHeight: zoom > 1 ? "80vh" : undefined, p: 0.5 }}>
                  <Box
                    ref={canvasRef}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleFieldDrop}
                    sx={{
                      position: "relative",
                      width: `${zoom * 100}%`,
                      flexShrink: 0,
                      // maxWidth: 100%,
                      aspectRatio: "210 / 297",
                      mx: "auto",
                      px: activeImage ? 0 : 3,
                      py: activeImage ? 0 : 4,
                      overflow: "hidden",
                      bgcolor: "background.paper",
                      // 實際頁面以等比縮放置中（非 A4 比例的頁面上下或左右會留白）
                      ...(activeImage && {
                        backgroundImage: `url(${activeImage})`,
                        backgroundSize: "contain",
                        backgroundRepeat: "no-repeat",
                        backgroundPosition: "center",
                      }),
                      border: 1,
                      borderColor: errors.fields ? "error.main" : "grey.300",
                      borderRadius: 1,
                      boxShadow: 2,
                    }}
                  >
                    {!activeImage && (
                      <>
                        <Typography
                          variant="label"
                          component="div"
                          sx={{ mb: 2 }}
                        >
                          第 {activePage} 頁
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
                        {activePage === pages && (
                          <Stack spacing={1.5} sx={{ mt: 3 }}>
                            {["甲方", "乙方", "日期"].map((t) => (
                              <Typography key={t} variant="helper">
                                {t}：＿＿＿＿＿＿＿＿
                              </Typography>
                            ))}
                          </Stack>
                        )}
                      </>
                    )}

                    {pageFields.map((f) => (
                      <Box
                        key={f.id}
                        onPointerDown={(e) => !locked && startMove(e, f)}
                        sx={{
                          position: "absolute",
                          left: `${f.x}%`,
                          top: `${f.y}%`,
                          width: `${fieldSize(f).w}%`,
                          height: `${fieldSize(f).h}%`,
                          minWidth: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 0.5,
                          border: 1.5,
                          borderStyle: "dashed",
                          borderColor: "primary.main",
                          borderRadius: 1,
                          bgcolor: "primary.less",
                          color: "primary.dark",
                          cursor: locked ? "default" : "move",
                          userSelect: "none",
                          touchAction: "none",
                        }}
                      >
                        {FIELD_META[f.type].icon}
                        <Typography variant="helper" noWrap sx={{ color: "inherit", minWidth: 0 }}>
                          {FIELD_META[f.type].label}
                        </Typography>
                        {!locked && (
                          <Box
                            component="button"
                            type="button"
                            aria-label={`移除${FIELD_META[f.type].label}`}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={() =>
                              setFields((prev) =>
                                prev.filter((x) => x.id !== f.id),
                              )
                            }
                            sx={{
                              position: "absolute",
                              top: -9,
                              right: -9,
                              width: 20,
                              height: 20,
                              p: 0,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              borderRadius: "50%",
                              border: 1.5,
                              borderColor: "common.white",
                              bgcolor: "error.main",
                              color: "common.white",
                              cursor: "pointer",
                            }}
                          >
                            <CloseRoundedIcon sx={{ fontSize: 14 }} />
                          </Box>
                        )}
                        {!locked && (
                          // 右下角把手：拖曳調整大小；也可用方向鍵調整（Shift 每次 5%）
                          <Box
                            role="button"
                            tabIndex={0}
                            draggable={false}
                            aria-label={`調整${FIELD_META[f.type].label}大小（方向鍵調整，目前寬 ${Math.round(fieldSize(f).w)}%、高 ${Math.round(fieldSize(f).h)}%）`}
                            title="拖曳調整大小"
                            onPointerDown={(e) => startResize(e, f)}
                            onDragStart={(e) => e.preventDefault()}
                            onKeyDown={(e) => {
                              const step = e.shiftKey ? 5 : 1;
                              const delta = {
                                ArrowRight: [step, 0],
                                ArrowLeft: [-step, 0],
                                ArrowDown: [0, step],
                                ArrowUp: [0, -step],
                              }[e.key];
                              if (!delta) return;
                              e.preventDefault();
                              const { w, h } = fieldSize(f);
                              resizeField(f.id, w + delta[0], h + delta[1]);
                            }}
                            sx={{
                              position: "absolute",
                              right: -7,
                              bottom: -7,
                              width: 14,
                              height: 14,
                              borderRadius: 0.5,
                              border: 1.5,
                              borderColor: "common.white",
                              bgcolor: "primary.main",
                              cursor: "nwse-resize",
                              touchAction: "none",
                              "&:focus-visible": { outline: 2, outlineColor: "primary.dark", outlineOffset: 2 },
                            }}
                          />
                        )}
                      </Box>
                    ))}
                  </Box>
                  </Box>

                  <Typography
                    variant="helper"
                    component="div"
                    sx={{
                      textAlign: "center",
                      mt: 1.5,
                      ...(errors.fields && { color: "error.dark" }),
                    }}
                  >
                    {errors.fields ??
                      (fields.length
                        ? `已指定 ${fields.length} 個欄位位置（本頁 ${pageFields.length} 個，可拖曳移動、拖曳右下角調整大小，或點 × 移除）`
                        : "尚未指定簽名位置，請從上方拖曳欄位到頁面上")}
                  </Typography>

                  <Alert severity="info" variant="outlined" sx={{ mt: 2 }}>
                    <AlertTitle>關於大量簽署時的畫面空間</AlertTitle>
                    這裡拖曳定位的是「這份文件範本」的欄位座標（第幾頁、x%、y%），只需設定一次。
                    之後不論是 5 人或 500
                    人簽署，系統都會用同一組座標，在每個人自己的那份文件副本上疊上各自的簽名——
                    不會因為簽署人數變多而需要更多畫面空間，也不需要逐一標記。
                  </Alert>
                </Box>
              )}
            </>
          )}
        </Stack>
      </Paper>

      <Box
        sx={{
          display: "flex",
          gap: 1,
          flexWrap: "wrap",
          justifyContent: "flex-end",
        }}
      >
        <Button
          size="large"
          variant="outlined"
          href="/forms"
          disabled={pending || create.isPending}
        >
          {locked ? "返回列表" : "取消"}
        </Button>
        {!locked && (
          <Button
            size="large"
            variant="contained"
            onClick={submit}
            loading={pending || create.isPending || create.isSuccess}
          >
            {isDraftOrNew ? "下一步，設定簽署" : "儲存變更"}
          </Button>
        )}
      </Box>
    </Stack>
  );
}
