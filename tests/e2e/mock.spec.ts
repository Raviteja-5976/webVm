import { expect, test } from "@playwright/test";
import { databaseNames, expectTerminal, fileRow, run, sessionId, waitForRunning } from "./helpers";

test("landing page is cross-origin isolated and passes the capability check", async ({ page }) => {
  await page.goto("/?engine=mock");
  expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);
  await expect(page.getByTestId("capabilities").locator(".text-danger")).toHaveCount(0);
  await expect(page.getByTestId("launch")).toBeEnabled();
});

test("launch, use terminal and file manager, stop, relaunch pristine", async ({ page }) => {
  await page.goto("/?engine=mock");
  await page.getByText("Blank Debian").click();
  await page.getByTestId("launch").click();
  await page.waitForURL(/\/sandbox\?/);
  await waitForRunning(page, 20_000);

  await run(page, "echo hi");
  await expectTerminal(page, /(^|\n)hi\n/);

  // Create a file in the panel, edit it, and read it from the terminal.
  await page.getByRole("button", { name: "New file" }).click();
  await page.getByLabel(/In \/home\/user/).fill("panel.txt");
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByTestId("editor").fill("written from the panel");
  await page.keyboard.press("Control+s");
  await expect(page.getByText("Saved")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await run(page, "cat panel.txt");
  await expectTerminal(page, "written from the panel");

  // A file created in the terminal shows up in the panel after the command settles.
  await run(page, "echo from-terminal > term.txt");
  await expect(fileRow(page, "/home/user/term.txt")).toBeVisible({ timeout: 5_000 });

  // Upload via the file input.
  await page.getByTestId("upload-input").setInputFiles({ name: "upload.txt", mimeType: "text/plain", buffer: Buffer.from("uploaded!") });
  await expect(fileRow(page, "/home/user/upload.txt")).toBeVisible();
  await run(page, "cat upload.txt");
  await expectTerminal(page, "uploaded!");

  // Delete from the panel, confirm it is gone in the terminal.
  await fileRow(page, "/home/user/upload.txt").hover();
  await page.getByRole("button", { name: "Delete upload.txt" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(fileRow(page, "/home/user/upload.txt")).toHaveCount(0);

  // Stop destroys the session database.
  const id = await sessionId(page);
  expect((await databaseNames(page)).some((n) => n.includes(id))).toBe(true);
  await page.getByTestId("stop").click();
  await expect(page.getByTestId("boot-overlay")).toHaveAttribute("data-status", "stopped");
  await expect.poll(async () => (await databaseNames(page)).some((n) => n.includes(id))).toBe(false);

  // Relaunch: a new session from the pristine image.
  await page.getByTestId("relaunch").click();
  await waitForRunning(page, 20_000);
  expect(await sessionId(page)).not.toBe(id);
  await run(page, "ls");
  await expectTerminal(page, "welcome.txt");
  await expect(fileRow(page, "/home/user/panel.txt")).toHaveCount(0);
  await expect(fileRow(page, "/home/user/term.txt")).toHaveCount(0);
});

test("orphaned session databases are cleaned up on load", async ({ page }) => {
  await page.goto("/?engine=mock");
  const orphan = "sandbox-00000000-0000-4000-8000-000000000000";
  await page.evaluate(
    (name) =>
      new Promise<void>((resolve) => {
        const req = indexedDB.open(name, 1);
        req.onsuccess = () => {
          req.result.close();
          resolve();
        };
      }),
    orphan,
  );
  expect(await databaseNames(page)).toContain(orphan);
  await page.reload();
  await expect.poll(() => databaseNames(page)).not.toContain(orphan);
});

test("unsupported browsers get a clear explanation", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, "crossOriginIsolated", { value: false }));
  await page.goto("/sandbox?preset=blank");
  await expect(page.getByTestId("unsupported")).toContainText("Cross-origin isolation");
});
