# Browser Linux Sandbox: Build Spec for AI Coding Agents

A complete build guide for a **client-side Linux sandbox** that runs entirely in the browser, launches instantly, is deleted when stopped, has a terminal UI plus a file manager, and is hosted as a **Next.js** project.

> How to use this file: give it to an AI coding agent (Claude Code, Cursor, etc.) and tell it to "implement Phase 1, then stop and wait." Work phase by phase. Each phase has a goal, tasks, and acceptance criteria. Verify APIs against the current docs linked in the References section before coding, because emulator APIs change between versions.

---

## 1. Goal

Let any visitor click **Launch** and get a real Linux shell in their browser tab:

- No server-side compute per user. Everything runs in the user's browser (WebAssembly).
- Launch feels instant. First visit may download the image, repeat visits should be near-instant.
- **Ephemeral**: when the user clicks **Stop** (or closes the tab), the sandbox and all its changes are destroyed.
- Terminal-like UI with a **file manager** side panel.
- Good for learning: Linux commands, bash scripting, git, and general terminal workflows.
- Deployable as a Next.js app (static export or Vercel).

## 2. Non-goals

- Heavy compilation, Docker-in-VM, GPU, or long-running server workloads.
- Persistent user workspaces (this version is ephemeral by design).
- Real internet access from inside the VM in v1 (see Networking).

---

## 3. Technology Decision

| Layer | Choice | Why |
|---|---|---|
| Emulator (primary) | **CheerpX** (Leaning Technologies, the engine behind WebVM) | Runs unmodified 32-bit x86 Debian userland, fast JIT to WebAssembly, streamed disk, real bash/git/coreutils |
| Emulator (fallback) | **v86** | Fully open source (BSD), snapshot restore, 9p filesystem, slower |
| Terminal UI | **xterm.js** (`@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`) | Standard terminal renderer |
| Framework | **Next.js (App Router) + TypeScript** | Requested hosting target |
| Styling | Tailwind CSS | Fast UI work |
| State | Zustand (or React context) | Small, simple session state |
| Disk image | Debian (i386) ext2 image on a CDN | Streamed in blocks, cached by the browser |

**Licensing note:** CheerpX is free for non-commercial and evaluation use and requires a commercial license for commercial products. Check the current terms before launching a paid product. v86 avoids this but is slower and less compatible. Design the code behind an **`EmulatorAdapter` interface** so the engine can be swapped.

---

## 4. Architecture

```
Browser tab
├── Next.js client app
│   ├── LaunchScreen       (Launch / Stop buttons, status)
│   ├── SandboxShell       (layout: file manager | terminal)
│   ├── TerminalPane       (xterm.js)
│   ├── FileManagerPane    (tree, upload, download, rename, delete, edit)
│   └── SessionManager     (lifecycle: create, run, destroy)
│
├── EmulatorAdapter (interface)
│   └── CheerpXAdapter     (default implementation)
│
└── Storage
    ├── Base disk image    (read-only, streamed over HTTP range requests from CDN)
    └── Session overlay    (writable, per-session, destroyed on stop)
```

**Key idea for ephemerality:** the base image is never modified. All writes go to a per-session copy-on-write overlay stored in IndexedDB under a unique session ID. On stop, delete that IndexedDB database. The next launch starts from the pristine image.

---

## 5. Project Structure

```
browser-linux/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                  # landing + launch
│   └── sandbox/page.tsx          # sandbox route (client only)
├── components/
│   ├── LaunchScreen.tsx
│   ├── SandboxShell.tsx
│   ├── TerminalPane.tsx
│   ├── FileManagerPane.tsx
│   ├── FileTree.tsx
│   ├── FileEditorDialog.tsx
│   └── StatusBar.tsx
├── lib/
│   ├── emulator/
│   │   ├── types.ts              # EmulatorAdapter interface
│   │   ├── cheerpx-adapter.ts    # CheerpX implementation
│   │   └── v86-adapter.ts        # optional fallback
│   ├── session.ts                # session lifecycle + cleanup
│   ├── fs-bridge.ts              # file manager <-> VM filesystem
│   └── config.ts                 # image URL, resource limits
├── public/
│   └── (no big files here; host the image on a CDN)
├── image/
│   ├── Dockerfile                # builds the Debian rootfs
│   ├── build-ext2.sh             # converts rootfs to ext2 image
│   └── README.md
├── next.config.js                # COOP/COEP headers
├── package.json
└── BUILD_BROWSER_LINUX_SANDBOX.md
```

---

## 6. Phased Build Plan

