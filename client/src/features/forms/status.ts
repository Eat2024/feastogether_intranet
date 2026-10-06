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

/** 尚未回應（未簽署也未拒絕）的人數 */
export function pendingCount(form: EFormDoc) {
  return form.signers.filter((s) => s.status === "pending").length;
}

// 有人拒絕不影響其他人簽署；所有簽署人都已回應（簽署或拒絕）即視為已完成
export function deriveStatus(form: EFormDoc): FormStatus {
  if (form.status !== "active") return form.status;
  return form.signers.length > 0 && pendingCount(form) === 0 ? "completed" : "active";
}

/** 文件的整體簽署進度（簽署人看不到名單時，用來顯示進度與狀態） */
export type FormProgress = {
  total: number;
  signed: number;
  rejected: number;
  pending: number;
  status: FormStatus;
};

export function getProgress(form: EFormDoc): FormProgress {
  const signed = signedCount(form);
  const pending = pendingCount(form);
  return {
    total: form.signers.length,
    signed,
    rejected: form.signers.length - signed - pending,
    pending,
    status: deriveStatus(form),
  };
}
