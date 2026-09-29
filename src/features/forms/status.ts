import type { ChipProps } from "@mui/material/Chip";
import type { DocType, EFormDoc, FormStatus } from "./types";

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  online: "線上建立",
  upload: "上傳文件",
};

export const FORM_STATUS_META: Record<FormStatus, { label: string; color: ChipProps["color"] }> = {
  draft: { label: "草稿", color: "default" },
  active: { label: "簽署中", color: "warning" },
  completed: { label: "已完成", color: "success" },
  stopped: { label: "已停止", color: "error" },
};

export function signedCount(form: EFormDoc) {
  return form.signers.filter((s) => s.status === "signed").length;
}

export function deriveStatus(form: EFormDoc): FormStatus {
  if (form.status !== "active") return form.status;
  const total = form.signers.length;
  return total > 0 && signedCount(form) === total ? "completed" : "active";
}

export function formatRange(start: string | null, end: string | null) {
  if (!start) return "尚未發起";
  return `${start} － ${end ?? "進行中"}`;
}
