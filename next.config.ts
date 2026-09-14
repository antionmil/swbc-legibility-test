import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  /* `next build` and `next dev` both write to .next. Running a build while the
     dev server is up corrupts its state and takes the dev server down - which
     is exactly what kept killing localhost:3111. Builds now use their own
     directory so a verification build can never disturb a running dev server. */
  distDir: process.env.NEXT_DIST_DIR || ".next",
};
export default nextConfig;
