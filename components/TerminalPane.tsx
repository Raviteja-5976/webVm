"use client";

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { useSandbox, useSettings } from "@/lib/store";
import { TERMINAL_THEMES } from "./terminal-themes";

/** Quiet period after a command before the file manager refreshes. */
const SETTLE_MS = 700;

/**
 * xterm.js view of the VM console. Must be loaded with `ssr: false`
 * (xterm touches `window`). One terminal instance lives for the whole page;
 * when a new session starts it is cleared and re-attached.
 */
export default function TerminalPane() {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  const session = useSandbox((s) => s.session);
  const focusToken = useSandbox((s) => s.focusToken);
  const fontSize = useSettings((s) => s.fontSize);
  const theme = useSettings((s) => s.theme);

  // Create the terminal once.
  useEffect(() => {
    const host = hostRef.current!;
    const monoFamily =
      getComputedStyle(document.documentElement).getPropertyValue("--font-jetbrains").trim() || "monospace";
    const settings = useSettings.getState();
    const term = new Terminal({
      fontFamily: `${monoFamily}, ui-monospace, Menlo, monospace`,
      fontSize: settings.fontSize,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: "block",
      // The CheerpX console emits bare \n line endings.
      convertEol: true,
      scrollback: 5000,
      allowProposedApi: false,
      theme: TERMINAL_THEMES[settings.theme].theme,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((_e, uri) => window.open(uri, "_blank", "noopener,noreferrer")));
    term.open(host);
    termRef.current = term;
    fitRef.current = fit;

    // Ctrl+Shift+C / Ctrl+Shift+V copy and paste; Ctrl+C stays SIGINT.
    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== "keydown" || !ev.ctrlKey || !ev.shiftKey) return true;
      const key = ev.key.toLowerCase();
      if (key === "c") {
        const text = term.getSelection();
        if (text) void navigator.clipboard?.writeText(text).catch(() => undefined);
        ev.preventDefault();
        return false;
      }
      if (key === "v") {
        void navigator.clipboard
          ?.readText()
          .then((text) => text && term.paste(text))
          .catch(() => undefined);
        ev.preventDefault();
        return false;
      }
      return true;
    });

    const doFit = () => {
      if (!host.clientWidth || !host.clientHeight) return;
      try {
        fit.fit();
        useSandbox.getState().setTermSize(term.cols, term.rows);
      } catch {
        /* not attached yet */
      }
    };
    let raf = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(doFit);
    });
    observer.observe(host);
    // Web fonts change cell metrics; refit once they are ready.
    void document.fonts?.ready.then(doFit);
    doFit();

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // Attach to the current session: VM output -> xterm, keystrokes -> VM.
  useEffect(() => {
    const term = termRef.current;
    if (!term || !session) return;
    term.reset();
    const adapter = session.adapter;
    adapter.resize(term.cols, term.rows);

    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let commandPending = false;
    const scheduleSettle = () => {
      if (!commandPending) return;
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        commandPending = false;
        useSandbox.getState().bumpFs();
      }, SETTLE_MS);
    };

    const unsubscribe = adapter.onOutput((data) => {
      term.write(data);
      scheduleSettle();
    });
    const input = term.onData((data) => {
      adapter.write(data);
      if (data.includes("\r")) {
        commandPending = true;
        scheduleSettle();
      }
    });
    return () => {
      clearTimeout(settleTimer);
      unsubscribe();
      input.dispose();
    };
  }, [session]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = fontSize;
    term.options.theme = TERMINAL_THEMES[theme].theme;
    requestAnimationFrame(() => {
      try {
        fitRef.current?.fit();
        useSandbox.getState().setTermSize(term.cols, term.rows);
      } catch {
        /* ignore */
      }
    });
  }, [fontSize, theme]);

  useEffect(() => {
    if (focusToken) termRef.current?.focus();
  }, [focusToken]);

  return (
    <div
      className="terminal-host h-full w-full px-3 pt-2 pb-1"
      style={{ background: TERMINAL_THEMES[theme].theme.background }}
      data-testid="terminal"
    >
      <div ref={hostRef} className="h-full w-full" />
    </div>
  );
}
