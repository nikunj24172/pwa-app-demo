"use client";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, post } from "@/lib/client";
import { cacheGet, cacheSet, cacheGetBlob, cacheSetBlob, searchCacheKey } from "@/lib/offlineStore";
import { compressImage } from "@/lib/image";
import AppShell, { type Me } from "@/components/AppShell";
import { Button, Input, Badge, Alert, Spinner, SectionLabel, KV } from "@/components/ui";
import {
  type SearchType,
  renderResult,
  Chips,
  mapAddress,
  mapLabel,
} from "@/components/results";
import {
  SEARCH_SERVICES,
  PROVIDERS,
  type SearchService,
  type SearchMode,
} from "@/lib/searchFields";
import OwnerMap from "@/components/OwnerMap";
import PhotoMarkup from "@/components/PhotoMarkup";

interface FileSession {
  _id: string;
  title: string;
  caseRef: string;
  status: "open" | "closed";
  searchCount: number;
}
interface HistoryItem {
  _id: string;
  action?: "search" | "photo_attach" | "record_merge";
  searchType: SearchType;
  searchedValue: string;
  resultCount: number;
  createdAt: string;
}
interface SessionPhoto {
  _id: string;
  resultKey?: string;
  dataUrl: string;
  label?: string;
  createdAt: string;
}
interface SessionRecord {
  _id: string;
  resultKey: string;
  searchType: SearchType;
  title: string;
  createdAt: string;
}

/** Stable identifier for a search result, so photos re-attach on re-search. */
function resultKeyOf(type: SearchType, plateOrTitle: string): string {
  return `${type}:${plateOrTitle}`;
}

const FAV_KEY = "prefs:favServices";
const FAV_TTL_MS = 30 * 24 * 60 * 60 * 1000; // favourites live longer than data caches
const TYPE_ORDER: SearchType[] = ["vehicle", "company", "property"];

/** Every field key that exists for a given record type. */
function fieldKeysFor(type: SearchType): Set<string> {
  const keys = new Set<string>();
  SEARCH_SERVICES.filter((s) => s.type === type).forEach((s) =>
    s.modes.forEach((m) => m.fields.forEach((f) => keys.add(f.key)))
  );
  return keys;
}

/** Reverse of summariseFields: "registration=RCF722, name=Fuel Media" → fields. */
function parseSummary(type: SearchType, summary: string): Record<string, string> {
  const keys = fieldKeysFor(type);
  const out: Record<string, string> = {};
  // Split on ", " only when it precedes another "key=" so values may contain commas.
  for (const part of summary.split(/,\s*(?=\w+=)/)) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    if (keys.has(k)) out[k] = part.slice(i + 1).trim();
  }
  return out;
}

/** Pick the service whose mode covers the reconstructed fields. */
function findService(type: SearchType, fields: Record<string, string>): SearchService | null {
  const fk = Object.keys(fields);
  const ofType = SEARCH_SERVICES.filter((s) => s.type === type);
  for (const s of ofType) {
    for (const m of s.modes) {
      const mk = m.fields.map((f) => f.key);
      if (fk.length > 0 && fk.every((k) => mk.includes(k))) return s;
    }
  }
  return ofType[0] ?? null; // fallback: first service of this type
}

/** The human value(s) of a logged search, e.g. "Fuel Media Limited". */
function logTitle(type: SearchType, summary: string): string {
  const vals = Object.values(parseSummary(type, summary));
  return vals.length ? vals.join(" · ") : summary;
}

function logTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Count photos attached to results this audit-trail search surfaced. Photos key
 * on the RESULT (`type:plateOrTitle`); logs only store the query — so match a
 * photo when its result value overlaps a searched value (covers partial
 * searches, e.g. searching "KLR" that surfaced "KLR582").
 */
function photosForLog(h: HistoryItem, photos: SessionPhoto[]): number {
  const vals = Object.values(parseSummary(h.searchType, h.searchedValue))
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length >= 2);
  if (!vals.length) return 0;
  return photos.filter((p) => {
    if (!p.resultKey?.startsWith(`${h.searchType}:`)) return false;
    const keyVal = p.resultKey.slice(h.searchType.length + 1).toLowerCase();
    return vals.some((v) => keyVal.includes(v) || v.includes(keyVal));
  }).length;
}

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <AppShell title="Active session" eyebrow="File session" back="/dashboard">
      {(me) => <SessionView id={id} me={me} />}
    </AppShell>
  );
}

