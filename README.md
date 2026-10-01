# Browser Linux Sandbox

A real Debian shell that runs entirely in the browser tab (CheerpX, x86 → WebAssembly), with a file manager, guided lessons and an ephemeral session model: **Stop** destroys the VM and every change made in it. Built to the spec in [BUILD_BROWSER_LINUX_SANDBOX.md](BUILD_BROWSER_LINUX_SANDBOX.md).

- No per-user server compute. The site is static; the disk image streams from a CDN.
- Measured time to first prompt (Chromium, this machine): **cold ~9–11 s, warm ~1.7 s**.
- Terminal: xterm.js with resize, 256 colours, Ctrl+Shift+C/V, vim/nano, three themes and adjustable font size.
- File manager: browse, create, rename, move (drag and drop), delete, upload (drag and drop), download (folders as `.tar.gz`) and a text editor.
- Learning: 4 lessons with one-click "Run" steps and automatic task checks, a cheat sheet, and 4 preset workspaces (Linux basics, Git playground with a local remote, Bash scripting, Blank).

## Quick start

```bash
npm install
npm run dev            # http://localhost:3000
```

Open the page, pick a preset and press **Launch sandbox**. Add `?engine=mock` to the URL for a fake in-memory shell that boots instantly (UI work, tests).

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js (COOP/COEP headers included) |
| `npm run typecheck` / `lint` | TypeScript and ESLint |
| `npm test` | Unit tests (vitest). The shell tests run generated scripts through real bash |
| `npm run test:e2e` | Playwright against `next start`. Run `npm run build` first. Projects: `mock` (fast) and `vm` (real Linux, needs network) |
| `npm run serve:image` | Local CDN stand-in for a self-built disk image (range requests, CORS, CORP) |
| `npm run record:manifest` | Re-record the cold-boot chunk list (see Performance) |

## Configuration

All optional, read at build time:

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_IMAGE_URL` | public WebVM Debian image | Your ext2 image, e.g. `https://cdn.example/rootfs-v1.ext2` |
| `NEXT_PUBLIC_IMAGE_TYPE` | `cloud` for the default image, else `bytes` | `bytes` = HttpBytesDevice (any server with range requests), `cloud` = WebVM-style CloudDevice, `github` |
| `NEXT_PUBLIC_EMULATOR` | `cheerpx` | `cheerpx`, `v86` (experimental) or `mock` |
| `NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES` | `30` | Auto-stop after inactivity; `0` disables |
| `NEXT_PUBLIC_ANALYTICS_URL` | none | Receives `sandbox_launch`, `sandbox_ready` (with `bootMs`), `sandbox_stop` beacons |
| `NEXT_PUBLIC_V86_ASSETS_URL` | none | BIOS and kernel for the v86 engine |

## How it works

```
app/page.tsx            LaunchScreen: presets, capability check, prefetch + pre-warm
app/sandbox/page.tsx    SandboxShell (client only): StatusBar | Files/Lessons/Cheat sheet | TerminalPane
lib/store.ts            Zustand: launch/stop/reset lifecycle, one session per tab
lib/session.ts          create/boot/destroy, IndexedDB deletion, orphan cleanup, Web Locks
lib/emulator/types.ts   EmulatorAdapter + VmFileSystem interfaces
lib/emulator/*-adapter  CheerpX (default), v86 (experimental), Mock
lib/fs-bridge.ts        shellQuote, find parser, ShellFileSystem, SentinelCommandRunner
image/                  Dockerfile + build-ext2.sh for your own Debian i386 image
```

**Ephemerality.** The base image is read-only. Each session gets a copy-on-write `OverlayDevice` backed by an IndexedDB database named after a fresh `crypto.randomUUID()`. Stop wipes and deletes those databases. A tab closed without Stop leaves them behind, and the next page load deletes them. Each live session holds a Web Lock, so cleanup never touches a session that is still running in another tab.

