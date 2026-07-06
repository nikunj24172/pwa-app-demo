/**
 * FULL-FLOW verification for Nikunj's account against the local dev server:
 * login â†’ TOTP (from DB secret) â†’ me â†’ session create â†’ all 3 searches â†’
 * photo attach â†’ record merge (what the client auto-merge calls) â†’ re-merge
 * updates â†’ photo delete â†’ audit trail â†’ session list â†’ logout.
 * Run from project root: npx tsx <path>/verify-nikunj-flow.ts
 */
import mongoose from "mongoose";
import { generate } from "otplib";
import { User } from "../src/lib/models/User";

process.loadEnvFile(".env.local");

const BASE = "http://localhost:3001";
const EMAIL = "nikunj.chudasama@savannah-labs.com";
const PASSWORD = "Nikunj@123";

const cookies: Record<string, string> = {};
function setCookies(res: Response) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    cookies[pair.slice(0, i)] = pair.slice(i + 1);
  }
}
async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; "),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  setCookies(res);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data } as { status: number; data: any };
}
const check = (name: string, ok: boolean, extra = "") =>
  console.log(`${ok ? "âœ…" : "âŒ"} ${name}${extra ? " â€” " + extra : ""}`);

// --- 1. login (expect mfa_required if TOTP enrolled)
let r = await call("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
console.log(`login â†’ ${r.status} status=${r.data.status}`);

if (r.data.status === "mfa_required") {
  await mongoose.connect(process.env.MONGODB_URI!);
  const u = await User.findOne({ email: EMAIL }).select("+totpSecret totpEnabled").lean();
  await mongoose.disconnect();
  if (!u?.totpSecret) throw new Error("No TOTP secret in DB");
  const code = await generate({ secret: u.totpSecret });
  r = await call("POST", "/api/auth/mfa/verify", { token: code });
  check("TOTP verify", r.status === 200, `status=${r.status} ${JSON.stringify(r.data).slice(0, 80)}`);
} else {
  check("login w/o MFA (totp not enrolled)", r.data.status === "authenticated");
}

// --- 2. me
r = await call("GET", "/api/auth/me");
check("auth/me", r.status === 200, `user=${r.data.user?.name} mfa=${r.data.mfaEnabled} bio=${r.data.biometricEnrolled}`);

// --- 3. create session (blank title â†’ auto-name)
r = await call("POST", "/api/sessions", {});
const sid = r.data.session?._id;
check("session create (auto-title)", r.status === 201, r.data.session?.title);

// --- 4. all three searches
const searches: Array<[string, Record<string, string>]> = [
  ["vehicle", { registration: "RCF722" }],
  ["company", { name: "Fuel Media" }],
  ["property", { address: "Kennedy" }],
];
let vehicleRow: Record<string, unknown> | null = null;
for (const [type, fields] of searches) {
  r = await call("POST", `/api/search/${type}`, { fields, purpose: "verification", sessionId: sid });
  check(`search ${type}`, r.status === 200 && r.data.results?.length > 0, `${r.data.results?.length ?? 0} result(s)`);
  if (type === "vehicle") vehicleRow = r.data.results?.[0] ?? null;
}

// --- 5. photo attach (what the markup editor posts)
const px =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
r = await call("POST", `/api/sessions/${sid}/photos`, {
  dataUrl: px,
  resultKey: "vehicle:RCF722",
  label: "RCF722",
});
const photoId = r.data.photo?._id;
check("photo attach", r.status === 201, photoId);

// --- 6. record merge (the call the client AUTO-fires after attach)
r = await call("POST", `/api/sessions/${sid}/records`, {
  resultKey: "vehicle:RCF722",
  searchType: "vehicle",
  title: "2025 Ford Ranger Wildtrak",
  data: vehicleRow ?? { registration: "RCF722" },
});
check("auto-merge record", r.status === 201, r.data.record?._id);

// --- 7. re-merge UPDATES (no duplicate)
r = await call("POST", `/api/sessions/${sid}/records`, {
  resultKey: "vehicle:RCF722",
  searchType: "vehicle",
  title: "2025 Ford Ranger Wildtrak",
  data: { ...(vehicleRow ?? {}), latestOdometer: 999 },
});
const recCount = (await call("GET", `/api/sessions/${sid}/records`)).data.records?.length;
check("re-merge updates (1 record, odo=999)", r.status === 201 && recCount === 1,
  `count=${recCount} odo=${r.data.record?.data?.latestOdometer}`);

// --- 8. photo delete
r = await call("DELETE", `/api/sessions/${sid}/photos?photoId=${photoId}`);
check("photo delete", r.status === 200);

// --- 9. audit trail
r = await call("GET", `/api/history?sessionId=${sid}`);
const actions = (r.data.history ?? []).map((h: any) => h.action);
check(
  "trail has search+attach+merge+delete",
  ["search", "photo_attach", "record_merge", "photo_delete"].every((a) => actions.includes(a)),
  actions.join(",")
);

// --- 10. session list shows it (48h window)
r = await call("GET", "/api/sessions");
check("dashboard list contains session", r.data.sessions?.some((s: any) => s._id === sid), `${r.data.sessions?.length} session(s) listed`);

// --- 11. logout, session cookie cleared
r = await call("POST", "/api/auth/logout");
const after = await call("GET", "/api/auth/me");
check("logout kills session", after.status === 401, `me after logout=${after.status}`);


