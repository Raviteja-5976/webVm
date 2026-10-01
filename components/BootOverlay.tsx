"use client";

import Link from "next/link";
import { Check, LoaderCircle, Power, RotateCcw, TriangleAlert } from "lucide-react";
import { IDLE_TIMEOUT_MS } from "@/lib/config";
import { useSandbox } from "@/lib/store";
import { Button } from "./Dialog";

/** Covers the terminal while booting, stopping, after stop, and on errors. */
export default function BootOverlay() {
  const status = useSandbox((s) => s.status);
  const progress = useSandbox((s) => s.progress);
  const phases = useSandbox((s) => s.phases);
  const error = useSandbox((s) => s.error);
  const stopReason = useSandbox((s) => s.stopReason);
  const preset = useSandbox((s) => s.preset);
  const launch = useSandbox((s) => s.launch);

  if (status === "running" || status === "idle") return null;

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg/92 p-6 backdrop-blur-sm" data-testid="boot-overlay" data-status={status}>
      <div className="w-full max-w-md">
        {status === "booting" && (
          <>
            <p className="font-mono text-xs tracking-widest text-accent uppercase">Launching</p>
            <h2 className="mt-1 text-xl font-semibold">{preset?.title ?? "Sandbox"}</h2>
            <ol className="mt-5 flex flex-col gap-2 font-mono text-[13px]" aria-live="polite">
              {phases.map((phase, i) => {
                const current = i === phases.length - 1;
                return (
                  <li key={phase} className={`flex items-center gap-2.5 ${current ? "text-text" : "text-faint"}`}>
                    {current ? (
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin text-accent" />
                    ) : (
                      <Check className="h-3.5 w-3.5 text-accent-dim" />
                    )}
                    <span>{phase}</span>
                    {current && progress?.detail && <span className="ml-auto text-xs text-muted">{progress.detail}</span>}
                  </li>
                );
              })}
            </ol>
            <div className="mt-5 h-1 overflow-hidden rounded-full bg-raised">
              {progress?.percent != null ? (
                <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${progress.percent}%` }} />
              ) : (
                <div className="progress-indeterminate h-full w-1/3 rounded-full bg-accent" />
              )}
            </div>
            <p className="mt-4 text-xs leading-relaxed text-muted">
              Linux boots inside this tab with WebAssembly. The first launch streams the disk blocks it needs; after that
              your browser cache makes launches much faster.
            </p>
          </>
        )}

        {status === "stopping" && (
          <div className="flex items-center gap-3 text-sm text-muted">
            <LoaderCircle className="h-4 w-4 animate-spin" /> Destroying sandbox and its data…
          </div>
        )}

        {status === "stopped" && (
          <>
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-line-strong bg-panel-2">
              <Power className="h-5 w-5 text-muted" />
            </div>
            <h2 className="mt-4 text-xl font-semibold">Sandbox destroyed</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {stopReason === "idle"
                ? `Stopped after ${Math.round(IDLE_TIMEOUT_MS / 60000)} minutes without activity to free memory. `
                : ""}
              The VM and every change you made are gone. A new launch starts from the pristine image.
            </p>
            <div className="mt-5 flex gap-2">
              <Button variant="primary" onClick={() => preset && void launch(preset)} data-testid="relaunch">
                <RotateCcw className="h-4 w-4" /> Launch new sandbox
              </Button>
              <Link href="/" className="inline-flex h-8 items-center rounded-md px-3 text-sm text-muted hover:bg-raised hover:text-text">
                Change preset
              </Link>
            </div>
          </>
        )}

        {status === "error" && (
          <>
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-danger/40 bg-danger/10">
              <TriangleAlert className="h-5 w-5 text-danger" />
            </div>
            <h2 className="mt-4 text-xl font-semibold">The sandbox could not start</h2>
            <pre className="mt-3 max-h-40 overflow-auto rounded-md border border-line bg-panel p-3 font-mono text-xs whitespace-pre-wrap text-danger">
              {error}
            </pre>
            <p className="mt-3 text-xs text-muted">
              Check your connection (the disk image streams from a CDN), then retry. Browser extensions that block
              third-party requests can also stop the engine from loading.
            </p>
            <div className="mt-5 flex gap-2">
              <Button variant="primary" onClick={() => preset && void launch(preset)}>
                <RotateCcw className="h-4 w-4" /> Retry
              </Button>
              <Link href="/" className="inline-flex h-8 items-center rounded-md px-3 text-sm text-muted hover:bg-raised hover:text-text">
                Back to start
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
