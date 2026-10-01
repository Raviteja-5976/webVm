/**
 * Engine-agnostic contract between the UI and whatever runs Linux.
 * The UI only ever talks to these interfaces, so CheerpX, v86 and the mock
 * backend are interchangeable.
 */

export interface EmulatorAdapter {
  /** Human readable engine name, e.g. "CheerpX 1.3.9". */
  readonly name: string;
  /** Boot the VM. Resolves when a shell is ready. */
  start(opts: StartOptions): Promise<void>;
  /** Send raw input (keystrokes) from the terminal to the VM. */
  write(data: string): void;
  /** Register a callback for VM output (bytes/strings to render). Returns an unsubscribe function. */
  onOutput(cb: (data: string | Uint8Array) => void): () => void;
  /** Inform the VM of terminal size changes. */
  resize(cols: number, rows: number): void;
  /** File operations used by the file manager. */
  fs: VmFileSystem;
  /**
   * Run a shell script in a hidden process (never shown in the terminal).
   * Used by the file bridge, lesson task checks and preset setup.
   */
  exec(script: string): Promise<ExecResult>;
  /** Stop the VM and release every resource it holds (IndexedDB handles included). */
  destroy(): Promise<void>;
  /** IndexedDB database names owned by this session, deleted after destroy(). */
  storageNames?(): string[];
}

export interface StartOptions {
  cols: number;
  rows: number;
  onProgress?: (p: BootProgress) => void;
  /**
   * Optional bash snippet sourced by the interactive shell before its first
   * prompt (prompt, aliases, dotfile defaults). Keep it to builtins.
   */
  shellRc?: string;
}

export interface BootProgress {
  phase: string;
  percent?: number;
  /** Extra detail for the current phase, e.g. "12.4 MB". */
  detail?: string;
}

export interface ExecResult {
  /** Exit status of the script. */
  status: number;
  /** Raw stdout bytes. */
  stdout: Uint8Array;
  /** stderr decoded as text (may be empty). */
  stderr: string;
}

export interface VmFileSystem {
  list(path: string): Promise<VmEntry[]>;
  read(path: string): Promise<Uint8Array>;
  write(path: string, data: Uint8Array | string): Promise<void>;
  mkdir(path: string): Promise<void>;
  remove(path: string, opts?: { recursive?: boolean }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** Optional: pack a directory into a .tar.gz for download. */
  archive?(path: string): Promise<Uint8Array>;
}

export interface VmEntry {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink";
  size: number;
  /** Modification time in milliseconds since the epoch. */
  mtime: number;
  /** For symlinks: true when the link resolves to a directory. */
  linkToDir?: boolean;
}

export interface AdapterOptions {
  /** Unique per launch. Every piece of per-session storage is keyed by it. */
  sessionId: string;
}

export class VmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "VmError";
  }
}
