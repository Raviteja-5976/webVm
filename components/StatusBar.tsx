"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LoaderCircle, Minus, Plus, RotateCcw, Square } from "lucide-react";
import { useSandbox, useSettings, type TerminalThemeId } from "@/lib/store";
import { Button, ConfirmDialog, IconButton } from "./Dialog";
import { TERMINAL_THEMES } from "./terminal-themes";

const STATUS_LABEL = {
  idle: "Idle",
  booting: "Booting",
  running: "Running",
  stopping: "Stopping",
  stopped: "Stopped",
  error: "Error",
} as const;

/** Top bar: identity, session status, terminal settings, Reset and Stop. */
export default function StatusBar() {
  const status = useSandbox((s) => s.status);
  const session = useSandbox((s) => s.session);
  const preset = useSandbox((s) => s.preset);
  const workspace = useSandbox((s) => s.workspace);
  const stop = useSandbox((s) => s.stop);
  const reset = useSandbox((s) => s.reset);
  const fontSize = useSettings((s) => s.fontSize);
  const setFontSize = useSettings((s) => s.setFontSize);
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  const [confirmReset, setConfirmReset] = useState(false);

  const live = status === "running" || status === "booting";
  const dot =
    status === "running" ? "bg-accent" : status === "booting" || status === "stopping" ? "bg-warn animate-pulse" : status === "error" ? "bg-danger" : "bg-faint";

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
      <Link href="/" className="flex items-center gap-2 font-mono text-sm font-semibold tracking-tight" title="Back to start">
        <span className="flex h-6 w-6 items-center justify-center rounded bg-accent/15 text-accent">$</span>
        <span className="hidden sm:inline">
          sandbox<span className="text-accent">/</span>sh
        </span>
      </Link>
      {preset && <span className="hidden rounded border border-line px-2 py-0.5 text-xs text-muted md:inline">{preset.title}</span>}

      <div className="flex items-center gap-2 rounded-full border border-line bg-bg px-2.5 py-1 text-xs" data-testid="status-pill" data-status={status}>
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <span>{STATUS_LABEL[status]}</span>
        {status === "running" && session?.bootMs != null && (
          <span className="text-faint" title="Time from launch to shell" data-testid="boot-time">
            · {(session.bootMs / 1000).toFixed(1)}s boot
          </span>
        )}
        {status === "running" && session && <Uptime since={session.startedAt} />}
      </div>
      {status === "running" && workspace === "preparing" && (
        <span className="flex items-center gap-1.5 text-xs text-muted" role="status" data-testid="workspace-preparing">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin text-warn" />
          Adding {preset?.title.toLowerCase()} files…
        </span>
      )}

      <div className="flex-1" />

      <div className="hidden items-center gap-0.5 md:flex" role="group" aria-label="Font size">
        <IconButton label="Smaller text" onClick={() => setFontSize(fontSize - 1)}>
          <Minus className="h-3.5 w-3.5" />
        </IconButton>
        <span className="w-7 text-center font-mono text-xs text-muted tabular-nums">{fontSize}</span>
        <IconButton label="Larger text" onClick={() => setFontSize(fontSize + 1)}>
          <Plus className="h-3.5 w-3.5" />
        </IconButton>
      </div>
      <select
        aria-label="Terminal theme"
        value={theme}
        onChange={(e) => setTheme(e.target.value as TerminalThemeId)}
        className="hidden h-8 rounded-md border border-line-strong bg-raised px-2 text-xs text-text md:block"
      >
        {Object.entries(TERMINAL_THEMES).map(([id, t]) => (
          <option key={id} value={id}>
            {t.label}
          </option>
        ))}
      </select>

      <Button onClick={() => setConfirmReset(true)} disabled={!live || !preset} title="Destroy this sandbox and start a fresh one">
        <RotateCcw className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Reset</span>
      </Button>
      <Button variant="danger" onClick={() => void stop("user")} disabled={!live} data-testid="stop" title="Destroy the sandbox">
        <Square className="h-3 w-3 fill-current" /> Stop
      </Button>

      {confirmReset && (
        <ConfirmDialog
          title="Reset the sandbox?"
          message="This destroys the current VM and everything in it, then launches a fresh one from the pristine image."
          confirmLabel="Reset"
          danger
          onConfirm={() => {
            void reset();
          }}
          onClose={() => setConfirmReset(false)}
        />
      )}
    </header>
  );
}

function Uptime({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  const text = s < 3600 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return <span className="hidden font-mono text-faint tabular-nums lg:inline">· up {text}</span>;
}
