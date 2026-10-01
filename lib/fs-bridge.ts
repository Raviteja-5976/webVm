/**
 * File manager <-> VM filesystem bridge.
 *
 * The UI only sees `VmFileSystem`. `ShellFileSystem` implements it on top of
 * any `CommandRunner` (something that can run a hidden shell script and return
 * its stdout), so it works with every emulator:
 *  - CheerpX: scripts run as a hidden process; stdout is captured through an
 *    IndexedDB-backed mount and uploads are staged through a DataDevice.
 *  - Serial/tty transports (v86): `SentinelCommandRunner` frames output with
 *    unique sentinel lines and base64-encodes it.
 *
 * Every path that reaches a shell goes through `shellQuote()`.
 */

import type { ExecResult, VmEntry, VmFileSystem } from "./emulator/types";
import { VmError } from "./emulator/types";

/* ------------------------------------------------------------------ */
/* Shell and path helpers                                              */
/* ------------------------------------------------------------------ */

/** Quote a string for POSIX sh using single quotes. Safe for any input except NUL. */
export function shellQuote(value: string): string {
  if (value.includes("\0")) throw new VmError("Path contains a NUL byte");
  if (value === "") return "''";
  if (/^[A-Za-z0-9_\/.,:@%+=-]+$/.test(value) && !value.startsWith("-")) return value;
  return "'" + value.replace(/'/g, `'\\''`) + "'";
}

/** Normalise an absolute POSIX path: collapse slashes, resolve "." and "..". */
export function normalizePath(path: string): string {
  if (!path.startsWith("/")) throw new VmError(`Expected an absolute path, got "${path}"`);
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return "/" + out.join("/");
}

export function joinPath(dir: string, name: string): string {
  if (name.includes("/")) throw new VmError(`Invalid file name "${name}"`);
  return normalizePath(`${dir}/${name}`);
}

export function dirname(path: string): string {
  const p = normalizePath(path);
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
}

export function basename(path: string): string {
  const p = normalizePath(path);
  return p.slice(p.lastIndexOf("/") + 1);
}

/** Reject names the file manager should never create. */
export function validateName(name: string): string | null {
  if (!name.trim()) return "Name cannot be empty";
  if (name === "." || name === "..") return "Invalid name";
  if (name.includes("/")) return "Name cannot contain '/'";
  if (name.includes("\0")) return "Name cannot contain NUL";
  if (new TextEncoder().encode(name).length > 255) return "Name is too long";
  return null;
}

/* ------------------------------------------------------------------ */
/* Listing                                                             */
/* ------------------------------------------------------------------ */

/**
 * `find` invocation used for listings. Records are NUL-terminated so any byte
 * (including newlines and tabs) is allowed in file names; the name is the last
 * field so embedded tabs are harmless.
 *   %y = type, %Y = type after following symlinks, %s = size, %T@ = mtime, %f = name
 */
export function listCommand(dir: string): string {
  return `find ${shellQuote(normalizePath(dir))} -mindepth 1 -maxdepth 1 -printf '%y\\t%Y\\t%s\\t%T@\\t%f\\0'`;
}

export function parseFindOutput(output: string, dir: string): VmEntry[] {
  const base = normalizePath(dir);
  const entries: VmEntry[] = [];
  for (const record of output.split("\0")) {
    if (!record) continue;
    const fields: string[] = [];
    let rest = record;
    for (let i = 0; i < 4; i++) {
      const tab = rest.indexOf("\t");
      if (tab < 0) break;
      fields.push(rest.slice(0, tab));
      rest = rest.slice(tab + 1);
    }
    if (fields.length !== 4 || !rest) continue;
    const [y, Y, size, mtime] = fields;
    const name = rest;
    const type: VmEntry["type"] = y === "d" ? "dir" : y === "l" ? "symlink" : "file";
    entries.push({
      name,
      path: base === "/" ? `/${name}` : `${base}/${name}`,
      type,
      size: Number(size) || 0,
      mtime: Math.round((Number(mtime) || 0) * 1000),
      ...(type === "symlink" ? { linkToDir: Y === "d" } : {}),
    });
  }
  return sortEntries(entries);
}

/** Directories first, then case-insensitive name order. */
export function sortEntries(entries: VmEntry[]): VmEntry[] {
  const isDir = (e: VmEntry) => e.type === "dir" || !!e.linkToDir;
  return entries.sort((a, b) => {
    if (isDir(a) !== isDir(b)) return isDir(a) ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  });
}

/* ------------------------------------------------------------------ */
/* Encoding helpers                                                    */
/* ------------------------------------------------------------------ */

const encoder = new TextEncoder();

export function toBytes(data: Uint8Array | string): Uint8Array {
  return typeof data === "string" ? encoder.encode(data) : data;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64.replace(/[^A-Za-z0-9+/=]/g, ""));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Find the last occurrence of `needle` in `haystack`. */
export function lastIndexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = haystack.length - needle.length; i >= 0; i--) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

export function randomToken(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------------------------------------------ */
/* Command runners                                                     */
/* ------------------------------------------------------------------ */

export interface StagedFile {
  /** Path inside the VM where the staged bytes can be read. */
  path: string;
  release(): Promise<void>;
}

export interface CommandRunner {
  /** Run a bash script hidden from the terminal and return its raw stdout. */
  exec(script: string): Promise<ExecResult>;
  /** Optional fast path for uploads: expose bytes as a readable file inside the VM. */
  stage?(data: Uint8Array): Promise<StagedFile>;
}

/** Byte/text stream to a shell, e.g. a serial port. */
export interface TextTransport {
  send(data: string): void;
  onData(cb: (chunk: string) => void): () => void;
}

/**
 * Runs commands over a shared text stream (a serial console or a pty) and
 * detects completion with unique sentinel lines, e.g. `__END_<id>__:<status>:`.
 * stdout and stderr are base64-encoded inside the VM so binary data survives
 * the trip. The sentinel is printed via `printf '%s%s'` from two halves, so a
 * terminal that echoes the command never shows the literal marker.
 */
export class SentinelCommandRunner implements CommandRunner {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly transport: TextTransport,
    private readonly timeoutMs = 60_000,
  ) {}

  exec(script: string): Promise<ExecResult> {
    const run = this.queue.then(() => this.execNow(script));
    this.queue = run.catch(() => undefined);
    return run;
  }

  static buildScript(id: string, script: string): string {
    const tmp = `/tmp/.sbx-${id}`;
    return [
      `printf '%s%s\\n' __BEGIN_ ${id}__`,
      `{ ( ${script}`,
      `) </dev/null 2>${tmp}.err; echo $? >${tmp}.st; } | base64`,
      `printf '%s%s:%s:' __END_ ${id}__ "$(cat ${tmp}.st)"`,
      `base64 <${tmp}.err | tr -d '\\n'`,
      `printf '\\n'`,
      `rm -f ${tmp}.err ${tmp}.st`,
      "",
    ].join("\n");
  }

  private execNow(script: string): Promise<ExecResult> {
    const id = randomToken();
    const begin = `__BEGIN_${id}__`;
    const end = `__END_${id}__:`;
    return new Promise<ExecResult>((resolve, reject) => {
      let buffer = "";
      const finish = (fn: () => void) => {
        clearTimeout(timer);
        unsubscribe();
        fn();
      };
      const timer = setTimeout(
        () => finish(() => reject(new VmError(`Command timed out after ${this.timeoutMs} ms`))),
        this.timeoutMs,
      );
      const unsubscribe = this.transport.onData((chunk) => {
        buffer += chunk;
        const b = buffer.indexOf(begin);
        if (b < 0) return;
        const e = buffer.indexOf(end, b);
        if (e < 0) return;
        const tail = buffer.slice(e + end.length);
        const m = /^(\d+):([A-Za-z0-9+/=]*)\r?\n/.exec(tail);
        if (!m) return;
        const stdoutB64 = buffer.slice(b + begin.length, e);
        finish(() =>
          resolve({
            status: Number(m[1]),
            stdout: base64ToBytes(stdoutB64),
            stderr: new TextDecoder().decode(base64ToBytes(m[2])),
          }),
        );
      });
      this.transport.send(SentinelCommandRunner.buildScript(id, script));
    });
  }
}

/* ------------------------------------------------------------------ */
/* ShellFileSystem                                                     */
/* ------------------------------------------------------------------ */

export interface ShellFileSystemOptions {
  /** Max base64 characters per upload command when the runner cannot stage files. */
  chunkChars?: number;
}

export class ShellFileSystem implements VmFileSystem {
  private readonly chunkChars: number;

  constructor(
    private readonly runner: CommandRunner,
    opts: ShellFileSystemOptions = {},
  ) {
    // Keep each command well below Linux's 128 KiB single-argument limit.
    this.chunkChars = Math.max(4, Math.floor((opts.chunkChars ?? 64 * 1024) / 4) * 4);
  }

  private async run(script: string): Promise<Uint8Array> {
    const res = await this.runner.exec(script);
    if (res.status !== 0) {
      const msg = res.stderr.trim().split("\n").filter(Boolean).pop();
      throw new VmError(msg || `Command failed with status ${res.status}`, res.status);
    }
    return res.stdout;
  }

  async list(path: string): Promise<VmEntry[]> {
    const out = await this.run(listCommand(path));
    return parseFindOutput(new TextDecoder().decode(out), path);
  }

  async read(path: string): Promise<Uint8Array> {
    return this.run(`cat -- ${shellQuote(normalizePath(path))}`);
  }

  async write(path: string, data: Uint8Array | string): Promise<void> {
    const target = shellQuote(normalizePath(path));
    const bytes = toBytes(data);

    if (this.runner.stage) {
      const staged = await this.runner.stage(bytes);
      try {
        await this.run(`cat -- ${shellQuote(staged.path)} > ${target}`);
      } finally {
        await staged.release();
      }
      return;
    }

    if (bytes.length === 0) {
      await this.run(`: > ${target}`);
      return;
    }
    // Chunked base64: each chunk is decoded independently and appended.
    const rawChunk = (this.chunkChars / 4) * 3;
    for (let offset = 0; offset < bytes.length; offset += rawChunk) {
      const b64 = bytesToBase64(bytes.subarray(offset, offset + rawChunk));
      const redirect = offset === 0 ? ">" : ">>";
      await this.run(`printf '%s' '${b64}' | base64 -d ${redirect} ${target}`);
    }
  }

  async mkdir(path: string): Promise<void> {
    await this.run(`mkdir -p -- ${shellQuote(normalizePath(path))}`);
  }

  async remove(path: string, opts: { recursive?: boolean } = {}): Promise<void> {
    const p = normalizePath(path);
    if (p === "/") throw new VmError("Refusing to delete /");
    await this.run(`rm ${opts.recursive ? "-rf" : "-f"} -- ${shellQuote(p)}`);
  }

  async rename(from: string, to: string): Promise<void> {
    const src = normalizePath(from);
    const dst = normalizePath(to);
    if (src === dst) return;
    if (dst.startsWith(src + "/")) throw new VmError("Cannot move a folder into itself");
    const q = shellQuote(dst);
    await this.run(
      `if [ -e ${q} ] || [ -L ${q} ]; then printf '%s already exists\\n' ${shellQuote(basename(dst))} >&2; exit 17; fi\n` +
        `mv -T -- ${shellQuote(src)} ${q}`,
    );
  }

  async archive(path: string): Promise<Uint8Array> {
    const p = normalizePath(path);
    return this.run(`tar -czf - -C ${shellQuote(dirname(p))} -- ${shellQuote(basename(p))}`);
  }
}

/** Parse a sentinel-terminated capture: `<stdout>\n__END_<id>__:<status>\n`. */
export function splitSentinelCapture(
  data: Uint8Array,
  id: string,
): { stdout: Uint8Array; status: number } | null {
  const marker = encoder.encode(`\n__END_${id}__:`);
  const at = lastIndexOfBytes(data, marker);
  if (at < 0) return null;
  const tail = new TextDecoder().decode(data.subarray(at + marker.length));
  const m = /^(\d+)\n?$/.exec(tail);
  if (!m) return null;
  return { stdout: data.slice(0, at), status: Number(m[1]) };
}