**File manager bridge.** Commands run as hidden processes (`cx.run`) next to the interactive shell. Their stdout goes to an `IDBDevice` directory mount that JS reads back with `readFileAsBlob`, which is binary-safe with no base64 round trip, and a unique sentinel line carries the exit status. Uploads are staged through a `DataDevice`. Every path goes through `shellQuote()`. The same `ShellFileSystem` also runs over a text stream via `SentinelCommandRunner` (base64 framing, chunked uploads), which is how the v86 adapter uses it.

### Where the implementation differs from the spec (verified against CheerpX 1.3.9)

| Spec assumption | Reality | What the code does |
|---|---|---|
| `setCustomConsole` input takes strings | Returns `(keyCode: number) => void` | UTF-8 encode, send byte by byte (non-ASCII verified) |
| A resize API exists | None | Re-calling `setCustomConsole` with the new size updates the tty (`stty size` verified) |
| `deleteDatabase("sandbox-<id>")` | CheerpX names databases `cjFS_/sandbox-<id>/` **and keeps the connections open after `delete()`**, so deletion blocks forever | `IDBDevice.reset()` before teardown, plus a hook that closes session-database connections on `versionchange` ([idb-release.ts](lib/emulator/idb-release.ts)) |
| A persistent block cache could sit under the session layer | `OverlayDevice` over `OverlayDevice` fails to initialise | Warm starts rely on the HTTP cache. The default image uses the `https://` CloudDevice transport, whose chunk GETs are cacheable (`wss://` is not) |
| Setup runs before the shell | Each new binary costs seconds on a cold start | Prompt and aliases come from a builtins-only rc sourced via `PROMPT_COMMAND`; preset files are created in the background while the shell boots |
| `EmulatorAdapter` as specified | Also needed hidden commands | Added `exec()` (task checks, presets, file bridge) and optional `storageNames()`; `onOutput` returns an unsubscribe function |

### Performance

A cold boot needs ~130 disk chunks, and CheerpX fetches them one at a time (~300 ms each), which is about 40 s. The chunk set is fixed for a given image, so [lib/boot-manifest.json](lib/boot-manifest.json) records it (base, plus extras per preset), and the app fetches it 16-wide at low priority as soon as the visitor hovers, focuses or clicks Launch. CheerpX's requests then hit the HTTP cache. Result: cold click-to-prompt ~9 s; Git playground files ready ~15 s.

The manifest applies only to `cloud` images and is ignored when it doesn't match `NEXT_PUBLIC_IMAGE_URL`. After changing the image or a preset script, run `npm run build && npx next start -p 3100` and then `npm run record:manifest`. `?noprefetch` disables it for measurements.

## Deploy

**Vercel.** Push and import. Headers come from `next.config.ts` (and `vercel.json` for static output). Set `NEXT_PUBLIC_IMAGE_URL` if you host your own image.

**Any static host.** Run `STATIC_EXPORT=1 npm run build`, which writes `out/`. The host must send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` on every page. `public/_headers` covers Netlify and Cloudflare Pages; for nginx use `add_header` for both. Serve over HTTPS: cross-origin isolation needs a secure context.

**Disk image.** Host it on a CDN, not with the app. It needs range requests, CORS and `Cross-Origin-Resource-Policy: cross-origin`. See [image/README.md](image/README.md) for building it and for R2 and S3 setups.

## Known limitations

- **Licensing:** CheerpX is free for personal and open-source use; commercial use needs a license from Leaning Technologies. The v86 adapter is the open-source fallback. It is experimental and needs a guest image with a shell on `ttyS1` (see the header of [v86-adapter.ts](lib/emulator/v86-adapter.ts)).
- **No network inside the VM** (v1 by design). The Git playground uses a local bare repo as `origin`.
- **Images:** the default public image is Debian buster and lacks `tree`, `jq` and `tmux`. The image built from `image/` includes them.
- **Background setup race:** preset files appear a few seconds after the first prompt on a cold start. The status bar shows "Adding … files" until they exist.
- **Browsers:** desktop Chrome, Edge and Firefox. Safari is untested. Phones get a notice.
