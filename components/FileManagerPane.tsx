"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { ArrowUp, Eye, EyeOff, FilePlus2, FolderPlus, House, RefreshCw, Upload } from "lucide-react";
import { VM_USER } from "@/lib/config";
import type { VmEntry, VmFileSystem } from "@/lib/emulator/types";
import { basename, dirname, joinPath, validateName } from "@/lib/fs-bridge";
import { useSandbox, useSettings } from "@/lib/store";
import { ConfirmDialog, IconButton, PromptDialog } from "./Dialog";
import { FileEditorDialog } from "./FileEditorDialog";
import { DRAG_MIME, FileTree, type TreeActions, type TreeState } from "./FileTree";

type DialogState =
  | { kind: "new-file" | "new-folder"; dir: string }
  | { kind: "rename"; entry: VmEntry }
  | { kind: "delete"; entry: VmEntry };

type Notice = { kind: "info" | "error" | "success"; text: string } | null;

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

const emptyTree = (): TreeState => ({ children: {}, expanded: new Set(), loading: new Set(), errors: {} });
const isDirEntry = (e: VmEntry) => e.type === "dir" || !!e.linkToDir;
const within = (path: string, dir: string) => path === dir || path.startsWith(dir === "/" ? "/" : dir + "/");

export default function FileManagerPane() {
  const session = useSandbox((s) => s.session);
  const running = useSandbox((s) => s.status === "running");
  const fs = running && session ? session.adapter.fs : null;
  // Keyed by session: a new sandbox gets a fresh tree, selection and dialogs.
  return <FileManager key={fs && session ? session.id : "offline"} fs={fs} />;
}

