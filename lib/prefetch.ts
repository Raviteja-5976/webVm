import { CHEERPX_URL, IMAGE_TYPE, IMAGE_URL, type EngineId } from "./config";
import bootManifest from "./boot-manifest.json";

let imageWarmed = false;

/**
 * Start fetching the first block of the disk image so it is in the HTTP cache
 * by the time the VM asks for it. Best effort; failures are ignored.
 */
export function prefetchImageHead() {
  if (imageWarmed || typeof fetch !== "function" || prefetchDisabled()) return;
  imageWarmed = true;
  const url = IMAGE_URL.replace(/^wss:/, "https:");
  if (!url.startsWith("http")) return;
  const request =
    IMAGE_TYPE === "bytes"
      ? fetch(url, { mode: "cors", headers: { Range: "bytes=0-131071" } })
      : IMAGE_TYPE === "cloud"
        ? fetch(`${url}?s=0&e=131071`, { mode: "cors" }) // CloudDevice's https chunk format
        : null;
  request?.then((r) => r.arrayBuffer()).catch(() => undefined);
}

/* ------------------------------------------------------------------ */

const CONCURRENCY = 16;
const queued = new Set<string>();
const queue: string[] = [];
let workers = 0;

/**
 * A cold boot needs ~120 disk chunks that CheerpX fetches one at a time
 * (~300 ms each), plus whatever the preset's workspace script touches (git,
 * for example). Those sets are fixed for a given image, so fetch them in
 * parallel as soon as the visitor shows intent to launch: CheerpX's own
 * requests then hit the HTTP cache or join the in-flight fetch.
 * Measured: cold click-to-prompt ~40 s -> ~9 s.
 *
 * The manifest is recorded by scripts/record-boot-manifest.mjs and ignored
 * when it doesn't match the configured image. `?noprefetch` disables this
 * (used when recording and for measuring unassisted boots).
 */
export function prefetchBootBlocks(presetId?: string) {
  const url = IMAGE_URL.replace(/^wss:/, "https:");
  if (IMAGE_TYPE !== "cloud" || bootManifest.imageUrl !== url || typeof fetch !== "function" || prefetchDisabled()) {
    return;
  }
  const extra = (bootManifest.presets as Record<string, string[] | undefined>)[presetId ?? ""] ?? [];
  for (const suffix of [...bootManifest.base, ...extra]) {
    const chunk = url + suffix;
    if (queued.has(chunk)) continue;
    queued.add(chunk);
    queue.push(chunk);
  }
  while (workers < CONCURRENCY && queue.length) {
    workers++;
    void drain().finally(() => workers--);
  }
}

async function drain() {
  for (let next = queue.shift(); next; next = queue.shift()) {
    try {
      // Low priority: the engine files CheerpX loads meanwhile are on the critical path.
      await (await fetch(next, { mode: "cors", priority: "low" })).arrayBuffer();
    } catch {
      /* best effort */
    }
  }
}

function prefetchDisabled() {
  return typeof location !== "undefined" && new URLSearchParams(location.search).has("noprefetch");
}

/** Load (and cache) the emulator module and start the boot prefetch, e.g. on hover over Launch. */
export async function prewarmEngine(engine: EngineId, presetId?: string) {
  if (engine !== "cheerpx") return;
  prefetchBootBlocks(presetId);
  const { loadCheerpX } = await import("./emulator/cheerpx-loader");
  await loadCheerpX().catch(() => undefined);
}

export { CHEERPX_URL };
