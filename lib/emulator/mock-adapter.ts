import { SESSION_DB_PREFIX, VM_USER } from "../config";
import { basename, normalizePath } from "../fs-bridge";
import { MemoryFileSystem } from "./memory-fs";
import { OutputHub, sleep } from "./output-hub";
import type { AdapterOptions, EmulatorAdapter, ExecResult, StartOptions } from "./types";

const HOME = VM_USER.home;
const decoder = new TextDecoder();

/**
 * UI test double. A tiny line-editing shell over an in-memory filesystem.
 * It also opens a real IndexedDB database named like a real session so the
 * lifecycle code (delete on stop, orphan cleanup) is exercised end to end.
 */
export class MockAdapter implements EmulatorAdapter {
  readonly name = "Mock (echo shell)";
  readonly fs = new MemoryFileSystem({
    [`${HOME}/`]: "",
    [`${HOME}/welcome.txt`]: "Welcome to the mock sandbox.\nType `help` for the supported commands.\n",
    [`${HOME}/lessons/`]: "",
    [`${HOME}/lessons/01-basics.md`]: "# Basics\n\nTry: ls, cd, cat, echo hi > file.txt\n",
  });

  private readonly output = new OutputHub();
  private cwd: string = HOME;
  private line = "";
  private ready = false;
  private db: IDBDatabase | null = null;

  constructor(private readonly opts: AdapterOptions) {}

  storageNames() {
    return [`${SESSION_DB_PREFIX}${this.opts.sessionId}`];
  }

  async start({ onProgress }: StartOptions): Promise<void> {
    onProgress?.({ phase: "Booting mock VM", percent: 30 });
    this.db = await openDb(this.storageNames()[0]);
    await sleep(150);
    onProgress?.({ phase: "Ready", percent: 100 });
    this.ready = true;
    this.print("\x1b[1;33mMock engine\x1b[0m: a fake shell for UI testing. Type \x1b[1mhelp\x1b[0m.\r\n");
    this.prompt();
  }

  write(data: string): void {
    if (!this.ready) return;
    for (const ch of data) {
      if (ch === "\r" || ch === "\n") {
        this.print("\r\n");
        const cmd = this.line;
        this.line = "";
        this.run(cmd);
        this.prompt();
      } else if (ch === "\x7f" || ch === "\b") {
        if (this.line) {
          this.line = this.line.slice(0, -1);
          this.print("\b \b");
        }
      } else if (ch === "\x03") {
        this.line = "";
        this.print("^C\r\n");
        this.prompt();
      } else if (ch >= " ") {
        this.line += ch;
        this.print(ch);
      }
    }
  }

  onOutput(cb: (data: string | Uint8Array) => void) {
    return this.output.subscribe(cb);
  }

  resize(): void {}

  async exec(script: string): Promise<ExecResult> {
    // Supports just enough for task checks written as `test -e PATH`.
    const m = /^test -([efd]) (\S+)$/.exec(script.trim());
    if (m) {
      const p = this.resolve(m[2]);
      const ok = m[1] === "d" ? this.fs.isDir(p) : m[1] === "f" ? this.fs.exists(p) && !this.fs.isDir(p) : this.fs.exists(p);
      return { status: ok ? 0 : 1, stdout: new Uint8Array(), stderr: "" };
    }
    return { status: 127, stdout: new Uint8Array(), stderr: "The mock engine cannot run shell scripts." };
  }

  async destroy(): Promise<void> {
    this.ready = false;
    this.db?.close();
    this.db = null;
    this.output.clear();
  }

  /* ---------------------------------------------------------------- */

  private print(s: string) {
    this.output.emit(s);
  }

  private prompt() {
    const where = this.cwd === HOME ? "~" : this.cwd.startsWith(HOME + "/") ? "~" + this.cwd.slice(HOME.length) : this.cwd;
    this.print(`\x1b[1;32muser@mock\x1b[0m:\x1b[1;34m${where}\x1b[0m$ `);
  }

  private resolve(p: string) {
    if (p === "~") return HOME;
    if (p.startsWith("~/")) return normalizePath(HOME + p.slice(1));
    return normalizePath(p.startsWith("/") ? p : `${this.cwd}/${p}`);
  }

  private run(input: string) {
    let args = tokenize(input);
    if (!args.length) return;
    let redirect: { path: string; append: boolean } | null = null;
    const r = args.findIndex((a) => a === ">" || a === ">>");
    if (r >= 0 && args[r + 1]) {
      redirect = { path: this.resolve(args[r + 1]), append: args[r] === ">>" };
      args = args.slice(0, r);
    }
    const [cmd, ...rest] = args;
    let out = "";
    try {
      switch (cmd) {
        case "help":
          out = "Commands: ls [-a] [dir], cd, pwd, cat, echo [> file], touch, mkdir [-p], rm [-r], mv, clear, whoami, uname\n";
          break;
        case "pwd":
          out = this.cwd + "\n";
          break;
        case "whoami":
          out = "user\n";
          break;
        case "uname":
          out = "Linux (mock)\n";
          break;
        case "clear":
          this.print("\x1b[2J\x1b[H");
          break;
        case "echo":
          out = rest.join(" ") + "\n";
          break;
        case "cd": {
          const target = this.resolve(rest[0] ?? "~");
          if (!this.fs.isDir(target)) throw new Error(`cd: ${rest[0]}: No such directory`);
          this.cwd = target;
          break;
        }
        case "ls": {
          const all = rest.includes("-a") || rest.includes("-la") || rest.includes("-al");
          const target = this.resolve(rest.find((a) => !a.startsWith("-")) ?? ".");
          if (!this.fs.isDir(target)) {
            if (!this.fs.exists(target)) throw new Error(`ls: cannot access '${target}': No such file or directory`);
            out = basename(target) + "\n";
            break;
          }
          void this.fs.list(target).then((entries) => {
            const names = entries
              .filter((e) => all || !e.name.startsWith("."))
              .map((e) => (e.type === "dir" ? `\x1b[1;34m${e.name}\x1b[0m` : e.name));
            if (names.length) this.print(names.join("  ") + "\r\n");
          });
          break;
        }
        case "cat":
          out = rest.map((p) => decoder.decode(this.fs.readSync(this.resolve(p)))).join("");
          break;
        case "touch":
          for (const p of rest) if (!this.fs.exists(this.resolve(p))) this.fs.writeSync(this.resolve(p), "");
          break;
        case "mkdir":
          for (const p of rest.filter((a) => a !== "-p")) this.fs.mkdirSync(this.resolve(p));
          break;
        case "rm": {
          const recursive = rest.some((a) => /^-[rRf]*r/i.test(a));
          for (const p of rest.filter((a) => !a.startsWith("-"))) this.fs.removeSync(this.resolve(p), recursive);
          break;
        }
        case "mv": {
          const [src, dst] = rest;
          let target = this.resolve(dst);
          if (this.fs.isDir(target)) target = `${target}/${basename(this.resolve(src))}`;
          void this.fs.rename(this.resolve(src), target).catch((e) => this.print(`mv: ${e.message}\r\n`));
          break;
        }
        default:
          throw new Error(`${cmd}: command not found (mock engine, try \`help\`)`);
      }
      if (redirect) this.fs.writeSync(redirect.path, out, redirect.append);
      else if (out) this.print(out.replace(/\n/g, "\r\n"));
    } catch (e) {
      this.print(`${(e as Error).message}\r\n`);
    }
  }
}

function tokenize(input: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(>>|>)|([^\s"'>]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) out.push(m[1] ?? m[2] ?? m[3] ?? m[4]);
  return out;
}

function openDb(name: string): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("blocks");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}