function SessionView({ id, me }: { id: string; me: Me }) {
  const router = useRouter();

  const services = useMemo(
    () =>
      SEARCH_SERVICES.filter(
        (s) => me.user.role === "admin" || me.user.permissions.includes(`search:${s.type}`)
      ),
    [me]
  );

  const [session, setSession] = useState<FileSession | null>(null);
  const [offline, setOffline] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [favs, setFavs] = useState<string[]>([]);
  const [menuTab, setMenuTab] = useState<"my" | "all">("all");

  const [activeId, setActiveId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, unknown>[]>([]);
  const [searched, setSearched] = useState(false);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<SessionPhoto[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoErr, setPhotoErr] = useState("");
  const [markup, setMarkup] = useState<string | null>(null); // captured photo being edited
  const [captureFor, setCaptureFor] = useState<string | null>(null); // result key being captured
  const [mergeBusy, setMergeBusy] = useState<string | null>(null); // resultKey being merged

  const active = services.find((s) => s.id === activeId) || null;

  const loadPhotos = useCallback(async () => {
    try {
      const r = await api<{ photos: SessionPhoto[] }>(`/api/sessions/${id}/photos`);
      setPhotos(r.photos);
      // 48h offline: metadata as JSON, each image as an encrypted BLOB (raw
      // bytes — smaller than base64, no giant-string JSON overhead).
      cacheSet(
        `photos:${id}`,
        r.photos.map((p) => ({
          _id: p._id,
          resultKey: p.resultKey,
          label: p.label,
          createdAt: p.createdAt,
        }))
      );
      r.photos.forEach(async (p) => {
        try {
          const blob = await (await fetch(p.dataUrl)).blob();
          cacheSetBlob(`photo:${p._id}`, blob);
        } catch {
          /* best-effort */
        }
      });
    } catch {
      // Offline: rebuild the gallery from cached metadata + encrypted blobs.
      const cached = await cacheGet<Omit<SessionPhoto, "dataUrl">[]>(`photos:${id}`);
      if (!cached) return;
      const rebuilt: SessionPhoto[] = [];
      for (const meta of cached.value) {
        const b = await cacheGetBlob(`photo:${meta._id}`);
        if (b) rebuilt.push({ ...meta, dataUrl: URL.createObjectURL(b.blob) });
      }
      setPhotos(rebuilt);
    }
  }, [id]);

  // Merge THIS search result (snapshot) into the file session.
  async function mergeToFile(
    rKey: string,
    type: SearchType,
    title: string,
    row: Record<string, unknown>
  ) {
    setMergeBusy(rKey);
    setPhotoErr("");
    try {
      await post<{ record: SessionRecord }>(`/api/sessions/${id}/records`, {
        resultKey: rKey,
        searchType: type,
        title,
        data: row,
      });
      // The merge is audited server-side — refresh the trail so the
      // "Record updated" entry (with time) appears immediately.
      loadHistory();
    } catch (e) {
      setPhotoErr((e as Error).message || "Couldn't merge to file.");
    } finally {
      setMergeBusy(null);
    }
  }

  // Capture (from a specific search result) → open the markup editor.
  async function capturePhoto(e: React.ChangeEvent<HTMLInputElement>, key: string) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setPhotoErr("");
    setCaptureFor(key);
    try {
      const dataUrl = await compressImage(file);
      setMarkup(dataUrl);
    } catch (e) {
      setPhotoErr((e as Error).message || "Couldn't read the photo.");
    }
  }

  // Attach the marked-up image to the search RESULT it was captured from.
  async function attachPhoto(finalDataUrl: string) {
    setPhotoBusy(true);
    setPhotoErr("");
    try {
      const r = await post<{ photo: SessionPhoto }>(`/api/sessions/${id}/photos`, {
        dataUrl: finalDataUrl,
        resultKey: captureFor ?? undefined,
        label: captureFor?.split(":").slice(1).join(":") || undefined,
      });
      setPhotos((prev) => [r.photo, ...prev]);
      setMarkup(null);
      setCaptureFor(null);
      loadHistory(); // the attach is audited — surface "Photo added" with time
      // Make the new photo offline-available immediately (blob + metadata).
      try {
        const blob = await (await fetch(r.photo.dataUrl)).blob();
        await cacheSetBlob(`photo:${r.photo._id}`, blob);
        const meta = {
          _id: r.photo._id,
          resultKey: r.photo.resultKey,
          label: r.photo.label,
          createdAt: r.photo.createdAt,
        };
        const cached = await cacheGet<Omit<SessionPhoto, "dataUrl">[]>(`photos:${id}`);
        cacheSet(`photos:${id}`, [meta, ...(cached?.value ?? [])]);
      } catch {
        /* best-effort */
      }
    } catch (e) {
      setPhotoErr((e as Error).message || "Couldn't save the photo.");
    } finally {
      setPhotoBusy(false);
    }
  }

  const loadHistory = useCallback(async () => {
    try {
      const r = await api<{ history: HistoryItem[] }>(`/api/history?sessionId=${id}`);
      setHistory(r.history);
      cacheSet(`history:${id}`, r.history);
    } catch {
      const cached = await cacheGet<HistoryItem[]>(`history:${id}`);
      if (cached) setHistory(cached.value);
    }
  }, [id]);

  useEffect(() => {
    api<{ session: FileSession }>(`/api/sessions/${id}`)
      .then((r) => {
        setSession(r.session);
        setOffline(false);
        cacheSet(`session:${id}`, r.session);
      })
      .catch(async () => {
        // Offline: show the cached session if we captured it within 48h.
        const cached = await cacheGet<FileSession>(`session:${id}`);
        if (cached) {
          setSession(cached.value);
          setOffline(true);
        } else {
          router.replace("/dashboard");
        }
      });
    loadHistory();
    loadPhotos();
    cacheGet<string[]>(FAV_KEY).then((hit) => {
      if (hit) setFavs(hit.value);
    });
  }, [id, loadHistory, loadPhotos, router]);

  function toggleFav(sid: string) {
    const next = favs.includes(sid) ? favs.filter((x) => x !== sid) : [...favs, sid];
    setFavs(next);
    void cacheSet(FAV_KEY, next, FAV_TTL_MS);
  }

  function openService(s: SearchService) {
    setActiveId(s.id);
    setValues({});
    setResults([]);
    setSearched(false);
    setErr("");
    setOpenId(null);
  }

  function backToMenu() {
    setActiveId(null);
    setResults([]);
    setSearched(false);
    setErr("");
  }

  // Core search runner, shared by the form and by tapping an audit-trail entry.
  const executeSearch = useCallback(
    async (service: SearchService, fields: Record<string, string>) => {
      setActiveId(service.id);
      setValues(fields);
      setOpenId(null);
      setErr("");
      setBusy(true);
      setSearched(false);
      const key = searchCacheKey(service.type, id, fields);
      try {
        const r = await post<{ results: Record<string, unknown>[]; summary: string }>(
          `/api/search/${service.type}`,
          { fields, purpose: service.purpose, sessionId: id }
        );
        setResults(r.results);
        setSummary(r.summary);
        setSearched(true);
        cacheSet(key, { results: r.results, summary: r.summary }); // save for offline replay
        loadHistory();
      } catch (e) {
        // Offline: replay this exact search if it was captured within 48h.
        const cached = await cacheGet<{ results: Record<string, unknown>[]; summary: string }>(key);
        if (cached) {
          setResults(cached.value.results);
          setSummary(cached.value.summary);
          setSearched(true);
          setErr("Offline — showing the last saved results for this search.");
        } else {
          setResults([]);
          setSearched(true);
          setErr(
            navigator.onLine
              ? (e as Error).message
              : "You're offline and haven't run this search before. Reconnect to search."
          );
        }
      } finally {
        setBusy(false);
      }
    },
    [id, loadHistory]
  );

  function runMode(service: SearchService, mode: SearchMode, e: React.FormEvent) {
    e.preventDefault();
    const fields: Record<string, string> = {};
    mode.fields.forEach((f) => (fields[f.key] = values[f.key] ?? ""));
    executeSearch(service, fields);
  }

  // Tapping an audit-trail row rebuilds the original query and re-opens its
  // result (live when online, from the 48h cache when offline).
  function openLog(h: HistoryItem) {
    const fields = parseSummary(h.searchType, h.searchedValue);
    const service = findService(h.searchType, fields);
    if (!service) return;
    executeSearch(service, fields);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function accessResult(key: string, label: string, type: SearchType) {
    setOpenId(openId === key ? null : key);
    if (openId !== key) {
      post("/api/search/access", { searchType: type, value: label, sessionId: id }).catch(
        () => {}
      );
    }
  }

  async function shareSession() {
    if (!session) return;
    const url = typeof window !== "undefined" ? window.location.href : "";
    const data: ShareData = {
      title: `InfoLog — ${session.title}`,
      text: `File session: ${session.title}${session.caseRef ? ` (${session.caseRef})` : ""}`,
      url,
    };
    try {
      if (navigator.share) {
        await navigator.share(data);
      } else if (navigator.clipboard && url) {
        await navigator.clipboard.writeText(url);
        setErr("Session link copied to clipboard.");
      }
    } catch {
      /* user cancelled the share sheet — ignore */
    }
  }

  if (!session)
    return (
      <div className="flex justify-center py-8 text-muted">
        <Spinner />
      </div>
    );

  const shown = menuTab === "my" ? services.filter((s) => favs.includes(s.id)) : services;

  return (
    <div className="flex flex-col gap-4">
      {markup && (
        <PhotoMarkup
          image={markup}
          busy={photoBusy}
          onCancel={() => setMarkup(null)}
          onAttach={attachPhoto}
        />
      )}

      {/* session banner */}
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="flex min-w-0 items-center gap-2 font-semibold text-accent">
            <span className="text-warn">★</span>
            <span className="truncate">{session.title}</span>
          </p>
          <Badge tone="ok">Audited</Badge>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <BannerBtn onClick={shareSession} label="🔗 Share" />
          <BannerBtn onClick={() => loadHistory()} label="🕘 History" />
          <BannerBtn onClick={backToMenu} label="🔎 New" />
        </div>
      </div>

      {err && <Alert>{err}</Alert>}

      {active ? (
        /* ---------- focused service view ---------- */
        <div className="flex flex-col gap-4">
          <button onClick={backToMenu} className="self-start text-xs text-muted">
            ← All searches
          </button>
          <div>
            <p className="text-xs font-semibold text-accent">{active.breadcrumb}</p>
            <h2 className="text-xl font-extrabold tracking-tight">{active.title}</h2>
          </div>

          {active.modes.map((mode, mi) => (
            <div key={mi}>
              {mi > 0 && <div className="my-1 h-px bg-border" />}
              <SectionLabel>{mode.label}</SectionLabel>
              <form
                onSubmit={(e) => runMode(active, mode, e)}
                className="flex flex-col gap-3"
              >
                {mode.fields.map((f) => (
                  <div key={f.key}>
                    <label className="mb-1 block text-xs font-medium text-muted">
                      {f.label}
                    </label>
                    <Input
                      value={values[f.key] ?? ""}
                      onChange={(e) =>
                        setValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                      }
                      placeholder={f.placeholder}
                      autoCapitalize={f.caps ? "characters" : "none"}
                    />
                  </div>
                ))}
                <Button type="submit" loading={busy}>
                  🔍 {mode.button}
                </Button>
              </form>
            </div>
          ))}

          <p className="text-[11px] leading-relaxed text-muted">{active.source}</p>


          {searched && (
            <p className="text-xs text-muted">
              {results.length} result{results.length === 1 ? "" : "s"}
              {summary && <> for “{summary}”</>}
            </p>
          )}

          <Results
            results={results}
            type={active.type}
            openId={openId}
            onOpen={accessResult}
            photos={photos}
            onCapture={capturePhoto}
            photoBusy={photoBusy}
            photoErr={photoErr}
            canCapture={!offline}
            onMerge={mergeToFile}
            mergeBusy={mergeBusy}
          />
        </div>
      ) : (
        /* ---------- search-service menu ---------- */
        <>
          <div className="flex gap-1.5 rounded-xl bg-surface-2 p-1">
            {(["all", "my"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setMenuTab(t)}
                className={
                  "flex-1 rounded-lg py-2 text-sm font-semibold transition " +
                  (menuTab === t ? "bg-surface text-accent shadow" : "text-muted")
                }
              >
                {t === "all" ? "Available menu" : "My menu"}
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <p className="rounded-2xl border border-border bg-surface p-5 text-center text-sm text-muted">
              {menuTab === "my"
                ? "No favourites yet. Tap the ★ on a search to add it here."
                : "No searches available for your role."}
            </p>
          ) : (
            TYPE_ORDER.filter((type) => shown.some((s) => s.type === type)).map((type) => (
              <div key={type} className="overflow-hidden rounded-2xl border border-border">
                <div className="flex items-center gap-3 bg-gradient-to-br from-teal to-teal-deep px-4 py-3 text-white">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-white/15 text-sm">
                    {PROVIDERS[type].icon}
                  </span>
                  <div>
                    <p className="text-sm font-bold leading-tight">{PROVIDERS[type].name}</p>
                    <p className="text-[10px] italic text-white/70">{PROVIDERS[type].sub}</p>
                  </div>
                </div>
                <div className="bg-surface">
                  {shown
                    .filter((s) => s.type === type)
                    .map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center gap-3 border-b border-border/60 px-4 py-3.5 last:border-none"
                      >
                        <button
                          onClick={() => toggleFav(s.id)}
                          aria-label="Favourite"
                          className={favs.includes(s.id) ? "text-warn" : "text-muted/50"}
                        >
                          ★
                        </button>
                        <button
                          onClick={() => openService(s)}
                          className="flex flex-1 items-center justify-between gap-2 text-left"
                        >
                          <span className="text-sm font-semibold text-accent">{s.title}</span>
                          <span className="text-muted">›</span>
                        </button>
                      </div>
                    ))}
                </div>
              </div>
            ))
          )}

          {history.length > 0 && (
            <div className="mt-1">
              <SectionLabel count={history.length}>Audit trail</SectionLabel>
              <div className="flex flex-col gap-2">
                {history.slice(0, 12).map((h) => {
                  const action = h.action ?? "search";
                  const nPhotos = photosForLog(h, photos);
                  return (
                    <button
                      key={h._id}
                      onClick={() => openLog(h)}
                      className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 text-left transition hover:border-accent active:scale-[0.99]"
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 text-sm">
                        {action === "photo_attach" ? "📸" : PROVIDERS[h.searchType].icon}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">
                          {logTitle(h.searchType, h.searchedValue)}
                        </p>
                        <p className="truncate text-xs text-muted">
                          {action === "photo_attach" ? (
                            <>Photo added · {logTime(h.createdAt)}</>
                          ) : action === "record_merge" ? (
                            <>
                              {nPhotos > 0 && <>📎 {nPhotos} photo{nPhotos === 1 ? "" : "s"} · </>}
                              Record updated · {logTime(h.createdAt)}
                            </>
                          ) : (
                            <>
                              {nPhotos > 0 && <>📎 {nPhotos} photo{nPhotos === 1 ? "" : "s"} · </>}
                              {h.resultCount} result{h.resultCount === 1 ? "" : "s"} found ·{" "}
                              {logTime(h.createdAt)}
                            </>
                          )}
                        </p>
                      </div>
                      <Badge tone={action === "search" ? "ok" : "accent"}>
                        {action === "photo_attach"
                          ? "Photo"
                          : action === "record_merge"
                            ? "Updated"
                            : "Logged"}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BannerBtn({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "rounded-lg border border-border bg-surface-2 px-2 py-2 text-xs font-semibold " +
        (danger ? "text-danger" : "text-foreground")
      }
    >
      {label}
    </button>
  );
}

function Results({
  results,
  type,
  openId,
  onOpen,
  photos,
  onCapture,
  photoBusy,
  photoErr,
  canCapture,
  onMerge,
  mergeBusy,
}: {
  results: Record<string, unknown>[];
  type: SearchType;
  openId: string | null;
  onOpen: (key: string, label: string, type: SearchType) => void;
  photos: SessionPhoto[];
  onCapture: (e: React.ChangeEvent<HTMLInputElement>, key: string) => void;
  photoBusy: boolean;
  photoErr: string;
  canCapture: boolean;
  onMerge: (rKey: string, type: SearchType, title: string, row: Record<string, unknown>) => void;
  mergeBusy: string | null;
}) {
  return (
    <div className="flex flex-col gap-3">
      {results.map((row, i) => {
        const key = `${type}-${i}`;
        const r = renderResult(type, row);
        const rKey = resultKeyOf(type, r.plate || r.title);
        const rphotos = photos.filter((p) => p.resultKey === rKey);
        const open = openId === key;
        return (
          <div key={key} className="overflow-hidden rounded-2xl border border-border bg-surface">
            <button
              onClick={() => onOpen(key, r.plate || r.title, type)}
              className="flex w-full items-center gap-3 p-4 text-left"
            >
              {r.plate && (
                <span className="shrink-0 rounded-md border border-slate-300 bg-gradient-to-b from-white to-slate-200 px-2 py-1 text-xs font-extrabold tracking-wider text-slate-900">
                  {r.plate}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{r.title}</p>
                <p className="truncate text-xs text-muted">{r.subtitle}</p>
              </div>
              <Badge tone={r.statusChip.tone}>{r.statusChip.label}</Badge>
            </button>

            {open && (
              <div className="space-y-3 border-t border-border p-4">
                <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1b2740] to-[#0f1a2e] p-4">
                  <Chips chips={r.chips} />
                  <h3 className="mt-3 text-base font-extrabold leading-tight">{r.title}</h3>
                  <div className="mt-3 flex items-center gap-3">
                    {r.plate && (
                      <span className="rounded-md border-2 border-slate-300 bg-gradient-to-b from-white to-slate-200 px-3 py-1.5 text-base font-extrabold tracking-wider text-slate-900">
                        {r.plate}
                      </span>
                    )}
                    <span className="text-xs text-muted">{r.subtitle}</span>
                  </div>
                </div>

                {r.sections.map((sec) => (
                  <div
                    key={sec.heading}
                    className="rounded-2xl border border-border bg-surface-2/40 p-4"
                  >
                    <SectionLabel>{sec.heading}</SectionLabel>
                    <dl>
                      {sec.rows.map(([k, v]) => (
                        <KV key={k} k={k} v={v} />
                      ))}
                    </dl>
                  </div>
                ))}

                {mapAddress(type, row) && (
                  <div className="rounded-2xl border border-border bg-surface-2/40 p-4">
                    <SectionLabel>Location</SectionLabel>
                    <OwnerMap address={mapAddress(type, row) as string} label={mapLabel(type, row)} />
                  </div>
                )}

                {/* Photos + merge — actions for THIS search result */}
                <div className="rounded-2xl border border-border bg-surface-2/40 p-4">
                  <SectionLabel count={rphotos.length || undefined}>Photos</SectionLabel>
                  {canCapture ? (
                    <div className="mt-1 grid grid-cols-2 gap-2">
                      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-surface px-3 py-3 text-sm font-semibold">
                        {photoBusy ? <Spinner /> : "📎"}
                        {photoBusy ? "Saving…" : "Attach photo"}
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          disabled={photoBusy}
                          onChange={(e) => onCapture(e, rKey)}
                        />
                      </label>
                      <button
                        onClick={() => onMerge(rKey, type, r.title, row)}
                        disabled={mergeBusy === rKey}
                        className="flex items-center justify-center gap-2 rounded-xl bg-teal px-3 py-3 text-sm font-bold text-white disabled:opacity-60"
                      >
                        {mergeBusy === rKey && <Spinner />}
                        {mergeBusy === rKey ? "Merging…" : "Merge to file"}
                      </button>
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-muted">
                      Reconnect (online, open session) to add photos or merge.
                    </p>
                  )}
                  {photoErr && <p className="mt-2 text-sm text-danger">{photoErr}</p>}
                  {rphotos.length > 0 && (
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {rphotos.map((p) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={p._id}
                          src={p.dataUrl}
                          alt={p.label || "Photo"}
                          className="aspect-square w-full rounded-lg border border-border object-cover"
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
