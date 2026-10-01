"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EDITOR_MAX_BYTES } from "@/lib/config";
import type { VmEntry, VmFileSystem } from "@/lib/emulator/types";
import { Button, Modal } from "./Dialog";
import { formatSize } from "./FileTree";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string }
  | { kind: "unsupported"; message: string };

/** Plain-textarea editor for text files in the VM. */
export function FileEditorDialog({
  entry,
  fs,
  onClose,
  onSaved,
  onDownload,
}: {
  entry: VmEntry;
  fs: VmFileSystem;
  onClose: () => void;
  onSaved: () => void;
  onDownload: () => void;
}) {
  const tooLarge = entry.size > EDITOR_MAX_BYTES;
  const [state, setState] = useState<LoadState>(() =>
    tooLarge
      ? {
          kind: "unsupported",
          message: `This file is ${formatSize(entry.size)}. Files over ${formatSize(EDITOR_MAX_BYTES)} can be downloaded instead.`,
        }
      : { kind: "loading" },
  );
  const [text, setText] = useState("");
  const [original, setOriginal] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const dirty = text !== original;

  useEffect(() => {
    let cancelled = false;
    if (tooLarge) return;
    fs.read(entry.path)
      .then((bytes) => {
        if (cancelled) return;
        if (bytes.subarray(0, 8192).includes(0)) {
          setState({ kind: "unsupported", message: "This looks like a binary file. Download it instead." });
          return;
        }
        const content = new TextDecoder().decode(bytes);
        setText(content);
        setOriginal(content);
        setState({ kind: "ready" });
        requestAnimationFrame(() => areaRef.current?.focus());
      })
      .catch((e) => !cancelled && setState({ kind: "error", message: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [entry, fs, tooLarge]);

  const save = useCallback(async () => {
    if (state.kind !== "ready" || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await fs.write(entry.path, text);
      setOriginal(text);
      setSavedAt(Date.now());
      onSaved();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [entry.path, fs, onSaved, saving, state.kind, text]);

  const close = useCallback(() => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    onClose();
  }, [dirty, onClose]);

  const lines = text ? text.split("\n").length : 0;

  return (
    <Modal
      wide
      onClose={close}
      title={
        <span className="flex items-center gap-2">
          <span className="text-muted">Edit</span>
          <span className="truncate font-mono text-[13px]">{entry.path}</span>
          {dirty && <span className="h-2 w-2 rounded-full bg-warn" aria-label="Unsaved changes" />}
        </span>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {state.kind === "loading" && <p className="p-6 text-sm text-muted">Loading…</p>}
        {state.kind === "error" && <p className="p-6 text-sm text-danger">{state.message}</p>}
        {state.kind === "unsupported" && (
          <div className="flex items-center justify-between gap-4 p-6 text-sm text-muted">
            <span>{state.message}</span>
            <Button onClick={onDownload}>Download</Button>
          </div>
        )}
        {state.kind === "ready" && (
          <textarea
            ref={areaRef}
            value={text}
            data-testid="editor"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
                e.preventDefault();
                void save();
              } else if (e.key === "Tab" && !e.shiftKey) {
                e.preventDefault();
                const el = e.currentTarget;
                const { selectionStart: s, selectionEnd: end } = el;
                setText(text.slice(0, s) + "  " + text.slice(end));
                requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
              }
            }}
            spellCheck={false}
            className="h-[60vh] w-full resize-none bg-bg p-4 font-mono text-[13px] leading-relaxed text-text outline-none"
          />
        )}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-xs text-muted">
        <span>
          {state.kind === "ready" && `${lines} lines · `}
          {saveError ? (
            <span className="text-danger">{saveError}</span>
          ) : savedAt && !dirty ? (
            <span className="text-accent">Saved</span>
          ) : (
            "Ctrl+S to save · Esc to close"
          )}
        </span>
        <div className="flex gap-2">
          <Button onClick={close}>Close</Button>
          <Button variant="primary" onClick={() => void save()} disabled={state.kind !== "ready" || !dirty || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
