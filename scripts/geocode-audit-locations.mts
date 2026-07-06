/**
 * One-off migration: convert audit-log `location` values stored as raw
 * "lat, lng" coordinates into real place names ("Ambawadi, Ahmedabad,
 * Gujarat") via OpenStreetMap reverse geocoding. Each UNIQUE coordinate is
 * geocoded once (1 req/sec, per Nominatim usage policy) and bulk-updated.
 * Run: npx tsx scripts/geocode-audit-locations.mts
 */
import mongoose from "mongoose";
import { AuditLog } from "../src/lib/models/AuditLog";

process.loadEnvFile(".env.local");

const COORDS_RE = /^\s*(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)\s*$/;

async function reverseGeocode(lat: string, lng: string): Promise<string | undefined> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=14&accept-language=en`,
    { headers: { Accept: "application/json", "User-Agent": "infolog-audit-migration/1.0" } }
  );
  if (!res.ok) return undefined;
  const j = (await res.json()) as { display_name?: string; address?: Record<string, string> };
  const a = j.address ?? {};
  const parts = [
    a.suburb || a.neighbourhood || a.quarter || a.village || a.town,
    a.city || a.town || a.municipality || a.county,
    a.state,
  ].filter(Boolean);
  return parts.length
    ? [...new Set(parts)].join(", ")
    : j.display_name?.split(",").slice(0, 3).join(",").trim() || undefined;
}

await mongoose.connect(process.env.MONGODB_URI!);

const coordLocs: string[] = (await AuditLog.distinct("location", { location: COORDS_RE })) as string[];
console.log(`${coordLocs.length} unique coordinate value(s) to geocode`);

let updated = 0;
for (const loc of coordLocs) {
  const m = loc.match(COORDS_RE);
  if (!m) continue;
  const place = await reverseGeocode(m[1], m[2]).catch(() => undefined);
  if (!place) {
    console.log(`  ✗ ${loc} — geocoding failed, left as coordinates`);
  } else {
    const r = await AuditLog.updateMany({ location: loc }, { $set: { location: place } });
    updated += r.modifiedCount;
    console.log(`  ✓ ${loc} → ${place} (${r.modifiedCount} entr${r.modifiedCount === 1 ? "y" : "ies"})`);
  }
  await new Promise((r) => setTimeout(r, 1100)); // Nominatim: max 1 req/sec
}

console.log(`\nDone. ${updated} audit entr${updated === 1 ? "y" : "ies"} now show a real location.`);
await mongoose.disconnect();
