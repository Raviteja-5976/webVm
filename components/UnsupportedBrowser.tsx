import Link from "next/link";
import { Check, X } from "lucide-react";
import type { CapabilityReport } from "@/lib/capabilities";

export default function UnsupportedBrowser({ report }: { report: CapabilityReport }) {
  const failed = report.checks.filter((c) => !c.ok);
  return (
    <main className="flex min-h-dvh items-center justify-center p-6" data-testid="unsupported">
      <div className="w-full max-w-lg rounded-lg border border-line bg-panel p-6">
        <p className="font-mono text-xs tracking-widest text-danger uppercase">Can’t start here</p>
        <h1 className="mt-1 text-xl font-semibold">This browser can’t run the sandbox</h1>
        <ul className="mt-5 flex flex-col gap-2 text-sm">
          {report.checks.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              {c.ok ? <Check className="h-4 w-4 text-accent" /> : <X className="h-4 w-4 text-danger" />}
              <span className={c.ok ? "text-muted" : "text-text"}>{c.label}</span>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex flex-col gap-2 text-xs leading-relaxed text-muted">
          {failed.map((c) => (
            <p key={c.id}>{c.help}</p>
          ))}
          <p>Recommended: a current desktop Chrome, Edge or Firefox.</p>
        </div>
        <Link href="/" className="mt-6 inline-block text-sm text-accent hover:underline">
          ← Back
        </Link>
      </div>
    </main>
  );
}
