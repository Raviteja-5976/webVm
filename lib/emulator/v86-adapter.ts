/**
 * Experimental v86 fallback (fully open source, BSD-2). Slower than CheerpX.
 *
 * Guest image requirements (e.g. a Buildroot or Alpine bzImage with initramfs):
 *  - serial0 (ttyS0): interactive login shell for the terminal
 *  - serial1 (ttyS1): a shell with no echo, used for hidden commands, e.g. in
 *    /etc/inittab: `ttyS1::respawn:/bin/sh -c 'stty -echo; exec /bin/sh'`
 *  - base64, find (GNU or busybox with -printf), tar
 *
 * Host these files under NEXT_PUBLIC_V86_ASSETS_URL (with CORS and
 * `Cross-Origin-Resource-Policy: cross-origin`): seabios.bin, vgabios.bin, bzImage
 */
import { V86_ASSETS_URL } from "../config";
import { SentinelCommandRunner, ShellFileSystem, bytesToBase64 } from "../fs-bridge";
import { OutputHub } from "./output-hub";
import {
  VmError,
  type AdapterOptions,
  type EmulatorAdapter,
  type ExecResult,
  type StartOptions,
  type VmFileSystem,
} from "./types";

const V86_VERSION = "0.5.462";
const V86_BASE = `https://cdn.jsdelivr.net/npm/v86@${V86_VERSION}/build`;

/** The subset of the v86 API used here (see v86.d.ts in the v86 package). */
interface V86Instance {
  add_listener(event: string, listener: (arg: never) => void): void;
  serial_send_bytes(serial: number, data: Uint8Array): void;
  destroy(): Promise<void>;
}
type V86Constructor = new (options: Record<string, unknown>) => V86Instance;

export class V86Adapter implements EmulatorAdapter {
  readonly name = `v86 ${V86_VERSION} (experimental)`;
  readonly fs: VmFileSystem;

  private emulator: V86Instance | null = null;
  private readonly output = new OutputHub();
  private readonly hidden: SentinelCommandRunner;
  private readonly hiddenListeners = new Set<(chunk: string) => void>();
  private readonly encoder = new TextEncoder();
  private pending: number[] = [];
  private flushScheduled = false;
  private resizeTimer: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;

  constructor(
    private readonly opts: AdapterOptions & { assetsUrl?: string },
  ) {
    this.hidden = new SentinelCommandRunner({
      send: (data) => this.emulator?.serial_send_bytes(1, this.encoder.encode(data)),
      onData: (cb) => {
        this.hiddenListeners.add(cb);
        return () => this.hiddenListeners.delete(cb);
      },
    });
    this.fs = new ShellFileSystem(this.hidden);
  }

  async start({ onProgress, shellRc }: StartOptions): Promise<void> {
    const assets = (this.opts.assetsUrl ?? V86_ASSETS_URL).replace(/\/$/, "");
    if (!assets) throw new VmError("The v86 engine needs NEXT_PUBLIC_V86_ASSETS_URL (see lib/emulator/v86-adapter.ts).");

    onProgress?.({ phase: "Loading v86", percent: 5 });
    const mod = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ `${V86_BASE}/libv86.mjs`)) as {
      V86: V86Constructor;
    };
    if (this.destroyed) throw new VmError("Session was stopped");

    const emulator = new mod.V86({
      wasm_path: `${V86_BASE}/v86.wasm`,
      memory_size: 256 * 1024 * 1024,
      vga_memory_size: 2 * 1024 * 1024,
      bios: { url: `${assets}/seabios.bin` },
      vga_bios: { url: `${assets}/vgabios.bin` },
      bzimage: { url: `${assets}/bzImage` },
      cmdline: "console=ttyS0 tsc=reliable mitigations=off random.trust_cpu=on",
      uart1: true,
      disable_keyboard: true,
      disable_mouse: true,
      autostart: true,
    });
    this.emulator = emulator;

    emulator.add_listener("download-progress", ((e: { file_name: string; loaded: number; total: number; lengthComputable: boolean }) => {
      const pct = e.lengthComputable && e.total ? Math.round((e.loaded / e.total) * 100) : undefined;
      onProgress?.({ phase: "Downloading kernel", percent: 10 + (pct ?? 0) * 0.5, detail: e.file_name });
    }) as (arg: never) => void);
    emulator.add_listener("serial0-output-byte", ((byte: number) => this.queueByte(byte)) as (arg: never) => void);
    emulator.add_listener("serial1-output-byte", ((byte: number) => {
      const ch = String.fromCharCode(byte);
      for (const l of this.hiddenListeners) l(ch);
    }) as (arg: never) => void);

    onProgress?.({ phase: "Booting Linux", percent: 65 });
    await this.output.waitForFirst(120_000);
    if (shellRc) {
      // The guest starts its own shell, so hand the rc over and source it there.
      onProgress?.({ phase: "Preparing shell", percent: 85 });
      const b64 = bytesToBase64(this.encoder.encode(shellRc));
      await this.exec(`printf '%s' '${b64}' | base64 -d > /tmp/sandboxrc`).catch((e) =>
        console.warn("[sandbox] v86 rc failed", e),
      );
      this.write(". /tmp/sandboxrc; clear\n");
    }
    onProgress?.({ phase: "Ready", percent: 100 });
  }

  write(data: string): void {
    this.emulator?.serial_send_bytes(0, this.encoder.encode(data));
  }

  onOutput(cb: (data: string | Uint8Array) => void) {
    return this.output.subscribe(cb);
  }

  resize(cols: number, rows: number): void {
    // Serial lines carry no window size; set it on the tty from the hidden shell.
    clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      void this.exec(`stty -F /dev/ttyS0 rows ${rows | 0} cols ${cols | 0}`).catch(() => undefined);
    }, 300);
  }

  exec(script: string): Promise<ExecResult> {
    if (!this.emulator) return Promise.reject(new VmError("VM is not running"));
    return this.hidden.exec(script);
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    clearTimeout(this.resizeTimer);
    const emulator = this.emulator;
    this.emulator = null;
    this.output.clear();
    this.hiddenListeners.clear();
    await emulator?.destroy().catch(() => undefined);
  }

  /** Serial output arrives one byte at a time; batch it per task for xterm. */
  private queueByte(byte: number) {
    this.pending.push(byte);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    setTimeout(() => {
      this.flushScheduled = false;
      const chunk = Uint8Array.from(this.pending);
      this.pending = [];
      this.output.emit(chunk);
    }, 0);
  }
}
