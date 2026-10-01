import type { BlockDevice, DataDevice, Device, IDBDevice, Linux } from "@leaningtech/cheerpx";
import {
  CHEERPX_VERSION,
  SESSION_DB_PREFIX,
  SHELL_ENV,
  VM_USER,
  type ImageType,
} from "../config";
import {
  ShellFileSystem,
  randomToken,
  splitSentinelCapture,
  type CommandRunner,
  type StagedFile,
} from "../fs-bridge";
import { loadCheerpX, type CheerpXModule } from "./cheerpx-loader";
import { OutputHub, sleep } from "./output-hub";
import {
  VmError,
  type AdapterOptions,
  type EmulatorAdapter,
  type ExecResult,
  type StartOptions,
  type VmFileSystem,
} from "./types";

/** JS -> VM: in-memory DataDevice, read-only inside the VM. */
const INBOX = "/.sbx-in";
/** VM -> JS: IndexedDB-backed directory that JS reads with readFileAsBlob(). */
const OUTBOX = "/.sbx-out";

/** CheerpX stores an IDBDevice named `x` in the IndexedDB database `cjFS_/x/`. */
export const cheerpxDatabaseName = (device: string) => `cjFS_/${device}/`;

/** Mount types accepted at runtime (the published typings list only a subset). */
type Mount =
  | { type: "ext2" | "dir"; path: string; dev: Device }
  | { type: "devs" | "devpts" | "proc" | "sys"; path: string };

export interface CheerpXAdapterOptions extends AdapterOptions {
  imageUrl: string;
  imageType: ImageType;
}

export class CheerpXAdapter implements EmulatorAdapter, CommandRunner {
  readonly name = `CheerpX ${CHEERPX_VERSION}`;
  readonly fs: VmFileSystem;

  private cx: Linux | null = null;
  private devices: Device[] = [];
  private inbox: DataDevice | null = null;
  private outbox: IDBDevice | null = null;
  private overlayIdb: IDBDevice | null = null;
  private sendKey: ((keyCode: number) => void) | null = null;
  private readonly output = new OutputHub();
  private readonly encoder = new TextEncoder();
  private execQueue: Promise<unknown> = Promise.resolve();
  private cols = 80;
  private rows = 24;
  private destroyed = false;
  /** Environment of the interactive shell (hidden execs use plain SHELL_ENV). */
  private shellEnv: string[] = SHELL_ENV;
  /** Settles when the Linux instance exists (or never will); exec() waits on it. */
  private readonly markVmReady = deferred();
  private readonly vmReady = this.markVmReady.promise;

  constructor(private readonly opts: CheerpXAdapterOptions) {
    this.fs = new ShellFileSystem(this);
  }

  private get overlayName() {
    return `${SESSION_DB_PREFIX}${this.opts.sessionId}`;
  }
  private get bridgeName() {
    return `${SESSION_DB_PREFIX}${this.opts.sessionId}-bridge`;
  }

  /** IndexedDB databases owned by this session. */
  storageNames(): string[] {
    return [cheerpxDatabaseName(this.overlayName), cheerpxDatabaseName(this.bridgeName)];
  }