### Phase 0: Project setup

**Tasks**
1. `npx create-next-app@latest browser-linux --typescript --tailwind --app`
2. Install: `@xterm/xterm @xterm/addon-fit @xterm/addon-web-links zustand`
3. Add the CheerpX loader (see Phase 2 for the exact import approach).
4. Configure cross-origin isolation headers in `next.config.js`:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
};
module.exports = nextConfig;
```

**Acceptance:** `window.crossOriginIsolated === true` in the browser console.

> If you use `output: "export"` (static export), `headers()` does not apply. Set these headers at your host instead (Vercel `vercel.json`, Netlify `_headers`, Cloudflare Pages `_headers`, or nginx).

---

### Phase 1: Terminal UI (no VM yet)

**Goal:** a working terminal component wired to a fake echo backend, so the UI is solid before the emulator is added.

**Tasks**
1. Build `TerminalPane` with xterm.js, dynamically imported with `ssr: false` (xterm touches `window`).
2. Use `FitAddon` and a `ResizeObserver` so the terminal fills its container and resizes with the window.
3. Define the adapter interface in `lib/emulator/types.ts`:

```ts
export interface EmulatorAdapter {
  /** Boot the VM. Resolves when a shell is ready. */
  start(opts: StartOptions): Promise<void>;
  /** Send raw input (keystrokes) from the terminal to the VM. */
  write(data: string): void;
  /** Register a callback for VM output (bytes/strings to render). */
  onOutput(cb: (data: string | Uint8Array) => void): void;
  /** Inform the VM of terminal size changes. */
  resize(cols: number, rows: number): void;
  /** File operations used by the file manager. */
  fs: VmFileSystem;
  /** Stop the VM and destroy all session data. */
  destroy(): Promise<void>;
}

export interface StartOptions {
  cols: number;
  rows: number;
  onProgress?: (p: { phase: string; percent?: number }) => void;
}

