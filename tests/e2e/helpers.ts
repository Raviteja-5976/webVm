import { expect, type Page } from "@playwright/test";

/** Visible terminal text (xterm DOM renderer). */
export async function terminalText(page: Page): Promise<string> {
  const text = await page.locator(".xterm-rows").innerText();
  return text.replace(/ /g, " ");
}

export async function expectTerminal(page: Page, needle: string | RegExp, timeout = 30_000) {
  await expect
    .poll(async () => {
      const text = await terminalText(page);
      return typeof needle === "string" ? text.includes(needle) : needle.test(text);
    }, { timeout, message: `terminal should show ${needle}` })
    .toBe(true);
}

/** Type a command at the prompt and press Enter. */
export async function run(page: Page, command: string) {
  await page.locator(".xterm").click();
  await page.keyboard.type(command, { delay: 5 });
  await page.keyboard.press("Enter");
}

export async function waitForRunning(page: Page, timeout: number) {
  await expect(page.getByTestId("status-pill")).toHaveAttribute("data-status", "running", { timeout });
}

export async function databaseNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? ""));
}

export async function sessionId(page: Page): Promise<string> {
  const title = await page.getByTestId("session-id").getAttribute("title");
  const m = /Session ([0-9a-f-]{36})/.exec(title ?? "");
  if (!m) throw new Error(`no session id in "${title}"`);
  return m[1];
}

export function fileRow(page: Page, path: string) {
  return page.locator(`[data-testid="file-row"][data-path="${path}"]`);
}
