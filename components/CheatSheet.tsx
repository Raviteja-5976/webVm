"use client";

import { CHEAT_SHEET } from "@/lib/lessons";
import { useSandbox } from "@/lib/store";

/** Common commands; clicking one types it at the prompt (without pressing Enter). */
export default function CheatSheet() {
  const typeInTerminal = useSandbox((s) => s.typeInTerminal);
  const running = useSandbox((s) => s.status === "running");
  return (
    <div className="h-full overflow-auto p-3">
      <p className="px-1 pb-2 text-xs text-muted">Click a command to type it at the prompt. Edit it, then press Enter.</p>
      {CHEAT_SHEET.map((group) => (
        <section key={group.title} className="mb-3">
          <h3 className="px-1 pb-1 text-[11px] font-semibold tracking-wider text-faint uppercase">{group.title}</h3>
          <ul className="overflow-hidden rounded-md border border-line">
            {group.items.map(([cmd, what]) => {
              const typeable = !cmd.startsWith("Ctrl");
              return (
                <li key={cmd} className="border-b border-line last:border-b-0">
                  <button
                    disabled={!running || !typeable}
                    onClick={() => typeInTerminal(cmd)}
                    className="flex w-full items-baseline gap-3 px-2.5 py-1.5 text-left hover:bg-raised disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    <code className="shrink-0 font-mono text-xs text-accent">{cmd}</code>
                    <span className="ml-auto text-right text-[11px] text-muted">{what}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
