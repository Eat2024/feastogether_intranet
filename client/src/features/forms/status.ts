import type { ChipProps } from "@mui/material/Chip";
import { daysUntil } from "@/lib/dates";
import type { DocType, EFormDoc, FormStatus, ResignRound } from "./types";

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  online: "線上建立",
  upload: "上傳文件",
};

export const FORM_STATUS_META: Record<FormStatus, { label: string; color: ChipProps["color"] }> = {
  draft: { label: "草稿", color: "default" },
  active: { label: "簽署中", color: "warning" },
  expired: { label: "已到期", color: "info" },
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

/**
 * 目前的簽署期間：有補簽時為最後一次補簽的期間，否則為原本的簽署期間。
 * 期限相關的判斷（狀態、可否簽署、剩餘天數）一律以此為準。
 */
export function signingPeriod(form: EFormDoc): {
  startAt: string | null;
  endAt: string | null;
  resign: ResignRound | null;
} {
  const resign = form.resigns?.at(-1) ?? null;
  return resign
    ? { startAt: resign.startAt, endAt: resign.endAt, resign }
    : { startAt: form.startAt, endAt: form.endAt, resign: null };
}

/** 簽署期間的文字；補簽中會附上原本的期間 */
export function periodText(form: EFormDoc) {
  const original = `${form.startAt ?? "—"} ～ ${form.endAt ?? "不限"}`;
  const { resign } = signingPeriod(form);
  return resign ? `${resign.startAt} ～ ${resign.endAt}（補簽；原 ${original}）` : original;
}

/**
 * 有人拒絕不影響其他人簽署；所有簽署人都已回應（簽署或拒絕）即視為已完成。
 * 超過目前簽署期間仍有人未回應時為已到期，可設定補簽重新開放。
 */
export function deriveStatus(form: EFormDoc, today: Date = new Date()): FormStatus {
  if (form.status !== "active") return form.status;
  if (form.signers.length > 0 && pendingCount(form) === 0) return "completed";
  const { endAt } = signingPeriod(form);
  return endAt && daysUntil(endAt, today) < 0 ? "expired" : "active";
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
