import type { EngineId } from "./config";

export interface CapabilityCheck {
  id: string;
  label: string;
  ok: boolean;
  help: string;
}

export interface CapabilityReport {
  ok: boolean;
  checks: CapabilityCheck[];
  /** Touch-first small screen: works, but a desktop is recommended. */
  mobile: boolean;
}

/** Everything the emulator needs from the browser. Call on the client only. */
export function checkCapabilities(engine: EngineId = "cheerpx"): CapabilityReport {
  const needsVm = engine !== "mock";
  const checks: CapabilityCheck[] = [
    {
      id: "wasm",
      label: "WebAssembly",
      ok: typeof WebAssembly === "object" && typeof WebAssembly.instantiate === "function",
      help: "Your browser does not support WebAssembly. Use a current Chrome, Edge or Firefox.",
    },
    {
      id: "coi",
      label: "Cross-origin isolation",
      ok: !needsVm || window.crossOriginIsolated === true,
      help:
        "This page is not cross-origin isolated. It must be served over HTTPS (or localhost) with the headers " +
        "Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp.",
    },
    {
      id: "sab",
      label: "SharedArrayBuffer",
      ok: !needsVm || typeof SharedArrayBuffer === "function",
      help: "SharedArrayBuffer is unavailable. It requires cross-origin isolation and a desktop browser.",
    },
    {
      id: "idb",
      label: "IndexedDB",
      ok: typeof indexedDB !== "undefined" && indexedDB !== null,
      help: "IndexedDB is disabled (private browsing or blocked site data). The sandbox stores its session disk there.",
    },
  ];
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const small = Math.min(window.screen?.width ?? 1024, window.screen?.height ?? 768) < 768;
  return { ok: checks.every((c) => c.ok), checks, mobile: coarse && small };
}
