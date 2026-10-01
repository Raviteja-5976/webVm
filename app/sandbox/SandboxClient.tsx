"use client";

import dynamic from "next/dynamic";

/** The whole sandbox is client-only: it needs window, WebAssembly and IndexedDB. */
const SandboxShell = dynamic(() => import("@/components/SandboxShell"), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh items-center justify-center font-mono text-xs text-muted" role="status">
      Loading sandbox…
    </div>
  ),
});

export default function SandboxClient() {
  return <SandboxShell />;
}
