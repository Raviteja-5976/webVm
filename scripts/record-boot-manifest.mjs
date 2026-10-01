#!/usr/bin/env node
/**
 * Record which disk-image chunks a cold boot needs, so the app can fetch them
 * in parallel when the visitor shows intent to launch (see lib/prefetch.ts).
 * A cold boot otherwise fetches ~120 chunks one after another.
 *
 * Output (lib/boot-manifest.json):
 *   base:    chunks for booting to a prompt and the first file listing
 *   presets: extra chunks each preset's workspace script needs (e.g. git)
 *
 *   npm run build && npx next start -p 3100 &
 *   node scripts/record-boot-manifest.mjs [http://localhost:3100]
 *
 * Re-run whenever NEXT_PUBLIC_IMAGE_URL or a preset script changes. Only
 * "cloud" images (CheerpX CloudDevice over https) are supported: their chunk
 * requests are plain URLs, which the HTTP cache can share with prefetches.
 */
import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3100";
const PRESETS = ["blank", "linux-basics", "git-playground", "bash-scripting"];

async function record(browser, preset) {
  const context = await browser.newContext(); // empty HTTP cache = cold boot
  const page = await context.newPage();
  await page.goto(`${base}/sandbox?preset=${preset}&noprefetch=1`); // record what the VM itself asks for
  await page.locator('[data-testid="status-pill"][data-status="running"]').waitFor({ timeout: 240_000 });
  await page.locator('[data-testid="workspace-preparing"]').waitFor({ state: "detached", timeout: 240_000 });
  await page.waitForTimeout(6000); // first file-manager listings
  const result = await page.evaluate(() => {
    const names = performance.getEntriesByType("resource").map((e) => e.name);
    const chunk = names.find((n) => /\?s=\d+&e=\d+$/.test(n));
    if (!chunk) return null;
    const imageUrl = chunk.slice(0, chunk.indexOf("?"));
    return { imageUrl, chunks: [...new Set(names.filter((n) => n.startsWith(imageUrl + "?s=")).map((n) => n.slice(imageUrl.length)))] };
  });
  await context.close();
  if (!result) throw new Error("No CloudDevice chunk requests seen; is the image type 'cloud' over https?");
  console.log(`${preset}: ${result.chunks.length} chunks`);
  return result;
}

const browser = await chromium.launch();
const runs = {};
for (const preset of PRESETS) runs[preset] = await record(browser, preset);
await browser.close();

const baseSet = new Set(runs.blank.chunks);
const manifest = {
  imageUrl: runs.blank.imageUrl,
  recordedAt: new Date().toISOString().slice(0, 10),
  base: runs.blank.chunks,
  presets: Object.fromEntries(
    PRESETS.filter((p) => p !== "blank").map((p) => [p, runs[p].chunks.filter((c) => !baseSet.has(c))]),
  ),
};
writeFileSync(new URL("../lib/boot-manifest.json", import.meta.url), JSON.stringify(manifest, null, 1) + "\n");
console.log(`Wrote lib/boot-manifest.json for ${manifest.imageUrl}`);
