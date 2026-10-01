import type { NextConfig } from "next";

/**
 * Cross-origin isolation is required for SharedArrayBuffer, which the
 * emulator needs. `headers()` covers `next dev` / `next start` / Vercel.
 * With STATIC_EXPORT=1 the same headers must come from the host instead:
 * see vercel.json and public/_headers (Netlify / Cloudflare Pages).
 */
const isolationHeaders = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
];

const staticExport = process.env.STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  ...(staticExport
    ? { output: "export" as const, images: { unoptimized: true } }
    : {
        async headers() {
          return [{ source: "/(.*)", headers: isolationHeaders }];
        },
      }),
};

export default nextConfig;
