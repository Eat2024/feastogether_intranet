"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { AuthSession } from "@/api/types";
import {
  EMBED_TARGET_PATHS,
  parseEmbedOrigins,
  parsePortalMessage,
  type EsignToPortalMessage,
  type PortalNavigateMessage,
} from "./protocol";

type SessionCheck = "match" | "mismatch" | "none";

/**
 * 比對電子簽 session 與入口網目前登入者：只有員工會話且員編相同才是 match；
 * Super user 不是任何員工，一律視為 mismatch。無 session 或查詢失敗視為 none。
 */
async function checkSession(empid: string): Promise<SessionCheck> {
  try {
    const response = await fetch("/api/auth/session", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) return "none";
    const session = ((await response.json()) as { data?: AuthSession }).data;
    // actor 是巢狀判別欄位，TypeScript 不會據此收斂 user，仍以 ?. 讀取。
    return session?.actor.kind === "employee" && session.user?.empId === empid
      ? "match"
      : "mismatch";
  } catch {
    return "none";
  }
}

/**
 * 被入口網 iframe 嵌入時，處理入口網的換頁指令：
 * - 電子簽 session 與入口網是同一位員工 → 保持登入，直接換到指定頁面
 * - 不是同一位員工（含 Super user 會話）→ 登出（DELETE session），請入口網重新 launch
 * - 沒有 session → 請入口網 launch
 * 只接受 AUTH_TRUSTED_ORIGINS 內、且來自直接父視窗的訊息；不在 iframe 內時不做任何事。
 */
export default function EmbedBridge() {
  const router = useRouter();

  useEffect(() => {
    if (window.self === window.top) return;

    let active = true;
    let origins: string[] = [];
    const post = (message: EsignToPortalMessage, origin: string) => {
      window.parent.postMessage(message, origin);
    };

    const navigate = async (message: PortalNavigateMessage, origin: string) => {
      const result = await checkSession(message.empid);
      if (!active) return;
      if (result === "match") {
        const path = EMBED_TARGET_PATHS[message.target];
        if (window.location.pathname !== path) router.replace(path);
        post({ type: "esign:navigated", target: message.target }, origin);
        return;
      }
      if (result === "mismatch") {
        // 換人：先撤銷目前 session，避免新使用者看到前一位的資料。
        // 讀完回應本文再通知入口網，避免 iframe 隨即導向 launch 時中斷這個請求。
        try {
          const response = await fetch("/api/auth/session", {
            method: "DELETE",
            credentials: "same-origin",
          });
          await response.text();
        } catch { }
        if (!active) return;
      }
      post({ type: "esign:launch-required", target: message.target }, origin);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || !origins.includes(event.origin))
        return;
      const message = parsePortalMessage(event.data);
      if (!message) return;
      void navigate(message, event.origin);
    };

    window.addEventListener("message", onMessage);
    fetch("/api/auth/embed-origins", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        if (!active) return;
        origins = parseEmbedOrigins(body);
        for (const origin of origins) post({ type: "esign:ready" }, origin);
      })
      .catch(() => undefined);

    return () => {
      active = false;
      window.removeEventListener("message", onMessage);
    };
  }, [router]);

  return null;
}
