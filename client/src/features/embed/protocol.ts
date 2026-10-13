/**
 * 入口網（主平台）iframe 嵌入電子簽時的 postMessage 協定。
 * 契約：specs/002-webview-sso-session/contracts/embed-postmessage.md
 *
 * 入口網 → 電子簽：esign:navigate { target, empid }
 * 電子簽 → 入口網：esign:ready、esign:navigated { target }、esign:launch-required { target }
 *   Portal 先掛 message listener 再載入 iframe，因此 esign:ready 只送一次；入口網每次換頁只回一次 navigate。
 *
 * 只接受白名單 target 與合法員編；訊息只影響畫面與「是否需要重新 launch」，不授予任何權限。
 */

/** 入口網以 esign:navigate 指定頁面時可用的代碼白名單（須與入口網 controllers/hr/Esign.php 的 $page_target 一致）。 */
export const EMBED_TARGET_PATHS = {
  "forms-new": "/forms/new",
  forms: "/forms",
  "my-signature": "/my-signature",
} as const;

export type EmbedTarget = keyof typeof EMBED_TARGET_PATHS;

export function isEmbedTarget(value: unknown): value is EmbedTarget {
  return (
    typeof value === "string" && Object.keys(EMBED_TARGET_PATHS).includes(value)
  );
}

export type PortalNavigateMessage = {
  type: "esign:navigate";
  target: EmbedTarget;
  /** 入口網目前登入者的員編，用來比對電子簽 session 是否同一人 */
  empid: string;
};

export type EsignToPortalMessage =
  | { type: "esign:ready" }
  | { type: "esign:navigated"; target: EmbedTarget }
  | { type: "esign:launch-required"; target: EmbedTarget };

/** 解析入口網送來的訊息；格式不符一律回 null（忽略）。 */
export function parsePortalMessage(
  data: unknown,
): PortalNavigateMessage | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const message = data as Record<string, unknown>;
  if (message.type !== "esign:navigate") return null;
  if (!isEmbedTarget(message.target)) return null;
  if (
    typeof message.empid !== "string" ||
    !/^[A-Za-z0-9]{1,32}$/.test(message.empid)
  ) {
    return null;
  }
  return {
    type: "esign:navigate",
    target: message.target,
    empid: message.empid,
  };
}

/** 從 GET /api/auth/embed-origins 回應取出 origin 清單。 */
export function parseEmbedOrigins(body: unknown): string[] {
  const origins = (body as { data?: { origins?: unknown } } | null)?.data
    ?.origins;
  return Array.isArray(origins) ? (origins as string[]) : [];
}
