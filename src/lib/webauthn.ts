import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { SignJWT } from "jose";

/** Relying-party config for biometric/passkey (WebAuthn). */
export const rpID = process.env.NEXT_PUBLIC_RP_ID ?? "localhost";
export const rpName = process.env.NEXT_PUBLIC_RP_NAME ?? "InfoLog Mobile";
export const origin = process.env.NEXT_PUBLIC_ORIGIN ?? "http://localhost:3000";

/**
 * Allowed origins for verification. Includes the configured origin plus the
 * live request Origin when it targets the same RP host (e.g. localhost on a
 * fallback port), so dev works regardless of which port Next picks.
 */
export function expectedOrigins(req: { headers: { get(name: string): string | null } }): string[] {
  const set = new Set<string>([origin]);
  const reqOrigin = req.headers.get("origin");
  if (reqOrigin) {
    try {
      const host = new URL(reqOrigin).hostname;
      if (host === rpID) set.add(reqOrigin);
    } catch {
      /* ignore malformed origin */
    }
  }
  return [...set];
}

/**
 * Derive the WebAuthn RP ID + origin from the incoming request so biometric
 * works on ANY domain (localhost, Vercel preview/production, custom) with no
 * env config. Falls back to the configured values if headers are missing.
 */
export function rpFromRequest(req: {
  headers: { get(name: string): string | null };
}): { rpID: string; origin: string } {
  const host = req.headers.get("host");
  const originHeader = req.headers.get("origin") || (host ? `https://${host}` : origin);
  try {
    const u = new URL(originHeader);
    return { rpID: u.hostname, origin: u.origin };
  } catch {
    return { rpID, origin };
  }
}

const CHALLENGE_COOKIE = "infolog_webauthn_challenge";
const secret = new TextEncoder().encode(process.env.JWT_SECRET);

/**
 * The WebAuthn challenge must survive the round-trip between "options" and
 * "verify". We stash it (signed, http-only, 5 min) in a cookie.
 */
export async function storeChallenge(challenge: string, userId?: string) {
  const token = await new SignJWT({ challenge, userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret);
  const store = await cookies();
  store.set(CHALLENGE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 300,
  });
}

export async function readChallenge(): Promise<{
  challenge: string;
  userId?: string;
} | null> {
  const store = await cookies();
  const token = store.get(CHALLENGE_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifyToken<{ challenge: string; userId?: string }>(token);
  return payload ? { challenge: payload.challenge, userId: payload.userId } : null;
}

export async function clearChallenge() {
  const store = await cookies();
  store.delete(CHALLENGE_COOKIE);
}
