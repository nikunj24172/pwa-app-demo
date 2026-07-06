# Key Updates (July 3, 2026)

## Routing & Service Worker
- Fixed intermittent navigation failures (click reloading but staying on the same page) by separating page and router-data caches in the service worker.
- Dashboard, Profile, and Settings are pre-cached while online, so offline navigation always works — no more browser error page.
- New service worker versions now roll out automatically on the next app launch after a deployment.

## Storage & Security
- Finalized the storage model: auth tokens in httpOnly cookies, all offline data in encrypted IndexedDB (AES-GCM, 48-hour expiry), localStorage kept only for install-prompt flags.
- Offline biometric unlock now persists across pages — one fingerprint/face check per offline session; the 2-minute idle lock still applies.

## Photo Capture & Audit Trail
- Photos attach to individual search results (camera → markup editor → attach) and are stored encrypted for 48-hour offline viewing.
- Photo attachments and "Merge to file" updates now appear in the audit trail as timestamped "Photo added" / "Record updated" entries; the separate merged-records section was removed.
- Every trail entry is tappable to re-open its result, online or offline.

## Sessions & UI
- All file sessions now show an "Audited" status; the closed-session concept was removed and legacy closed records reopened.
- Install prompt: shows after login on mobile; dismissing snoozes ~5 minutes; stops once installed.
- Added a version marker in Settings (v1.1.0) to verify devices run the latest build.

## Deployment
- Production deployment of these changes is done.

Vatsal Parmar · Madhuri Badgujar