function FileManager({ fs }: { fs: VmFileSystem | null }) {
  const fsVersion = useSandbox((s) => s.fsVersion);
  const bumpFs = useSandbox((s) => s.bumpFs);
  const showHidden = useSettings((s) => s.showHidden);
  const setShowHidden = useSettings((s) => s.setShowHidden);

  const [root, setRoot] = useState<string>(VM_USER.home);
  const [tree, setTree] = useState<TreeState>(emptyTree);
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [editing, setEditing] = useState<VmEntry | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [rootDrop, setRootDrop] = useState(false);
  const treeRef = useRef(tree);
  useLayoutEffect(() => {
    treeRef.current = tree;
  });
  const uploadRef = useRef<HTMLInputElement>(null);

  const flash = useCallback((n: Notice, ms = 3500) => {
    setNotice(n);
    if (n && n.kind !== "error") setTimeout(() => setNotice((cur) => (cur === n ? null : cur)), ms);
  }, []);

  const loadDir = useCallback(
    async (path: string) => {
      if (!fs) return;
      setTree((t) => ({ ...t, loading: new Set(t.loading).add(path) }));
      let entries: VmEntry[] | undefined;
      let error: string | undefined;
      try {
        entries = await fs.list(path);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      setTree((t) => {
        const loading = new Set(t.loading);
        loading.delete(path);
        return {
          ...t,
          loading,
          children: entries ? { ...t.children, [path]: entries } : t.children,
          errors: { ...t.errors, [path]: error },
        };
      });
    },
    [fs],
  );

  const refreshAll = useCallback(async () => {
    const { expanded } = treeRef.current;
    const dirs = [root, ...[...expanded].filter((p) => p !== root && within(p, root))];
    for (const dir of dirs) await loadDir(dir);
  }, [root, loadDir]);

  // Something changed in the VM (terminal command settled, or our own edit).
  useEffect(() => {
    if (fs && fsVersion) void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fsVersion]);

  // Load the root on mount and whenever the user navigates to another folder.
  useEffect(() => {
    if (!treeRef.current.children[root]) void loadDir(root);
  }, [root, loadDir]);

  const findEntry = useCallback(
    (path: string | null) => (path ? tree.children[dirname(path)]?.find((e) => e.path === path) ?? null : null),
    [tree.children],
  );

  /** Where "new file", "new folder" and uploads go: the selected folder, or the selected file's folder. */
  const targetDir = useMemo(() => {
    const entry = findEntry(selected);
    if (!entry) return root;
    return isDirEntry(entry) ? entry.path : dirname(entry.path);
  }, [findEntry, selected, root]);

  const expand = (path: string) => setTree((t) => ({ ...t, expanded: new Set(t.expanded).add(path) }));

  const guard = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      flash({ kind: "error", text: `${label}: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  const download = useCallback(
    (entry: VmEntry) =>
      guard("Download failed", async () => {
        if (!fs) return;
        const dir = isDirEntry(entry);
        if (dir && !fs.archive) throw new Error("This engine cannot archive folders");
        flash({ kind: "info", text: `Preparing ${entry.name}${dir ? ".tar.gz" : ""}…` });
        const bytes = dir ? await fs.archive!(entry.path) : await fs.read(entry.path);
        saveBlob(new Blob([bytes as BlobPart]), dir ? `${entry.name}.tar.gz` : entry.name);
        flash({ kind: "success", text: `Downloaded ${entry.name}${dir ? ".tar.gz" : ""}` });
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fs, flash],
  );

  const uploadFiles = async (dir: string, files: File[]) => {
    if (!fs || !files.length) return;
    await guard("Upload failed", async () => {
      for (const [i, file] of files.entries()) {
        const problem = validateName(file.name);
        if (problem) throw new Error(`${file.name}: ${problem}`);
        if (file.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name} is larger than 200 MB`);
        flash({ kind: "info", text: `Uploading ${file.name}${files.length > 1 ? ` (${i + 1}/${files.length})` : ""}…` });
        await fs.write(joinPath(dir, file.name), new Uint8Array(await file.arrayBuffer()));
      }
      if (dir !== root) expand(dir);
      flash({ kind: "success", text: `Uploaded ${files.length === 1 ? files[0].name : `${files.length} files`}` });
      bumpFs();
    });
  };

  const move = async (src: string, destDir: string) => {
    if (!fs) return;
    const dest = joinPath(destDir, basename(src));
    if (dest === src || dirname(src) === destDir) return;
    await guard("Move failed", async () => {
      await fs.rename(src, dest);
      setTree((t) => ({ ...t, expanded: new Set([...t.expanded].map((p) => (within(p, src) ? dest + p.slice(src.length) : p))) }));
      setSelected(dest);
      bumpFs();
    });
  };

  const handleDrop = (dir: string, e: DragEvent) => {
    const internal = e.dataTransfer.getData(DRAG_MIME);
    if (internal) void move(internal, dir);
    else if (e.dataTransfer.files.length) void uploadFiles(dir, [...e.dataTransfer.files]);
  };

  const actions: TreeActions = {
    toggle(entry) {
      if (tree.expanded.has(entry.path)) {
        setTree((t) => {
          const expanded = new Set(t.expanded);
          expanded.delete(entry.path);
          return { ...t, expanded };
        });
      } else {
        expand(entry.path);
        void loadDir(entry.path);
      }
    },
    open(entry) {
      if (isDirEntry(entry)) setRoot(entry.path);
      else setEditing(entry);
    },
    select: setSelected,
    rename: (entry) => setDialog({ kind: "rename", entry }),
    remove: (entry) => setDialog({ kind: "delete", entry }),
    download: (entry) => void download(entry),
    drop: handleDrop,
  };

  const onTreeKeyDown = (e: React.KeyboardEvent) => {
    const entry = findEntry(selected);
    if (!entry || dialog || editing) return;
    if (e.key === "F2") actions.rename(entry);
    else if (e.key === "Delete") actions.remove(entry);
    else if (e.key === "Enter") actions.open(entry);
    else return;
    e.preventDefault();
  };

  const crumbs = root.split("/").filter(Boolean);
  const disabled = !fs;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="file-manager">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 border-b border-line px-2 py-1.5">
        <IconButton label="New file" disabled={disabled} onClick={() => setDialog({ kind: "new-file", dir: targetDir })}>
          <FilePlus2 className="h-4 w-4" />
        </IconButton>
        <IconButton label="New folder" disabled={disabled} onClick={() => setDialog({ kind: "new-folder", dir: targetDir })}>
          <FolderPlus className="h-4 w-4" />
        </IconButton>
        <IconButton label="Upload files" disabled={disabled} onClick={() => uploadRef.current?.click()}>
          <Upload className="h-4 w-4" />
        </IconButton>
        <input
          ref={uploadRef}
          type="file"
          multiple
          hidden
          data-testid="upload-input"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            void uploadFiles(targetDir, files);
          }}
        />
        <div className="mx-1 h-4 w-px bg-line" />
        <IconButton label="Refresh" disabled={disabled} onClick={() => void refreshAll()}>
          <RefreshCw className={`h-4 w-4 ${tree.loading.size ? "animate-spin" : ""}`} />
        </IconButton>
        <IconButton label={showHidden ? "Hide dotfiles" : "Show dotfiles"} onClick={() => setShowHidden(!showHidden)}>
          {showHidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </IconButton>
        <div className="flex-1" />
        <IconButton label="Home folder" disabled={disabled || root === VM_USER.home} onClick={() => setRoot(VM_USER.home)}>
          <House className="h-4 w-4" />
        </IconButton>
        <IconButton label="Up one level" disabled={disabled || root === "/"} onClick={() => setRoot(dirname(root))}>
          <ArrowUp className="h-4 w-4" />
        </IconButton>
      </div>

      {/* Breadcrumb */}
      <nav aria-label="Path" className="flex items-center gap-0.5 overflow-x-auto border-b border-line px-2 py-1 font-mono text-xs whitespace-nowrap text-muted">
        <button className="rounded px-1 py-0.5 hover:bg-raised hover:text-text" onClick={() => setRoot("/")} disabled={disabled}>
          /
        </button>
        {crumbs.map((part, i) => {
          const path = "/" + crumbs.slice(0, i + 1).join("/");
          const last = i === crumbs.length - 1;
          return (
            <span key={path} className="flex items-center gap-0.5">
              {i > 0 && <span className="text-faint">/</span>}
              <button
                className={`rounded px-1 py-0.5 hover:bg-raised hover:text-text ${last ? "text-text" : ""}`}
                onClick={() => setRoot(path)}
                disabled={disabled}
                aria-current={last ? "location" : undefined}
              >
                {part}
              </button>
            </span>
          );
        })}
      </nav>

      {/* Column header */}
      <div className="flex items-center gap-1.5 border-b border-line px-2 py-1 text-[11px] tracking-wide text-faint uppercase">
        <span className="flex-1 pl-5">Name</span>
        <span className="w-14 text-right">Size</span>
        <span className="w-12 text-right">Mod.</span>
      </div>

      {/* Tree + root drop zone */}
      <div
        className={`relative min-h-0 flex-1 overflow-auto py-1 outline-none ${rootDrop ? "bg-accent/5 ring-1 ring-accent/50 ring-inset" : ""}`}
        tabIndex={0}
        onKeyDown={onTreeKeyDown}
        onDragOver={(e) => {
          if (disabled) return;
          if (!e.dataTransfer.types.includes("Files") && !e.dataTransfer.types.includes(DRAG_MIME)) return;
          e.preventDefault();
          setRootDrop(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setRootDrop(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setRootDrop(false);
          if (!disabled) handleDrop(root, e);
        }}
        data-testid="file-drop-zone"
      >
        {!fs ? (
          <p className="px-4 py-6 text-center text-xs text-faint">Files appear here once the sandbox is running.</p>
        ) : (
          <>
            <FileTree dir={root} depth={0} state={tree} actions={actions} selected={selected} showHidden={showHidden} />
            {tree.children[root]?.length === 0 && <p className="px-4 py-6 text-center text-xs text-faint">This folder is empty.</p>}
            <p className="px-4 pt-4 pb-2 text-center text-[11px] text-faint">Drop files here to upload into {root === VM_USER.home ? "~" : basename(root) || "/"}</p>
          </>
        )}
      </div>

      {notice && (
        <div
          role="status"
          className={`flex items-start gap-2 border-t border-line px-3 py-2 text-xs ${
            notice.kind === "error" ? "text-danger" : notice.kind === "success" ? "text-accent" : "text-muted"
          }`}
        >
          <span className="flex-1 break-words">{notice.text}</span>
          {notice.kind === "error" && (
            <button className="text-muted hover:text-text" onClick={() => setNotice(null)} aria-label="Dismiss">
              ×
            </button>
          )}
        </div>
      )}

      {fs && dialog?.kind === "new-file" && (
        <PromptDialog
          title="New file"
          label={`In ${dialog.dir}`}
          confirmLabel="Create"
          validate={(v) => validateName(v) ?? (tree.children[dialog.dir]?.some((e) => e.name === v) ? "That name is taken" : null)}
          onSubmit={async (name) => {
            const path = joinPath(dialog.dir, name);
            await fs.write(path, "");
            if (dialog.dir !== root) expand(dialog.dir);
            setSelected(path);
            bumpFs();
            setEditing({ name, path, type: "file", size: 0, mtime: Date.now() });
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {fs && dialog?.kind === "new-folder" && (
        <PromptDialog
          title="New folder"
          label={`In ${dialog.dir}`}
          confirmLabel="Create"
          validate={(v) => validateName(v) ?? (tree.children[dialog.dir]?.some((e) => e.name === v) ? "That name is taken" : null)}
          onSubmit={async (name) => {
            const path = joinPath(dialog.dir, name);
            await fs.mkdir(path);
            if (dialog.dir !== root) expand(dialog.dir);
            setSelected(path);
            bumpFs();
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {fs && dialog?.kind === "rename" && (
        <PromptDialog
          title="Rename"
          label={dialog.entry.path}
          initial={dialog.entry.name}
          confirmLabel="Rename"
          validate={validateName}
          onSubmit={async (name) => {
            const src = dialog.entry.path;
            const dest = joinPath(dirname(src), name);
            await fs.rename(src, dest);
            setTree((t) => ({ ...t, expanded: new Set([...t.expanded].map((p) => (within(p, src) ? dest + p.slice(src.length) : p))) }));
            setSelected(dest);
            bumpFs();
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {fs && dialog?.kind === "delete" && (
        <ConfirmDialog
          title={`Delete ${isDirEntry(dialog.entry) ? "folder" : "file"}?`}
          danger
          confirmLabel="Delete"
          message={
            <>
              <span className="font-mono text-text">{dialog.entry.path}</span>
              {dialog.entry.type === "dir" ? " and everything inside it" : ""} will be permanently deleted.
            </>
          }
          onConfirm={async () => {
            await fs.remove(dialog.entry.path, { recursive: dialog.entry.type === "dir" });
            if (selected && within(selected, dialog.entry.path)) setSelected(null);
            bumpFs();
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {fs && editing && (
        <FileEditorDialog
          key={editing.path}
          entry={editing}
          fs={fs}
          onClose={() => setEditing(null)}
          onSaved={bumpFs}
          onDownload={() => void download(editing)}
        />
      )}
    </div>
  );
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
