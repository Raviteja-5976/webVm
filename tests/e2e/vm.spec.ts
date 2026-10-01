import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { databaseNames, expectTerminal, fileRow, run, sessionId, terminalText, waitForRunning } from "./helpers";

const BOOT_TIMEOUT = 180_000;

async function bootSeconds(page: Page): Promise<number> {
  const text = (await page.getByTestId("boot-time").innerText()).replace(/[^\d.]/g, "");
  return Number(text);
}

test("real Linux VM: full acceptance flow", async ({ page }, testInfo) => {
  // ---- Launch (cold: fresh browser profile, empty HTTP cache) ----
  await page.goto("/");
  expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);
  await page.getByText("Linux basics").click();
  await page.getByTestId("launch").click();
  await expect(page.getByTestId("boot-overlay")).toBeVisible();
  await waitForRunning(page, BOOT_TIMEOUT);
  const cold = await bootSeconds(page);
  const firstId = await sessionId(page);

  // ---- Terminal basics ----
  await expectTerminal(page, "user@sandbox", 30_000);
  await run(page, "clear; echo hi");
  await expectTerminal(page, /(^|\n)hi\n/);

  // Tools a learner needs.
  await run(page, "clear; for t in bash git python3 grep sed awk nano vim tar; do command -v $t >/dev/null && echo ok:$t || echo MISSING:$t; done");
  await expectTerminal(page, "ok:tar");
  expect(await terminalText(page)).not.toContain("MISSING:");

  // Preset files are added in the background after the prompt appears.
  await expect(page.getByTestId("workspace-preparing")).toHaveCount(0, { timeout: 120_000 });
  await run(page, "clear; ls ~/practice");
  await expectTerminal(page, "fruits.txt");

  // ---- Resize reaches the tty ----
  await run(page, "clear; stty size");
  const SIZE = /(?:^|\n)(\d+ \d+)\n/;
  await expectTerminal(page, SIZE);
  const before = SIZE.exec(await terminalText(page))![1];
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.waitForTimeout(500);
  await run(page, "clear; stty size");
  await expect.poll(async () => SIZE.exec(await terminalText(page))?.[1]).not.toBe(before);
  await page.setViewportSize({ width: 1400, height: 900 });

  // ---- File manager <-> terminal ----
  // Upload binary data and verify it byte for byte inside the VM.
  const payload = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 37 + 11) & 0xff));
  const md5 = createHash("md5").update(payload).digest("hex");
  await page.getByTestId("upload-input").setInputFiles({ name: "upload.bin", mimeType: "application/octet-stream", buffer: payload });
  await expect(fileRow(page, "/home/user/upload.bin")).toBeVisible({ timeout: 30_000 });
  await run(page, "clear; md5sum upload.bin");
  await expectTerminal(page, `${md5}  upload.bin`);

  // Created in the terminal -> appears in the panel.
  await run(page, "echo from-terminal > term.txt");
  await expect(fileRow(page, "/home/user/term.txt")).toBeVisible({ timeout: 15_000 });

  // Created and edited in the panel -> readable in the terminal.
  await page.getByRole("button", { name: "New file" }).click();
  await page.getByLabel(/In \/home\/user/).fill("panel.txt");
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByTestId("editor").fill("written from the panel ✓");
  await page.keyboard.press("Control+s");
  await expect(page.getByText("Saved")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Close" }).click();
  await run(page, "clear; cat panel.txt");
  await expectTerminal(page, "written from the panel ✓");

  // Rename in the panel.
  await fileRow(page, "/home/user/term.txt").hover();
  await page.getByRole("button", { name: "Rename term.txt" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("renamed.txt");
  await page.getByRole("button", { name: "Rename" }).click();
  await expect(fileRow(page, "/home/user/renamed.txt")).toBeVisible({ timeout: 15_000 });
  await run(page, "clear; cat renamed.txt");
  await expectTerminal(page, "from-terminal");

  // Download from the panel.
  await fileRow(page, "/home/user/panel.txt").hover();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download panel.txt" }).click(),
  ]);
  const chunks: Buffer[] = [];
  for await (const chunk of (await download.createReadStream())!) chunks.push(chunk as Buffer);
  expect(Buffer.concat(chunks).toString("utf8")).toBe("written from the panel ✓");

  // Delete in the panel -> gone in the terminal; delete in the terminal -> gone in the panel.
  await fileRow(page, "/home/user/upload.bin").hover();
  await page.getByRole("button", { name: "Delete upload.bin" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(fileRow(page, "/home/user/upload.bin")).toHaveCount(0, { timeout: 15_000 });
  await run(page, "clear; ls upload.bin");
  await expectTerminal(page, "No such file or directory");
  await run(page, "rm renamed.txt");
  await expect(fileRow(page, "/home/user/renamed.txt")).toHaveCount(0, { timeout: 15_000 });

  // ---- Lesson: run a step, then the hidden task check ----
  await page.getByRole("tab", { name: "Lessons" }).click();
  await expect(page.getByRole("heading", { name: "Navigating the filesystem" })).toBeVisible();
  await page.getByRole("button", { name: /Run in sandbox: mkdir -p ~\/projects/ }).click();
  await page.waitForTimeout(1500);
  await page.getByTestId("check-task").click();
  await expect(page.getByText("Done. Nice work.")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: "Files" }).click();

  // ---- Stop destroys the session and its IndexedDB data ----
  expect((await databaseNames(page)).filter((n) => n.includes(firstId)).length).toBeGreaterThan(0);
  await page.getByTestId("stop").click();
  await expect(page.getByTestId("boot-overlay")).toHaveAttribute("data-status", "stopped", { timeout: 30_000 });
  await expect.poll(async () => (await databaseNames(page)).filter((n) => n.includes(firstId))).toEqual([]);

  // ---- Relaunch (warm: blocks come from the HTTP cache) is pristine ----
  await page.getByTestId("relaunch").click();
  await waitForRunning(page, BOOT_TIMEOUT);
  const warm = await bootSeconds(page);
  expect(await sessionId(page)).not.toBe(firstId);
  await expectTerminal(page, "user@sandbox", 30_000);
  await run(page, "clear; ls panel.txt projects");
  await expectTerminal(page, "cannot access 'panel.txt'");
  await expectTerminal(page, "cannot access 'projects'");
  await expect(fileRow(page, "/home/user/panel.txt")).toHaveCount(0);

  testInfo.annotations.push({ type: "boot-time", description: `cold ${cold}s, warm ${warm}s` });
  console.log(`[timing] time to first prompt: cold ${cold}s, warm ${warm}s`);
  expect(warm).toBeLessThan(cold);
});