  async start({ cols, rows, onProgress, shellRc }: StartOptions): Promise<void> {
    this.cols = cols;
    this.rows = rows;
    let phase = "";
    let percent: number | undefined;
    let detail: string | undefined;
    const report = () => onProgress?.({ phase, percent, ...(detail ? { detail } : {}) });
    const progress = (p: string, pct?: number) => {
      phase = p;
      percent = pct;
      report();
    };

    progress("Loading engine", 5);
    const CX = await loadCheerpX();
    this.throwIfDestroyed();

    progress("Connecting to disk image", 15);
    // Disk streaming is the slow part of a cold boot; show that it is moving.
    const stopMeter = this.meterDownloads((blocks) => {
      detail = `${blocks} disk blocks`;
      report();
    });
    try {
      const base = this.track(await createBaseDevice(CX, this.opts.imageUrl, this.opts.imageType));
      // Per-session copy-on-write layer: the base image is never modified.
      const overlayIdb = this.track(await CX.IDBDevice.create(this.overlayName));
      this.overlayIdb = overlayIdb;
      const overlay = this.track(await CX.OverlayDevice.create(base, overlayIdb));
      this.inbox = this.track(await CX.DataDevice.create());
      this.outbox = this.track(await CX.IDBDevice.create(this.bridgeName));
      this.throwIfDestroyed();

      progress("Booting Linux", 35);
      const mounts: Mount[] = [
        { type: "ext2", path: "/", dev: overlay },
        { type: "dir", path: INBOX, dev: this.inbox },
        { type: "dir", path: OUTBOX, dev: this.outbox },
        { type: "devs", path: "/dev" },
        { type: "devpts", path: "/dev/pts" },
        { type: "proc", path: "/proc" },
        { type: "sys", path: "/sys" },
      ];
      const cx = await CX.Linux.create({ mounts: mounts as never });
      if (this.destroyed) {
        cx.delete(); // stopped while booting
        this.throwIfDestroyed();
      }
      this.cx = cx;
      this.markVmReady.resolve();
      this.sendKey = cx.setCustomConsole(this.handleConsole, this.cols, this.rows);

      // The rc is handed over through the DataDevice (no VM process needed) and
      // sourced by bash via PROMPT_COMMAND right before its first prompt.
      if (shellRc) {
        await this.inbox.writeFile("/sandboxrc", shellRc);
        this.shellEnv = [...SHELL_ENV, `PROMPT_COMMAND=. ${INBOX}/sandboxrc`];
      }

      progress("Starting shell", 60);
      const firstOutput = this.output.waitForFirst(90_000);
      void this.shellLoop();
      await firstOutput;
      this.throwIfDestroyed();
      progress("Ready", 100);
    } finally {
      stopMeter();
    }
  }

  write(data: string): void {
    const send = this.sendKey;
    if (!send) return;
    // The console takes one byte at a time; UTF-8 encode so non-ASCII input works.
    for (const byte of this.encoder.encode(data)) send(byte);
  }

  onOutput(cb: (data: string | Uint8Array) => void): () => void {
    return this.output.subscribe(cb);
  }

  resize(cols: number, rows: number): void {
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    // Re-registering the console with new dimensions updates the tty size (verified with `stty size`).
    if (this.cx) this.sendKey = this.cx.setCustomConsole(this.handleConsole, cols, rows);
  }

  /** May be called while booting: the command waits until the VM exists. */
  exec(script: string): Promise<ExecResult> {
    const run = this.execQueue.then(() => this.vmReady).then(() => this.execNow(script));
    this.execQueue = run.catch(() => undefined);
    return run;
  }

  async stage(data: Uint8Array): Promise<StagedFile> {
    const inbox = this.inbox;
    if (!inbox) throw new VmError("VM is not running");
    const name = `/upload-${randomToken()}`;
    // Runtime accepts Uint8Array (documented), the typings only list string.
    await (inbox.writeFile as (p: string, d: string | Uint8Array) => Promise<void>)(name, data);
    return {
      path: INBOX + name,
      release: async () => {
        try {
          await inbox.writeFile(name, ""); // free the memory; DataDevice has no unlink
        } catch {
          /* VM may already be gone */
        }
      },
    };
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.markVmReady.reject(new VmError("Session was stopped")); // fail queued commands
    this.sendKey = null;
    // Wipe the session layers first. This destroys user data even if the
    // database files outlive the page, and flushes CheerpX's pending IndexedDB
    // work so the connections can be closed cleanly for deleteDatabase().
    const layers = [this.overlayIdb, this.outbox].filter((d): d is IDBDevice => !!d);
    if (layers.length) {
      await Promise.race([Promise.allSettled(layers.map((d) => d.reset())), sleep(3000)]);
    }
    try {
      this.cx?.delete();
    } catch (e) {
      console.warn("[sandbox] Linux.delete failed", e);
    }
    this.cx = null;
    for (const dev of this.devices.reverse()) {
      try {
        dev.delete();
      } catch {
        /* already released */
      }
    }
    this.devices = [];
    this.inbox = null;
    this.outbox = null;
    this.overlayIdb = null;
    this.output.clear();
    await sleep(300); // let the engine settle before the session deletes its databases
  }

  /* ---------------------------------------------------------------- */

  private handleConsole = (buf: Uint8Array, vt: number) => {
    if (vt !== 1) return;
    this.output.emit(new Uint8Array(buf)); // copy: the engine may reuse its buffer
  };

