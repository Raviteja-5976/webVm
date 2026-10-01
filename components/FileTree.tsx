"use client";

import { useState, type DragEvent } from "react";
import {
  ChevronRight,
  Download,
  File,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  Link2,
  LoaderCircle,
  Pencil,
  Trash2,
} from "lucide-react";
import type { VmEntry } from "@/lib/emulator/types";

export const DRAG_MIME = "application/x-sandbox-path";

export interface TreeState {
  children: Record<string, VmEntry[] | undefined>;
  expanded: Set<string>;
  loading: Set<string>;
  errors: Record<string, string | undefined>;
}

export interface TreeActions {
  toggle(entry: VmEntry): void;
  open(entry: VmEntry): void;
  select(path: string): void;
  rename(entry: VmEntry): void;
  remove(entry: VmEntry): void;
  download(entry: VmEntry): void;
  drop(targetDir: string, e: DragEvent): void;
}

const isDir = (e: VmEntry) => e.type === "dir" || !!e.linkToDir;

export function FileTree({
  dir,
  depth,
  state,
  actions,
  selected,
  showHidden,
}: {
  dir: string;
  depth: number;
  state: TreeState;
  actions: TreeActions;
  selected: string | null;
  showHidden: boolean;
}) {
  const entries = state.children[dir];
  const error = state.errors[dir];
  if (error) {
    return (
      <div className="py-1 text-xs text-danger" style={{ paddingLeft: 12 + depth * 14 }}>
        {error}
      </div>
    );
  }
  if (!entries) return null;
  const visible = showHidden ? entries : entries.filter((e) => !e.name.startsWith("."));
  if (!visible.length && depth > 0) {
    return (
      <div className="py-1 text-xs text-faint italic" style={{ paddingLeft: 30 + depth * 14 }}>
        empty
      </div>
    );
  }
  return (
    <ul role={depth === 0 ? "tree" : "group"} aria-label={depth === 0 ? "Files" : undefined}>
      {visible.map((entry) => (
        <TreeRow
          key={entry.path}
          entry={entry}
          depth={depth}
          state={state}
          actions={actions}
          selected={selected}
          showHidden={showHidden}
        />
      ))}
    </ul>
  );
}

function TreeRow({
  entry,
  depth,
  state,
  actions,
  selected,
  showHidden,
}: {
  entry: VmEntry;
  depth: number;
  state: TreeState;
  actions: TreeActions;
  selected: string | null;
  showHidden: boolean;
}) {
  const [dropping, setDropping] = useState(false);
  const dir = isDir(entry);
  const expanded = dir && state.expanded.has(entry.path);
  const loading = state.loading.has(entry.path);
  const isSelected = selected === entry.path;

  const acceptsDrop = (e: DragEvent) =>
    dir && (e.dataTransfer.types.includes(DRAG_MIME) || e.dataTransfer.types.includes("Files"));

  return (
    <li role="treeitem" aria-expanded={dir ? expanded : undefined} aria-selected={isSelected}>
      <div
        data-path={entry.path}
        data-testid="file-row"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_MIME, entry.path);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          if (!acceptsDrop(e)) return;
          e.preventDefault();
          e.stopPropagation();
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(e) => {
          if (!acceptsDrop(e)) return;
          e.preventDefault();
          e.stopPropagation();
          setDropping(false);
          actions.drop(entry.path, e);
        }}
        onClick={() => {
          actions.select(entry.path);
          if (dir) actions.toggle(entry);
        }}
        onDoubleClick={() => actions.open(entry)}
        className={`group flex h-7 cursor-default items-center gap-1.5 pr-1 text-[13px] select-none ${
          dropping
            ? "bg-accent/15 outline-1 outline-accent/60 -outline-offset-1"
            : isSelected
              ? "bg-raised"
              : "hover:bg-panel-2"
        }`}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <span className="flex w-3.5 shrink-0 justify-center text-faint">
          {loading ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          ) : dir ? (
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-90" : ""}`} />
          ) : null}
        </span>
        <EntryIcon entry={entry} expanded={expanded} />
        <span className={`min-w-0 flex-1 truncate ${entry.name.startsWith(".") ? "text-muted" : ""}`}>{entry.name}</span>

        <span className="hidden shrink-0 items-center group-hover:flex group-focus-within:flex">
          <RowButton label={`Rename ${entry.name}`} onClick={() => actions.rename(entry)}>
            <Pencil className="h-3.5 w-3.5" />
          </RowButton>
          <RowButton label={`Download ${entry.name}`} onClick={() => actions.download(entry)}>
            <Download className="h-3.5 w-3.5" />
          </RowButton>
          <RowButton label={`Delete ${entry.name}`} onClick={() => actions.remove(entry)} danger>
            <Trash2 className="h-3.5 w-3.5" />
          </RowButton>
        </span>
        <span className="w-14 shrink-0 text-right font-mono text-[11px] text-faint tabular-nums group-hover:hidden">
          {dir ? "" : formatSize(entry.size)}
        </span>
        <span
          className="w-12 shrink-0 text-right font-mono text-[11px] text-faint tabular-nums group-hover:hidden"
          title={new Date(entry.mtime).toLocaleString()}
        >
          {formatAge(entry.mtime)}
        </span>
      </div>
      {expanded && (
        <FileTree
          dir={entry.path}
          depth={depth + 1}
          state={state}
          actions={actions}
          selected={selected}
          showHidden={showHidden}
        />
      )}
    </li>
  );
}

function RowButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-line ${
        danger ? "hover:text-danger" : "hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

function EntryIcon({ entry, expanded }: { entry: VmEntry; expanded: boolean }) {
  const cls = "h-4 w-4 shrink-0";
  if (entry.type === "symlink" && !entry.linkToDir) return <Link2 className={`${cls} text-info`} />;
  if (isDir(entry))
    return expanded ? <FolderOpen className={`${cls} text-warn`} /> : <Folder className={`${cls} text-warn`} />;
  if (/\.(sh|py|js|ts|c|h|go|rs|rb|pl|json|ya?ml|toml)$/i.test(entry.name))
    return <FileCode2 className={`${cls} text-accent`} />;
  if (/\.(txt|md|log|csv|cfg|conf|ini)$/i.test(entry.name) || /^[A-Z]+(\.[a-z]+)?$/.test(entry.name))
    return <FileText className={`${cls} text-muted`} />;
  return <File className={`${cls} text-muted`} />;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

export function formatAge(mtime: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - mtime) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  return new Date(mtime).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
