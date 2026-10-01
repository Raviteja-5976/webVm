/**
 * Central configuration. Everything that differs between deployments is
 * read from NEXT_PUBLIC_* env vars so a static export can be re-pointed at a
 * different disk image without code changes.
 */

export type EngineId = "cheerpx" | "v86" | "mock";
export type ImageType = "cloud" | "bytes" | "github";

/** Pinned CheerpX build. Keep in sync with the exact version of @leaningtech/cheerpx in package.json (used for types). */
export const CHEERPX_VERSION = "1.3.9";
export const CHEERPX_URL = `https://cxrtnc.leaningtech.com/${CHEERPX_VERSION}/cx.esm.js`;

/**
 * Root filesystem image. The default is the public WebVM Debian image, which is
 * fine for evaluation. For your own deployment, build the image in /image and
 * point NEXT_PUBLIC_IMAGE_URL at your CDN copy (https://…/rootfs-v1.ext2).
 *
 * https:// is used instead of wss:// on purpose: the https transport fetches
 * blocks as plain cacheable GETs, so the browser HTTP cache makes warm launches
 * fast (measured ~3s vs ~25s cold) while the per-session overlay stays empty.
 */
export const DEFAULT_IMAGE_URL =
  "https://disks.webvm.io/debian_buster_large_permis_fixed_01-06-2026.ext2";
const DEFAULT_IMAGE_TYPE: ImageType = "cloud";

export const IMAGE_URL = process.env.NEXT_PUBLIC_IMAGE_URL || DEFAULT_IMAGE_URL;

/** "cloud" = WebVM-style streaming (wss:// or https://), "bytes" = any server with HTTP range requests, "github" = GitHub release chunks. */
export const IMAGE_TYPE: ImageType =
  (process.env.NEXT_PUBLIC_IMAGE_TYPE as ImageType | undefined) ||
  (process.env.NEXT_PUBLIC_IMAGE_URL ? "bytes" : DEFAULT_IMAGE_TYPE);

export const DEFAULT_ENGINE: EngineId =
  (process.env.NEXT_PUBLIC_EMULATOR as EngineId | undefined) || "cheerpx";

/** v86 fallback assets (optional). See lib/emulator/v86-adapter.ts. */
export const V86_ASSETS_URL = process.env.NEXT_PUBLIC_V86_ASSETS_URL || "";

/** Auto-stop after this long without keyboard/mouse input. 0 disables. */
export const IDLE_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES ?? 30) * 60_000;

/** Optional endpoint that receives analytics beacons (JSON). */
export const ANALYTICS_URL = process.env.NEXT_PUBLIC_ANALYTICS_URL || "";

/** The unprivileged account that owns the shell and the file manager. */
export const VM_USER = {
  name: "user",
  home: "/home/user",
  uid: 1000,
  gid: 1000,
} as const;

export const SHELL_ENV = [
  `HOME=${VM_USER.home}`,
  "TERM=xterm-256color",
  `USER=${VM_USER.name}`,
  `LOGNAME=${VM_USER.name}`,
  "SHELL=/bin/bash",
  "EDITOR=nano",
  "LANG=C.UTF-8",
  "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
];

/** Prefix of every IndexedDB database a session creates. Used by orphan cleanup. */
export const SESSION_DB_PREFIX = "sandbox-";

/** Files larger than this are not opened in the text editor. */
export const EDITOR_MAX_BYTES = 1024 * 1024;
