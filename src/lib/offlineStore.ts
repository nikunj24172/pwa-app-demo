"use client";

/**
 * Encrypted, self-expiring offline cache (IndexedDB) so a field officer can
 * open the PWA with NO connectivity and still read their file sessions and the
 * search results they already ran — for up to 48 hours.
 *
 * Why IndexedDB (not localStorage): it is async (never blocks the UI), stores
 * structured records individually (read one search without deserialising all),
 * scales far past the ~5MB localStorage cap, and is reachable from a service
 * worker. See sessionCache.ts for the small, non-sensitive metadata cache.
 *
 * SECURITY: MVR search results contain PII, so every payload is encrypted with
 * AES-GCM before it touches disk. The key is a NON-EXTRACTABLE CryptoKey kept
 * in IndexedDB — usable to decrypt in-app but not readable as raw bytes — so
 * the on-disk object store holds only ciphertext (nothing legible via DevTools
 * or filesystem access). On logout, clearOfflineCache() wipes both the data and
 * the key, making any residual ciphertext unrecoverable.
 */

const DB_NAME = "infolog-offline";
const DB_VERSION = 1;
const DATA_STORE = "cache";
const KEY_STORE = "crypto";

/** How long a cached record stays readable offline. */
export const OFFLINE_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

interface Envelope {
  key: string;
  iv: Uint8Array;
  ct: ArrayBuffer;
  savedAt: number;
  expiresAt: number;
  /** "blob" = raw binary (e.g. photos); absent/"json" = JSON payload. */
  kind?: "json" | "blob";
  /** MIME type, kept so a Blob can be reconstructed as it was stored. */
  mime?: string;
}

const hasIDB = () => typeof indexedDB !== "undefined";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DATA_STORE)) {
        const s = db.createObjectStore(DATA_STORE, { keyPath: "key" });
        s.createIndex("expiresAt", "expiresAt"); // enables cheap range sweep of stale rows
      }
      if (!db.objectStoreNames.contains(KEY_STORE)) {
        db.createObjectStore(KEY_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** Run a single-request transaction and resolve with its result. */
function run<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      })
  );
}

/* ------------------------------- encryption ------------------------------- */

let keyPromise: Promise<CryptoKey> | null = null;

/** Get (or lazily generate) the per-install AES key. Non-extractable. */
function getCryptoKey(): Promise<CryptoKey> {
  if (keyPromise) return keyPromise;
  keyPromise = (async () => {
    const existing = await run<{ id: string; key: CryptoKey } | undefined>(
      KEY_STORE,
      "readonly",
      (s) => s.get("aes")
    );
    if (existing?.key) return existing.key;
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    await run(KEY_STORE, "readwrite", (s) => s.put({ id: "aes", key }));
    return key;
  })();
  return keyPromise;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/* --------------------------------- API ------------------------------------ */

/** Encrypt + store a value under `key`, expiring after `ttlMs` (default 48h). */
export async function cacheSet(key: string, value: unknown, ttlMs = OFFLINE_TTL_MS): Promise<void> {
  if (!hasIDB()) return;
  try {
    const cryptoKey = await getCryptoKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      cryptoKey,
      encoder.encode(JSON.stringify(value))
    );
    const now = Date.now();
    const env: Envelope = { key, iv, ct, savedAt: now, expiresAt: now + ttlMs };
    await run(DATA_STORE, "readwrite", (s) => s.put(env));
  } catch {
    /* storage full / crypto unavailable — offline cache is best-effort */
  }
}

/** Read + decrypt a value. Returns null if missing or older than its TTL. */
export async function cacheGet<T>(key: string): Promise<{ value: T; savedAt: number } | null> {
  if (!hasIDB()) return null;
  try {
    const env = await run<Envelope | undefined>(DATA_STORE, "readonly", (s) => s.get(key));
    if (!env || env.kind === "blob") return null;
    if (env.expiresAt < Date.now()) {
      await cacheDelete(key);
      return null;
    }
    const cryptoKey = await getCryptoKey();
    const buf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: env.iv as BufferSource },
      cryptoKey,
      env.ct
    );
    return { value: JSON.parse(decoder.decode(buf)) as T, savedAt: env.savedAt };
  } catch {
    return null;
  }
}

/**
 * Encrypt + store BINARY data (e.g. a photo) under `key`. Blobs are stored as
 * raw encrypted bytes — no base64 inflation (~33% smaller than string storage)
 * and no JSON.stringify memory spikes on large images.
 */
export async function cacheSetBlob(key: string, blob: Blob, ttlMs = OFFLINE_TTL_MS): Promise<void> {
  if (!hasIDB()) return;
  try {
    const cryptoKey = await getCryptoKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      cryptoKey,
      await blob.arrayBuffer()
    );
    const now = Date.now();
    const env: Envelope = {
      key,
      iv,
      ct,
      savedAt: now,
      expiresAt: now + ttlMs,
      kind: "blob",
      mime: blob.type || "image/jpeg",
    };
    await run(DATA_STORE, "readwrite", (s) => s.put(env));
  } catch {
    /* storage full / crypto unavailable — offline cache is best-effort */
  }
}

/** Read + decrypt a Blob. Returns null if missing, wrong kind, or expired. */
export async function cacheGetBlob(
  key: string
): Promise<{ blob: Blob; savedAt: number } | null> {
  if (!hasIDB()) return null;
  try {
    const env = await run<Envelope | undefined>(DATA_STORE, "readonly", (s) => s.get(key));
    if (!env || env.kind !== "blob") return null;
    if (env.expiresAt < Date.now()) {
      await cacheDelete(key);
      return null;
    }
    const cryptoKey = await getCryptoKey();
    const buf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: env.iv as BufferSource },
      cryptoKey,
      env.ct
    );
    return { blob: new Blob([buf], { type: env.mime || "image/jpeg" }), savedAt: env.savedAt };
  } catch {
    return null;
  }
}

export async function cacheDelete(key: string): Promise<void> {
  if (!hasIDB()) return;
  try {
    await run(DATA_STORE, "readwrite", (s) => s.delete(key));
  } catch {
    /* non-fatal */
  }
}

/** Delete every record whose TTL has elapsed. Call on app startup. */
export async function sweepExpired(): Promise<void> {
  if (!hasIDB()) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(DATA_STORE, "readwrite");
      const idx = t.objectStore(DATA_STORE).index("expiresAt");
      const range = IDBKeyRange.upperBound(Date.now());
      const cur = idx.openCursor(range);
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return;
        c.delete();
        c.continue();
      };
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  } catch {
    /* non-fatal */
  }
}

/** Wipe all cached data AND the encryption key. Call on logout. */
export async function clearOfflineCache(): Promise<void> {
  if (!hasIDB()) return;
  keyPromise = null;
  try {
    await run(DATA_STORE, "readwrite", (s) => s.clear());
    await run(KEY_STORE, "readwrite", (s) => s.clear());
  } catch {
    /* non-fatal */
  }
}

/**
 * Ask the browser to keep our storage across disk-pressure eviction — without
 * this, the 48h window can be cut short. Safe to call repeatedly.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Deterministic cache key for a search, so re-running the same query offline
 * resolves to the results captured when it last ran online.
 */
export function searchCacheKey(
  type: string,
  sessionId: string,
  fields: Record<string, string>
): string {
  const norm = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${(fields[k] ?? "").trim().toLowerCase()}`)
    .filter((p) => !p.endsWith("="))
    .join("&");
  return `search:${type}:${sessionId}:${norm}`;
}