export interface VmFileSystem {
  list(path: string): Promise<VmEntry[]>;
  read(path: string): Promise<Uint8Array>;
  write(path: string, data: Uint8Array | string): Promise<void>;
  mkdir(path: string): Promise<void>;
  remove(path: string, opts?: { recursive?: boolean }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

export interface VmEntry {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink";
  size: number;
  mtime: number;
}
```

4. Create a `MockAdapter` that echoes input, to test the UI.

**Acceptance:** typing in the terminal works, resize works, theme looks like a real terminal (dark background, monospace font, block cursor, copy/paste works).

---

### Phase 2: Boot Linux with CheerpX

**Goal:** a real bash prompt in the browser.

**Tasks**
1. Load CheerpX in a client-only module. CheerpX is distributed as an ES module from Leaning Technologies' CDN (check the current URL and version in the docs), for example:

```ts
const { default: CheerpX } = await import(
  /* webpackIgnore: true */ "https://cxrtnc.leaningtech.com/<VERSION>/cx.esm.js"
);
```

   Pin the version. Do not use "latest".

2. Create devices and mount them. The general shape (confirm exact names in the CheerpX docs):

```ts
// Read-only base image, streamed via HTTP range requests
const blockDevice = await CheerpX.HttpBytesDevice.create(IMAGE_URL);

// Per-session writable layer in IndexedDB (unique name per session)
const idb = await CheerpX.IDBDevice.create(`sandbox-${sessionId}`);

// Copy-on-write overlay: reads from base, writes go to IDB
const overlay = await CheerpX.OverlayDevice.create(blockDevice, idb);

const vm = await CheerpX.Linux.create({
  mounts: [
    { type: "ext2", path: "/", dev: overlay },
    { type: "devs", path: "/dev" },
    { type: "devpts", path: "/dev/pts" },
    { type: "proc", path: "/proc" },
    { type: "sys", path: "/sys" },
  ],
});
```

3. Connect the terminal. Use the custom console API so xterm.js is in control, rather than CheerpX's built-in console element. It provides an output callback and returns an input function:

```ts
const send = vm.setCustomConsole(
  (buf: Uint8Array) => term.write(buf),
  term.cols,
  term.rows
);
term.onData((d) => send(d.charCodeAt ? /* encode to keycodes/bytes as the API requires */ d : d));
```

4. Start a login shell:

```ts
await vm.run("/bin/bash", ["--login"], {
  env: ["HOME=/home/user", "TERM=xterm-256color", "USER=user", "SHELL=/bin/bash", "LANG=C.UTF-8"],
  cwd: "/home/user",
  uid: 1000,
  gid: 1000,
});
```

5. Wrap all of this in `CheerpXAdapter implements EmulatorAdapter`.
6. Show boot progress in the UI ("Downloading image", "Booting", "Ready").

**Acceptance:** clicking Launch shows a working prompt; `ls`, `cd`, `cat`, `echo`, `vim`/`nano`, `git --version` all work.

---

### Phase 3: Build the disk image

**Goal:** a Debian image with everything a learner needs, hosted on a CDN.

CheerpX runs 32-bit x86 Linux, so build an **i386** Debian rootfs.

**`image/Dockerfile`** (starting point; adjust package list):

```dockerfile
FROM --platform=linux/386 i386/debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash coreutils util-linux procps findutils grep sed gawk less man-db manpages \
    git nano vim-tiny tree tmux curl wget ca-certificates \
    python3 jq zip unzip tar gzip bzip2 xz-utils \
    make gcc libc6-dev \
    sudo locales \
  && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash -u 1000 user \
 && echo "user ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/user

# Learning content
COPY lessons/ /home/user/lessons/
RUN chown -R user:user /home/user

# Friendly prompt
RUN echo 'PS1="\[\e[1;32m\]\u@sandbox\[\e[0m\]:\[\e[1;34m\]\w\[\e[0m\]\$ "' >> /home/user/.bashrc \
 && git config --system init.defaultBranch main \
 && git config --system user.name "Learner" \
 && git config --system user.email "learner@example.com"

USER user
WORKDIR /home/user
```

**`image/build-ext2.sh`**:

```bash
#!/usr/bin/env bash
set -euo pipefail

docker build --platform linux/386 -t browser-linux-rootfs .
CID=$(docker create --platform linux/386 browser-linux-rootfs)
mkdir -p rootfs && docker export "$CID" | tar -x -C rootfs
docker rm "$CID"

# Size the image with headroom, then populate it from the directory
truncate -s 900M rootfs.ext2
mkfs.ext2 -b 4096 -d rootfs rootfs.ext2
echo "Built rootfs.ext2"
```

**Hosting the image**
- Upload `rootfs.ext2` to a CDN or object storage (Cloudflare R2, S3 + CloudFront, Bunny).
- The server **must support HTTP range requests** (`Accept-Ranges: bytes`).
- Set CORS to allow your site origin, and because of COEP, send `Cross-Origin-Resource-Policy: cross-origin` on the image response.
- Set long cache headers (`Cache-Control: public, max-age=31536000, immutable`) and version the filename (`rootfs-v1.ext2`) so updates are safe.

**Keep the image small:** strip docs you do not need, clear apt caches, avoid large toolchains. A smaller image means a faster first launch.

**Acceptance:** the VM boots from your hosted image, and `git`, `python3`, `tree`, `jq`, `tmux` are all present.

---

### Phase 4: Ephemeral session lifecycle

**Goal:** instant launch, guaranteed cleanup on stop.

**`lib/session.ts` responsibilities**
1. `createSession()`: generate a unique `sessionId` (`crypto.randomUUID()`), create the adapter, boot.
2. `destroySession()`: stop the VM, then delete the session's IndexedDB database:

```ts
await new Promise<void>((resolve, reject) => {
  const req = indexedDB.deleteDatabase(`sandbox-${sessionId}`);
  req.onsuccess = () => resolve();
  req.onerror = () => reject(req.error);
  req.onblocked = () => resolve(); // connection still closing; retry below
});
```

   Make sure the VM has released its connection first, and retry once after a short delay if `onblocked` fires.

3. **Orphan cleanup on load:** if the tab was closed without stopping, the leftover `sandbox-*` databases stay around. On app start, list them with `indexedDB.databases()` and delete any that do not belong to the current session.
4. Handle `beforeunload` / `pagehide` for best-effort cleanup, but do **not** rely on it. Orphan cleanup on next load is the real guarantee.
5. **Single active session per tab.** Launching again after Stop always creates a brand-new sandbox from the pristine image.

**Making launch feel instant**
- Start prefetching CheerpX and the first blocks of the image when the landing page loads (`<link rel="modulepreload">` and an early `fetch` of the image's first range).
- Show the terminal UI immediately with a boot progress indicator instead of a blank screen.
- Pre-warm: create the CheerpX module on hover over the Launch button.
- Keep the image small and put the most-used files early in the ext2 layout (optional optimization).
- Repeat visits are fast because the browser caches image blocks.

**Acceptance:** Stop then Launch gives a clean filesystem (a file created earlier no longer exists). DevTools → Application → IndexedDB shows the session database removed after Stop.

---

### Phase 5: File manager

**Goal:** a side panel to browse and manage the VM filesystem.

**Features**
- Tree view starting at `/home/user`, lazy-loaded per directory.
- Create file, create folder, rename, delete (with confirmation), move via drag and drop.
- **Upload** from the user's computer into the VM (drag and drop onto the panel).
- **Download** a file (and download a folder as a zip, optional).
- Open a text file in a simple editor dialog (Monaco or a plain `<textarea>` in v1) and save back to the VM.
- Refresh button, plus auto-refresh after terminal commands settle (debounced).
- Breadcrumb path bar and file size/modified columns.

**Implementation approaches (pick the best available; verify against current docs)**

1. **Device/API route (preferred):** use the emulator's file APIs to read/write files directly, for example writing into a `DataDevice` or reading from the `IDBDevice` overlay. Some operations may not be exposed by the engine.
2. **Shell-command bridge (universal fallback):** run commands inside the VM in a **hidden secondary process** and parse the output. For example:
   - List: `ls -la --time-style=+%s -- "<path>"` or `find "<path>" -maxdepth 1 -printf '%y|%s|%T@|%f\n'`
   - Read: `base64 -- "<path>"` then decode in JS
   - Write: pipe base64 through `base64 -d > "<path>"` in chunks
   - Delete/rename/mkdir: `rm -rf`, `mv`, `mkdir -p`
   - **Always shell-escape paths** (use a single-quote escaping helper) to avoid injection from filenames.
   - Use a unique sentinel line (e.g. `__END_<uuid>__`) to detect command completion.
3. **Recommended:** implement approach 2 first because it works with any emulator, then swap in direct APIs where they are available.

Implement all of this in `lib/fs-bridge.ts` behind the `VmFileSystem` interface, so the UI never cares which approach is used.

**Acceptance:** upload a file, see it in the terminal with `ls`; create a file in the terminal, see it appear in the panel; edit and save a file in the editor, then `cat` it in the terminal; delete works both ways.

---

### Phase 6: Networking (optional in v1)

Browsers cannot open raw TCP/UDP sockets, so a VM inside the browser has no direct internet. Options:

| Option | Notes |
|---|---|
| **No network (v1 default)** | Simplest and safest. Preload sample git repos and files in the image so `git log`, `git branch`, `git merge` etc. can be practiced fully offline. |
| CheerpX networking | Uses a Tailscale-based relay for outbound access. Requires setup and a coordination account. Check the docs for the current status. |
| v86 network relay | WebSocket proxy to a relay server you run. Costs money and needs abuse protection. |

**Recommendation:** ship v1 offline, and teach `git` with local repos (`git init`, commit, branch, merge, rebase, remotes pointing at a local bare repo like `/home/user/remote.git`). Add networking later if needed.

---

### Phase 7: Learning features (optional but valuable)

- **Lessons sidebar:** markdown lessons ("Navigating the filesystem", "grep and pipes", "git basics", "bash scripting") stored in the app; each lesson has a **"Run in sandbox"** button that types a command into the terminal.
- **Task checks:** a hidden command run in the VM to verify the learner's work (for example `test -f ~/notes.txt && grep -q hello ~/notes.txt`), with a success indicator.
- **Reset button:** destroy and relaunch the sandbox in one click.
- **Preset environments:** "Git playground", "Bash scripting", "Linux basics" launching with different starter files.
- **Cheat sheet panel** for common commands.
- **Copy/paste, font size, and theme settings.**

---

### Phase 8: Polish, safety, deployment

**UX**
- Loading skeleton, error states ("Your browser doesn't support cross-origin isolation"), retry.
- Mobile: show a notice. Terminals on phones are poor and memory is limited. Desktop-first.
- Browser support check on load: needs WebAssembly, `SharedArrayBuffer`, IndexedDB. Chrome/Edge/Firefox desktop are the safest targets; test Safari separately.
- Keyboard shortcuts: `Ctrl+Shift+C/V` for copy/paste, a shortcut to focus the terminal.
- Idle timeout: optionally auto-stop after N minutes of inactivity to free memory.

**Security**
- The VM is sandboxed by the browser and WebAssembly. It cannot touch the host filesystem, only what the user explicitly uploads.
- Treat uploaded filenames and paths as untrusted; escape all shell input in the file bridge.
- Serve the app over HTTPS (required for cross-origin isolation in practice).
- Do not put secrets in the disk image; anyone can download it.
- If you add a network relay later, add rate limits and abuse controls.

**Deployment**
- **Vercel:** works well; set the COOP/COEP headers via `next.config.js` (works on the Node runtime) or `vercel.json`.
- **Static export:** `output: "export"` plus host-level headers.
- Host the disk image on a **separate CDN** (Vercel has file size limits and is not designed to serve a large image).
- Add an analytics event for launch, boot time, and stop.

**Testing**
- Unit tests for the shell-escaping helper and the ls/find output parser.
- Playwright end-to-end: launch → type `echo hi` → expect `hi` → create file via panel → `cat` it → stop → relaunch → file is gone.
- Measure: time to first prompt (cold and warm), memory use after 10 minutes.

---

## 7. Acceptance Checklist (Definition of Done)

- [ ] Runs fully in the browser; no per-user server compute.
- [ ] Launch shows a bash prompt with a progress indicator; warm launch is fast (target: a few seconds).
- [ ] Terminal is xterm.js: colors, resize, copy/paste, vim/nano work.
- [ ] git, bash scripting, coreutils, grep/sed/awk, tmux, python3 available.
- [ ] File manager: browse, create, rename, delete, upload, download, edit.
- [ ] Stop destroys the session; relaunch is pristine; orphaned session databases are cleaned on load.
- [ ] `EmulatorAdapter` abstraction allows swapping CheerpX and v86.
- [ ] Deployed on Next.js with correct COOP/COEP headers and a CDN-hosted image with range requests.
- [ ] Clear error UI for unsupported browsers.

---

## 8. Prompts to Give Your AI Coding Agent

Copy these one at a time.

**Kickoff**
> Read `BUILD_BROWSER_LINUX_SANDBOX.md` fully. We are building it phase by phase. Implement **Phase 0 and Phase 1 only**, then stop and summarize what you built and how to run it. Use Next.js App Router, TypeScript, Tailwind. Do not skip the `EmulatorAdapter` interface.

**Boot Linux**
> Implement **Phase 2**. Before writing code, open the current CheerpX documentation and confirm the exact API names for `HttpBytesDevice`, `IDBDevice`, `OverlayDevice`, `Linux.create`, `setCustomConsole`, and `run`. List any differences from the spec, then implement `CheerpXAdapter` accordingly. Pin the CheerpX version.

**Image**
> Implement **Phase 3**: the `image/` folder with the Dockerfile and `build-ext2.sh`, plus a short README on building and uploading it to a CDN with range-request and CORS support. Include a `lessons/` folder with 3 starter lessons.

**Lifecycle**
> Implement **Phase 4**. Add `lib/session.ts` with create/destroy, orphan cleanup using `indexedDB.databases()`, and prefetching so launch feels instant. Add a Playwright test that proves a file created before Stop is gone after relaunch.

**File manager**
> Implement **Phase 5** with the shell-command bridge in `lib/fs-bridge.ts`. Include a `shellQuote()` helper with unit tests, a sentinel-based command runner, chunked base64 upload, and download. Build `FileManagerPane` with tree, upload via drag and drop, rename, delete, and an editor dialog.

**Polish**
> Implement **Phase 8**: browser capability check, error states, idle timeout, deployment notes for Vercel, and a Playwright end-to-end suite. Report time-to-first-prompt for cold and warm loads.

**Review**
> Review the whole codebase against the Acceptance Checklist in the spec. List each item as pass/fail with evidence, and fix any failures.

---

## 9. Known Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Cold-start download of a large image | Keep image small, CDN with range requests, prefetch, show progress |
| CheerpX API changes | Pin the version, isolate behind `EmulatorAdapter`, read current docs before coding |
| CheerpX commercial licensing | Confirm terms before monetizing; keep v86 adapter as a fallback |
| No internet in the VM | Ship offline-first lessons with local git remotes; add a relay later |
| Cross-origin isolation breaks third-party embeds (ads, iframes, fonts) | Self-host assets, use `Cross-Origin-Resource-Policy` on your own resources |
| Safari/mobile quirks | Desktop-first, capability detection, clear messaging |
| Leftover session data | Orphan cleanup on load plus unique session IDs |
| High memory in long sessions | Idle timeout and a visible Stop/Reset button |

---

## 10. References (verify current versions before coding)

- CheerpX documentation and WebVM: https://cheerpx.io and https://github.com/leaningtech/webvm
- v86: https://github.com/copy/v86
- xterm.js: https://xtermjs.org
- Next.js headers config: https://nextjs.org/docs/app/api-reference/config/next-config-js/headers
- Cross-origin isolation guide: https://web.dev/articles/coop-coep
