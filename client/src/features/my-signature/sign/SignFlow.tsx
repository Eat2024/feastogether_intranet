"use client";

// mock 文件的簽署流程：畫面見 SignFlowView，送出與拒絕走 Server Action
import { formOptions } from "@/features/forms/options";
import { getSignLayout } from "@/features/forms/signLayout";
import type { EFormDoc, Signer } from "@/features/forms/types";
import { rejectDocument, signDocument } from "../actions";
import SignFlowView from "./SignFlowView";

/** 簽署流程：同意授權條款 → 閱讀文件 → 逐一完成簽名 → 確認送出 */
export default function SignFlow({
  form,
  me,
  today,
}: {
  form: EFormDoc;
  me: Signer;
  today: string;
}) {
  return (
    <SignFlowView
      docInfo={form}
      pdfUrl={form.upload?.fileId ? `/files/forms/${form.id}` : null}
      signer={me}
      layout={getSignLayout(form)!}
      today={today}
      onSign={async (input) =>
        (await signDocument({ formId: form.id, ...input }))?.error ?? null
      }
      // 建立人可在設定簽署時關閉拒絕簽署；server 端也會再檢查
      onReject={
        formOptions(form).allowReject
          ? async (reason) =>
              (await rejectDocument({ formId: form.id, reason }))?.error ?? null
          : undefined
      }
    />
  );
}
