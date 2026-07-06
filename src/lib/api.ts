import { NextResponse, type NextRequest } from "next/server";
import { getSession, hasPermission, type SessionClaims } from "@/lib/auth";
import type { Permission } from "@/lib/models/User";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Guard a route handler: returns the session or an error response. */
export async function requireSession(
  perm?: Permission
): Promise<{ session: SessionClaims } | { response: NextResponse }> {
  const session = await getSession();
  if (!session) return { response: error("Not authenticated", 401) };
  if (perm && !hasPermission(session, perm)) {
    return { response: error("Forbidden — missing permission", 403) };
  }
  return { session };
}

/** Pull device/network metadata for the audit trail. */
export function requestMeta(req: NextRequest) {
  const ua = req.headers.get("user-agent") ?? "";
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "127.0.0.1";
  const device = detectDevice(ua);
  return { userAgent: ua, ip, device, source: detectSource(req, ua) };
}

/** Web (desktop browser) vs mobile, so the audit trail shows where each
 *  action came from. Prefers the client-hint header (Chromium sends
 *  `sec-ch-ua-mobile: ?1/?0`); falls back to user-agent sniffing. */
function detectSource(req: NextRequest, ua: string): "mobile" | "desktop" {
  const hint = req.headers.get("sec-ch-ua-mobile");
  if (hint === "?1") return "mobile";
  if (hint === "?0") return "desktop";
  return /android|iphone|ipad|ipod|mobile/i.test(ua) ? "mobile" : "desktop";
}

function detectDevice(ua: string): string {
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
  if (/android/i.test(ua)) return "Android";
  if (/windows/i.test(ua)) return "Windows";
  if (/mac os/i.test(ua)) return "macOS";
  if (/linux/i.test(ua)) return "Linux";
  return "unknown";
}