  private async shellLoop() {
    while (!this.destroyed && this.cx) {
      try {
        await this.cx.run("/bin/bash", ["--login"], { ...this.runOptions(), env: this.shellEnv });
      } catch (e) {
        if (this.destroyed) return;
        this.output.emit(`\r\n\x1b[31m[shell error: ${String(e)}]\x1b[0m\r\n`);
        await sleep(1000);
      }
      if (this.destroyed) return;
      this.output.emit("\r\n\x1b[2m[shell exited, starting a new one]\x1b[0m\r\n");
    }
  }

  private runOptions() {
    return { env: SHELL_ENV, cwd: VM_USER.home, uid: VM_USER.uid, gid: VM_USER.gid };
  }

  /**
   * Hidden command: stdout/stderr go to files on the IndexedDB-backed OUTBOX
   * mount, followed by a unique sentinel line carrying the exit status. The
   * script runs in a subshell so an `exit` inside it cannot skip the sentinel.
   * Calls are serialised, so fixed file names are safe (`>` truncates them)
   * and the sentinel id guarantees a stale file is never mistaken for output.
   */
  private async execNow(script: string): Promise<ExecResult> {
    const cx = this.cx;
    const outbox = this.outbox;
    if (!cx || !outbox) throw new VmError("VM is not running");
    const id = randomToken();
    const wrapped =
      `( ${script}\n) </dev/null >${OUTBOX}/out 2>${OUTBOX}/err\n` +
      `printf '\\n__END_${id}__:%d\\n' $? >>${OUTBOX}/out\n`;

    const res = await cx.run("/bin/bash", ["-c", wrapped], this.runOptions());
    let capture: ReturnType<typeof splitSentinelCapture> = null;
    for (let attempt = 0; attempt < 5 && !capture; attempt++) {
      if (attempt) await sleep(40 * attempt);
      try {
        const blob = await outbox.readFileAsBlob("/out");
        capture = splitSentinelCapture(new Uint8Array(await blob.arrayBuffer()), id);
      } catch {
        /* not visible yet */
      }
    }
    if (!capture) throw new VmError(`Hidden command produced no result (status ${res.status})`);

    let stderr = "";
    if (capture.status !== 0) {
      try {
        stderr = await (await outbox.readFileAsBlob("/err")).text();
      } catch {
        /* ignore */
      }
    }
    return { status: capture.status, stdout: capture.stdout, stderr };
  }

  private track<T extends Device>(dev: T): T {
    if (this.destroyed) {
      dev.delete(); // stopped while booting: don't leak devices created after destroy()
      this.throwIfDestroyed();
    }
    this.devices.push(dev);
    return dev;
  }

  private throwIfDestroyed() {
    if (this.destroyed) throw new VmError("Session was stopped");
  }

  /**
   * Count disk-image block requests (Resource Timing) for the boot screen.
   * Byte counts are not available: the CDN sends no Timing-Allow-Origin, so
   * the browser reports cross-origin sizes as 0.
   */
  private meterDownloads(report: (blocks: number) => void): () => void {
    if (typeof PerformanceObserver === "undefined") return () => {};
    const prefix = this.opts.imageUrl.replace(/^wss:/, "https:");
    let requests = 0;
    const observer = new PerformanceObserver((list) => {
      const before = requests;
      for (const entry of list.getEntries()) if (entry.name.startsWith(prefix)) requests++;
      if (requests !== before) report(requests);
    });
    try {
      observer.observe({ type: "resource" });
    } catch {
      return () => {};
    }
    return () => observer.disconnect();
  }
}

async function createBaseDevice(
  CX: CheerpXModule,
  url: string,
  type: ImageType,
): Promise<BlockDevice> {
  switch (type) {
    case "bytes":
      return CX.HttpBytesDevice.create(url);
    case "github":
      return CX.GitHubDevice.create(url);
    case "cloud":
    default:
      try {
        return await CX.CloudDevice.create(url);
      } catch (e) {
        // Same recovery as WebVM: if the WebSocket transport fails, use HTTPS.
        if (url.startsWith("wss:")) return CX.CloudDevice.create("https:" + url.slice(4));
        throw e;
      }
  }
}


function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => undefined); // rejection is observed through exec()
  return { promise, resolve, reject };
}
