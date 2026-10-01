"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, FolderTree, ListChecks, X } from "lucide-react";
import { checkCapabilities } from "@/lib/capabilities";
import { DEFAULT_ENGINE, IDLE_TIMEOUT_MS, type EngineId } from "@/lib/config";
import { getPreset } from "@/lib/presets";
import { cleanupOrphans, destroySessionNow } from "@/lib/session";
import { useSandbox, useSettings } from "@/lib/store";
import BootOverlay from "./BootOverlay";
import CheatSheet from "./CheatSheet";
import FileManagerPane from "./FileManagerPane";
import LessonsPanel from "./LessonsPanel";
import StatusBar from "./StatusBar";
import UnsupportedBrowser from "./UnsupportedBrowser";

// xterm touches `window`, so it is never rendered on the server.
const TerminalPane = dynamic(() => import("./TerminalPane"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-[#0b0d12]" />,
});

const ENGINES: EngineId[] = ["cheerpx", "v86", "mock"];

/** The sandbox page: file manager | terminal, plus lifecycle wiring. Client only. */
export default function SandboxShell() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const preset = useMemo(() => getPreset(params.get("preset")), [params]);
  const engine = useMemo<EngineId>(() => {
    const e = params.get("engine") as EngineId | null;
    return e && ENGINES.includes(e) ? e : DEFAULT_ENGINE;
  }, [params]);
  const report = useMemo(() => checkCapabilities(engine), [engine]);

  if (!report.ok) return <UnsupportedBrowser report={report} />;
  return <Workspace presetId={preset.id} engine={engine} mobile={report.mobile} />;
}

function Workspace({ presetId, engine, mobile }: { presetId: string; engine: EngineId; mobile: boolean }) {
  const status = useSandbox((s) => s.status);
  const sidebarTab = useSettings((s) => s.sidebarTab);
  const setSidebarTab = useSettings((s) => s.setSidebarTab);
  const sidebarWidth = useSettings((s) => s.sidebarWidth);
  const idleWarning = useIdleTimeout(IDLE_TIMEOUT_MS, status === "running");

  // Launch on arrival; destroy when leaving the page.
  useEffect(() => {
    void cleanupOrphans();
    void useSandbox.getState().launch(getPreset(presetId), engine);
    return () => void useSandbox.getState().stop("navigate");
  }, [presetId, engine]);

  // Tab closing: best-effort cleanup. Orphan cleanup on the next load is the real guarantee.
  useEffect(() => {
    const onHide = (e: PageTransitionEvent) => {
      if (e.persisted) return; // bfcache: page may come back
      const session = useSandbox.getState().session;
      if (session) destroySessionNow(session);
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  // Ctrl+` focuses the terminal from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "`") {
        e.preventDefault();
        useSandbox.getState().focusTerminal();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <StatusBar />
      {mobile && <MobileNotice />}
      <div className="flex min-h-0 flex-1">
        <aside className="relative flex shrink-0 flex-col border-r border-line bg-panel" style={{ width: sidebarWidth }}>
          <div role="tablist" aria-label="Side panel" className="flex border-b border-line px-1">
            <Tab id="files" label="Files" icon={<FolderTree className="h-3.5 w-3.5" />} active={sidebarTab} onSelect={setSidebarTab} />
            <Tab id="lessons" label="Lessons" icon={<BookOpen className="h-3.5 w-3.5" />} active={sidebarTab} onSelect={setSidebarTab} />
            <Tab id="cheatsheet" label="Cheat sheet" icon={<ListChecks className="h-3.5 w-3.5" />} active={sidebarTab} onSelect={setSidebarTab} />
          </div>
          <div className="min-h-0 flex-1" role="tabpanel">
            {sidebarTab === "files" && <FileManagerPane />}
            {sidebarTab === "lessons" && <LessonsPanel />}
            {sidebarTab === "cheatsheet" && <CheatSheet />}
          </div>
          <ResizeHandle />
        </aside>
        <main className="relative min-w-0 flex-1">
          <TerminalPane />
          <BootOverlay />
        </main>
      </div>
      <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-line bg-panel px-3 text-[11px] text-faint">
        <span>
          <Kbd>Ctrl</Kbd>+<Kbd>Shift</Kbd>+<Kbd>C</Kbd>/<Kbd>V</Kbd> copy/paste
        </span>
        <span className="hidden sm:inline">
          <Kbd>Ctrl</Kbd>+<Kbd>`</Kbd> focus terminal
        </span>
        <span className="hidden md:inline">Offline VM · nothing is kept after Stop</span>
        <span className="flex-1" />
        {idleWarning != null && (
          <span className="text-warn" role="status">
            Idle: auto-stop in {idleWarning}s. Press any key to stay.
          </span>
        )}
        <SessionId />
      </footer>
    </div>
  );
}

function Tab({
  id,
  label,
  icon,
  active,
  onSelect,
}: {
  id: "files" | "lessons" | "cheatsheet";
  label: string;
  icon: React.ReactNode;
  active: string;
  onSelect: (id: "files" | "lessons" | "cheatsheet") => void;
}) {
  const selected = active === id;
  return (
    <button
      role="tab"
      aria-selected={selected}
      onClick={() => onSelect(id)}
      className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
        selected ? "border-accent text-text" : "border-transparent text-muted hover:text-text"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function ResizeHandle() {
  const setWidth = useSettings((s) => s.setSidebarWidth);
  const dragging = useRef(false);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize side panel"
      className="absolute top-0 -right-1 z-20 h-full w-2 cursor-col-resize hover:bg-accent/30"
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => dragging.current && setWidth(e.clientX)}
      onPointerUp={() => (dragging.current = false)}
    />
  );
}

function SessionId() {
  const session = useSandbox((s) => s.session);
  if (!session) return null;
  return (
    <span className="font-mono" title={`Session ${session.id} · ${session.adapter.name}`} data-testid="session-id">
      {session.adapter.name} · {session.id.slice(0, 8)}
    </span>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-line-strong bg-raised px-1 font-mono text-[10px] text-muted">{children}</kbd>;
}

function MobileNotice() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem("sandbox-mobile-notice") === "hidden";
    } catch {
      return false;
    }
  });
  if (hidden) return null;
  return (
    <div className="flex items-center gap-2 border-b border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
      <span className="flex-1">
        This sandbox is built for desktop browsers. Phones have limited memory and no real keyboard, so things may be slow.
      </span>
      <button
        aria-label="Dismiss"
        onClick={() => {
          setHidden(true);
          try {
            localStorage.setItem("sandbox-mobile-notice", "hidden");
          } catch {
            /* ignore */
          }
        }}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/** Stops the sandbox after `ms` without keyboard/pointer input. Returns seconds left once under a minute. */
function useIdleTimeout(ms: number, active: boolean): number | null {
  const [warning, setWarning] = useState<number | null>(null);

  useEffect(() => {
    if (!active || !ms) return;
    let last = Date.now();
    const bump = () => {
      last = Date.now();
    };
    const events = ["keydown", "pointerdown", "pointermove", "wheel"] as const;
    events.forEach((ev) => window.addEventListener(ev, bump, { capture: true, passive: true }));
    const timer = setInterval(() => {
      const left = ms - (Date.now() - last);
      if (left <= 0) {
        setWarning(null);
        void useSandbox.getState().stop("idle");
      } else {
        setWarning(left < 60_000 ? Math.ceil(left / 1000) : null);
      }
    }, 1000);
    return () => {
      clearInterval(timer);
      events.forEach((ev) => window.removeEventListener(ev, bump, { capture: true }));
    };
  }, [ms, active]);

  return active ? warning : null;
}
