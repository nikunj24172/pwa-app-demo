"use client";

/**
 * Client-side cache of file-session METADATA so a field officer can open the
 * app offline and still see / continue their sessions for up to 48 hours.
 *
 * Stored in the ENCRYPTED IndexedDB cache (offlineStore) — not localStorage —
 * so session titles / case refs are never legible on disk, expire with the
 * same 48h sweep as everything else, and are wiped by clearOfflineCache() on
 * sign-out.
 */
import { cacheSet, cacheGet, cacheDelete, OFFLINE_TTL_MS } from "./offlineStore";

export interface CachedSession {
  _id: string;
  title: string;
  caseRef: string;
  status: "open" | "closed";
  searchCount: number;
  lastActiveAt: string;
  createdAt: string;
}

const KEY = "sessions:list";
/** Long-lived, non-sensitive marker so "expired" can be told apart from "never cached". */
const SYNC_KEY = "sessions:lastSync";
const SYNC_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Pre-migration plaintext localStorage key — removed on sight. */
const LEGACY_KEY = "infolog.sessions.v1";

function dropLegacy() {
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {}
}

export async function cacheSessions(sessions: CachedSession[]): Promise<void> {
  dropLegacy();
  await cacheSet(KEY, sessions, OFFLINE_TTL_MS);
  await cacheSet(SYNC_KEY, Date.now(), SYNC_TTL_MS);
}

export async function getCachedSessions(): Promise<{
  sessions: CachedSession[];
  expired: boolean;
}> {
  dropLegacy();
  const hit = await cacheGet<CachedSession[]>(KEY);
  if (hit) return { sessions: hit.value, expired: false };
  // No data — if we HAVE synced before, the 48h window lapsed (vs. never cached).
  const marker = await cacheGet<number>(SYNC_KEY);
  return { sessions: [], expired: marker !== null };
}

export async function clearCachedSessions(): Promise<void> {
  dropLegacy();
  await cacheDelete(KEY);
  await cacheDelete(SYNC_KEY);
}
