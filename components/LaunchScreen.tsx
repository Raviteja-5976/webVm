"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { preloadModule } from "react-dom";
import { ArrowRight, Check, Cpu, FolderTree, GraduationCap, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { checkCapabilities, type CapabilityReport } from "@/lib/capabilities";
import { CHEERPX_URL, DEFAULT_ENGINE, type EngineId } from "@/lib/config";
import { PRESETS, type PresetId } from "@/lib/presets";
import { prefetchImageHead, prewarmEngine } from "@/lib/prefetch";
import { cleanupOrphans } from "@/lib/session";

const noSubscribe = () => () => {};
const ENGINES: EngineId[] = ["cheerpx", "v86", "mock"];

/** `?engine=mock|v86` overrides the default engine (handy for testing). */
function readEngine(search: string): EngineId {
  const requested = new URLSearchParams(search).get("engine") as EngineId | null;
  return requested && ENGINES.includes(requested) ? requested : DEFAULT_ENGINE;
}

const reports = new Map<EngineId, CapabilityReport>();
function cachedReport(engine: EngineId) {
  if (!reports.has(engine)) reports.set(engine, checkCapabilities(engine));
  return reports.get(engine)!;
}

export default function LaunchScreen() {
  const router = useRouter();
  const [preset, setPreset] = useState<PresetId>("linux-basics");
  const [launching, setLaunching] = useState(false);
  // Browser-only values: null/default during server rendering, real values after hydration.
  const engine = useSyncExternalStore(noSubscribe, () => readEngine(window.location.search), () => DEFAULT_ENGINE);
  const report = useSyncExternalStore<CapabilityReport | null>(noSubscribe, () => cachedReport(engine), () => null);

  useEffect(() => {
    // Warm everything the launch will need while the visitor reads the page.
    if (engine === "cheerpx") {
      preloadModule(CHEERPX_URL, { as: "script", crossOrigin: "anonymous" });
      prefetchImageHead();
    }
    router.prefetch("/sandbox");
    void cleanupOrphans();
  }, [router, engine]);

  const ready = report?.ok ?? false;
  const launch = () => {
    if (!ready) return;
    setLaunching(true);
    const q = new URLSearchParams({ preset });
    if (engine !== DEFAULT_ENGINE) q.set("engine", engine);
    router.push(`/sandbox?${q}`);
  };

  return (
    <main className="relative min-h-dvh overflow-hidden">
      <div className="grid-backdrop pointer-events-none absolute inset-x-0 top-0 h-[520px]" />
      <div className="relative mx-auto flex max-w-6xl flex-col px-4 pt-6 pb-16 sm:px-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-mono text-sm font-semibold">
            <span className="flex h-7 w-7 items-center justify-center rounded bg-accent/15 text-accent">$</span>
            sandbox<span className="-mx-1.5 text-accent">/</span>sh
          </div>
          <a href="https://github.com/leaningtech/webvm" className="text-xs text-muted hover:text-text" target="_blank" rel="noreferrer">
            Powered by CheerpX
          </a>
        </header>

        <section className="mt-14 grid items-start gap-12 lg:mt-20 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <p className="font-mono text-xs tracking-[0.2em] text-accent uppercase">Debian · x86 · WebAssembly</p>
            <h1 className="mt-4 text-4xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-5xl">
              A real Linux shell, running in this browser tab.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted">
              Practise the command line, bash scripting and git on a genuine Debian system. Nothing to install, no
              account, and no server doing the work. Press Stop and the whole machine is gone.
            </p>

            <fieldset className="mt-8">
              <legend className="text-xs font-semibold tracking-wider text-faint uppercase">Start with</legend>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {PRESETS.map((p) => {
                  const selected = p.id === preset;
                  return (
                    <label
                      key={p.id}
                      className={`flex cursor-pointer flex-col rounded-lg border px-3.5 py-3 transition-colors ${
                        selected ? "border-accent/70 bg-accent/[0.06]" : "border-line bg-panel/70 hover:border-line-strong"
                      }`}
                    >
                      <input
                        type="radio"
                        name="preset"
                        value={p.id}
                        checked={selected}
                        onChange={() => setPreset(p.id)}
                        className="sr-only"
                      />
                      <span className="flex items-center justify-between text-sm font-medium">
                        {p.title}
                        <span className={`h-3 w-3 rounded-full border ${selected ? "border-accent bg-accent" : "border-line-strong"}`} />
                      </span>
                      <span className="mt-1 text-xs text-muted">{p.tagline}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="mt-7 flex flex-wrap items-center gap-4">
              <button
                onClick={launch}
                onMouseEnter={() => void prewarmEngine(engine, preset)}
                onFocus={() => void prewarmEngine(engine, preset)}
                disabled={!ready || launching}
                data-testid="launch"
                className="group inline-flex h-12 items-center gap-2 rounded-lg bg-accent px-6 text-base font-semibold text-bg shadow-[0_0_40px_-8px] shadow-accent/60 transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
              >
                {launching ? "Launching…" : "Launch sandbox"}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </button>
              <CapabilityChips report={report} />
            </div>
            {report && !report.ok && (
              <div className="mt-4 flex max-w-xl gap-2 rounded-md border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
                <TriangleAlert className="mt-px h-4 w-4 shrink-0" />
                <span>{report.checks.find((c) => !c.ok)?.help}</span>
              </div>
            )}
            {report?.mobile && (
              <p className="mt-4 max-w-xl text-xs text-warn">
                You seem to be on a phone or tablet. It may work, but a desktop browser with a keyboard is much better.
              </p>
            )}
          </div>

          <TerminalPreview />
        </section>

        <section className="mt-20 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          <Feature icon={<Cpu className="h-4 w-4" />} title="Runs on your machine">
            x86 code is compiled to WebAssembly on the fly. No per-user servers.
          </Feature>
          <Feature icon={<ShieldCheck className="h-4 w-4" />} title="Ephemeral by design">
            Every change lives in a per-session layer that is deleted when you stop.
          </Feature>
          <Feature icon={<FolderTree className="h-4 w-4" />} title="Terminal plus files">
            A file manager to upload, edit, rename and download what you make.
          </Feature>
          <Feature icon={<GraduationCap className="h-4 w-4" />} title="Built for learning">
            Guided lessons with one-click commands and automatic task checks.
          </Feature>
        </section>

        <footer className="mt-10 max-w-3xl text-[11px] leading-relaxed text-faint">
          The VM has no internet access. The base disk image is read-only and shared; your session&apos;s changes are kept
          in this browser&apos;s IndexedDB only until you stop. CheerpX is free for personal and open-source projects;
          commercial use needs a license from Leaning Technologies.
        </footer>
      </div>
    </main>
  );
}

function CapabilityChips({ report }: { report: CapabilityReport | null }) {
  if (!report) return <span className="text-xs text-faint">Checking browser…</span>;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Browser support" data-testid="capabilities">
      {report.checks.map((c) => (
        <li
          key={c.id}
          title={c.ok ? `${c.label}: supported` : c.help}
          className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
            c.ok ? "border-line text-muted" : "border-danger/40 text-danger"
          }`}
        >
          {c.ok ? <Check className="h-3 w-3 text-accent" /> : <X className="h-3 w-3" />}
          {c.label}
        </li>
      ))}
    </ul>
  );
}

function Feature({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-panel p-5">
      <div className="flex h-8 w-8 items-center justify-center rounded-md border border-line-strong text-accent">{icon}</div>
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">{children}</p>
    </div>
  );
}

function P() {
  return (
    <>
      <span className="text-accent">user@sandbox</span>:<span className="text-info">~</span>$
    </>
  );
}

function TerminalPreview() {
  return (
    <div className="overflow-hidden rounded-xl border border-line-strong bg-[#0b0d12] shadow-2xl shadow-black/50" aria-hidden>
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
        <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
        <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
        <span className="ml-2 font-mono text-[11px] text-faint">bash — 80×24</span>
      </div>
      <pre className="overflow-hidden p-4 font-mono text-[12.5px] leading-6 text-text">
        <P /> uname -sm{"\n"}
        <span className="text-muted">Linux i686</span>
        {"\n"}
        <P /> git log --oneline --graph --all{"\n"}
        <span className="text-muted">
          <span className="text-warn">*</span> 7c1e9a2 <span className="text-info">(feature/shout)</span> Add shout(){"\n"}
          <span className="text-warn">*</span> 4b20d5f <span className="text-accent">(HEAD -&gt; main, origin/main)</span> Add greet(){"\n"}
          <span className="text-warn">*</span> 0e93c11 Initial commit
        </span>
        {"\n"}
        <P /> grep -c ERROR ~/practice/logs/app.log{"\n"}
        <span className="text-muted">2</span>
        {"\n"}
        <P /> <span className="cursor-blink inline-block h-4 w-2 translate-y-0.5 bg-accent" />
      </pre>
    </div>
  );
}
