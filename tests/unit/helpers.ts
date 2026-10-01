import { spawn, spawnSync } from "node:child_process";
import type { CommandRunner, TextTransport } from "@/lib/fs-bridge";
import type { ExecResult } from "@/lib/emulator/types";

/** Real bash (Git Bash on Windows, /bin/bash elsewhere). Override with SANDBOX_TEST_BASH. */
export const BASH = process.env.SANDBOX_TEST_BASH || "bash";

export function bash(script: string) {
  return spawnSync(BASH, ["-c", script], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
}

export function bashAvailable(): boolean {
  const r = spawnSync(BASH, ["-c", "find --version >/dev/null && base64 --version >/dev/null"], { stdio: "ignore" });
  return r.status === 0;
}

/** CommandRunner that runs each script in a fresh local bash. Binary-safe, no stage() -> base64 upload path. */
export class LocalBashRunner implements CommandRunner {
  scripts: string[] = [];
  async exec(script: string): Promise<ExecResult> {
    this.scripts.push(script);
    const r = bash(script);
    return { status: r.status ?? 1, stdout: new Uint8Array(r.stdout), stderr: r.stderr.toString("utf8") };
  }
}

/** A long-lived bash process behind a TextTransport, like a serial console. */
export function bashTransport(): TextTransport & { close(): void } {
  const child = spawn(BASH, ["--norc", "--noprofile"], { stdio: ["pipe", "pipe", "pipe"] });
  const listeners = new Set<(chunk: string) => void>();
  child.stdout.setEncoding("latin1");
  child.stdout.on("data", (chunk: string) => listeners.forEach((l) => l(chunk)));
  // Noise a real console would show; the runner must ignore it.
  child.stderr.on("data", () => undefined);
  return {
    send: (data) => child.stdin.write(data),
    onData: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    close: () => child.kill(),
  };
}

export function makeTempDir(): string {
  const r = bash("mktemp -d");
  if (r.status !== 0) throw new Error("mktemp failed");
  return r.stdout.toString("utf8").trim();
}
