import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { track } from "./analytics";
import { prefetchBootBlocks } from "./prefetch";
import { DEFAULT_ENGINE, type EngineId } from "./config";
import type { BootProgress, ExecResult } from "./emulator/types";
import type { Preset } from "./presets";
import { bootSession, cleanupOrphans, createSession, destroySession, type Session } from "./session";

export type Status = "idle" | "booting" | "running" | "stopping" | "stopped" | "error";
export type StopReason = "user" | "idle" | "reset" | "navigate";

interface SandboxState {
  status: Status;
  session: Session | null;
  preset: Preset | null;
  engine: EngineId;
  progress: BootProgress | null;
  /** Boot phases reached so far, in order (for the boot screen). */
  phases: string[];
  error: string | null;
  stopReason: StopReason | null;
  /** Preset sample files: created in the background after boot. */
  workspace: "preparing" | "ready";
  termSize: { cols: number; rows: number };
  /** Bumped whenever the VM filesystem probably changed; the file manager refreshes on change. */
  fsVersion: number;
  /** Bumped to ask the terminal to take focus. */
  focusToken: number;

  launch(preset: Preset, engine?: EngineId): Promise<void>;
  stop(reason?: StopReason): Promise<void>;
  reset(): Promise<void>;
  exec(script: string): Promise<ExecResult>;
  typeInTerminal(text: string, submit?: boolean): void;
  setTermSize(cols: number, rows: number): void;
  bumpFs(): void;
  focusTerminal(): void;
}

let stopping: Promise<void> | null = null;
/** Incremented by every launch and stop; a launch that sees a newer generation abandons itself. */
let generation = 0;

export const useSandbox = create<SandboxState>((set, get) => ({
  status: "idle",
  session: null,
  preset: null,
  engine: DEFAULT_ENGINE,
  progress: null,
  phases: [],
  error: null,
  stopReason: null,
  workspace: "ready",
  termSize: { cols: 80, rows: 24 },
  fsVersion: 0,
  focusToken: 0,

  async launch(preset, engine = get().engine) {
    if (stopping) await stopping;
    const { status } = get();
    if (status === "booting" || status === "running") return; // one session per tab
    const gen = ++generation;
    const current = () => gen === generation;
    set({ status: "booting", preset, engine, progress: null, phases: [], error: null, stopReason: null, session: null });
    track("sandbox_launch", { preset: preset.id, engine });
    if (engine === "cheerpx") prefetchBootBlocks(preset.id); // dedupes what hover already queued

    let session: Session | null = null;
    try {
      session = await createSession(preset, engine);
      if (!current()) {
        await destroySession(session); // stop() ran before the session existed
        return;
      }
      set({ session, workspace: preset.workspaceScript ? "preparing" : "ready" });

      // Sample files are created in the background, starting as soon as the VM
      // exists, so they stream alongside the shell instead of delaying the prompt.
      if (preset.workspaceScript) {
        session.adapter
          .exec(`cd "$HOME" || exit 1\n${preset.workspaceScript}`)
          .then((res) => res.status !== 0 && console.warn("[sandbox] workspace setup failed:", res.stderr))
          .catch((err) => current() && console.warn("[sandbox] workspace setup failed:", err))
          .finally(() => {
            if (!current()) return;
            set({ workspace: "ready" });
            get().bumpFs();
          });
      }

      const { cols, rows } = get().termSize;
      await bootSession(session, {
        cols,
        rows,
        onProgress: (p) => {
          if (!current()) return;
          const phases = get().phases;
          set({ progress: p, phases: phases.at(-1) === p.phase ? phases : [...phases, p.phase] });
        },
      });
      if (!current()) return; // stop() owns the cleanup
      set((s) => ({ status: "running", fsVersion: s.fsVersion + 1, focusToken: s.focusToken + 1 }));
      track("sandbox_ready", { preset: preset.id, engine, bootMs: session.bootMs });
    } catch (e) {
      if (!current()) return; // aborted by stop()
      const message = e instanceof Error ? e.message : String(e);
      console.error("[sandbox] launch failed", e);
      track("sandbox_error", { message });
      if (session) await destroySession(session).catch(() => undefined);
      set({ status: "error", error: message, session: null });
    }
  },

  async stop(reason = "user") {
    if (stopping) return stopping;
    generation++; // invalidates any launch still in flight
    const { session, status } = get();
    if (!session) {
      if (status === "booting" || status === "running" || status === "error") {
        set({ status: "stopped", stopReason: reason, progress: null });
      }
      return;
    }
    set({ status: "stopping" });
    stopping = (async () => {
      const uptime = session ? Date.now() - session.startedAt : 0;
      if (session) await destroySession(session);
      set({ session: null, status: "stopped", stopReason: reason, progress: null });
      track("sandbox_stop", { reason, uptimeMs: uptime });
      // Sweep anything a half-booted session may have created after destroy.
      setTimeout(() => void cleanupOrphans(), 2000);
    })();
    try {
      await stopping;
    } finally {
      stopping = null;
    }
  },

  async reset() {
    const preset = get().preset;
    await get().stop("reset");
    if (preset) await get().launch(preset);
  },

  async exec(script) {
    const session = get().session;
    if (!session || get().status !== "running") throw new Error("The sandbox is not running");
    return session.adapter.exec(script);
  },

  typeInTerminal(text, submit = false) {
    const session = get().session;
    if (!session || get().status !== "running") return;
    session.adapter.write(submit ? text + "\r" : text);
    set((s) => ({ focusToken: s.focusToken + 1 }));
  },

  setTermSize(cols, rows) {
    const current = get().termSize;
    if (current.cols === cols && current.rows === rows) return;
    set({ termSize: { cols, rows } });
    get().session?.adapter.resize(cols, rows);
  },

  bumpFs() {
    set((s) => ({ fsVersion: s.fsVersion + 1 }));
  },

  focusTerminal() {
    set((s) => ({ focusToken: s.focusToken + 1 }));
  },
}));

/* ------------------------------------------------------------------ */
/* Per-viewer settings (persisted locally)                             */
/* ------------------------------------------------------------------ */

export type TerminalThemeId = "midnight" | "amber" | "paper";

interface SettingsState {
  fontSize: number;
  theme: TerminalThemeId;
  sidebarWidth: number;
  showHidden: boolean;
  sidebarTab: "files" | "lessons" | "cheatsheet";
  setFontSize(size: number): void;
  setTheme(theme: TerminalThemeId): void;
  setSidebarWidth(width: number): void;
  setShowHidden(show: boolean): void;
  setSidebarTab(tab: SettingsState["sidebarTab"]): void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      fontSize: 14,
      theme: "midnight",
      sidebarWidth: 340,
      showHidden: false,
      sidebarTab: "files",
      setFontSize: (fontSize) => set({ fontSize: Math.min(24, Math.max(10, fontSize)) }),
      setTheme: (theme) => set({ theme }),
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth: Math.min(640, Math.max(240, sidebarWidth)) }),
      setShowHidden: (showHidden) => set({ showHidden }),
      setSidebarTab: (sidebarTab) => set({ sidebarTab }),
    }),
    { name: "sandbox-settings", storage: createJSONStorage(() => localStorage) },
  ),
);
