import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Auth-gated app: don't reuse the client Router Cache between navigations,
    // so every route change re-runs middleware and re-fetches fresh. Prevents
    // the "navigate to a protected page shows a stale login-redirect until you
    // reload" class of bugs.
    staleTimes: { dynamic: 0, static: 30 },
  },
};

export default nextConfig;
