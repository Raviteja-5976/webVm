import { basename, dirname, normalizePath, sortEntries, toBytes } from "../fs-bridge";
import { VmError, type VmEntry, type VmFileSystem } from "./types";

interface Node {
  type: "file" | "dir";
  data: Uint8Array;
  mtime: number;
}

/** In-memory VmFileSystem used by the mock engine. */
export class MemoryFileSystem implements VmFileSystem {
  private nodes = new Map<string, Node>([["/", dir()]]);

  constructor(seed: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(seed)) {
      if (path.endsWith("/")) this.mkdirSync(path.slice(0, -1));
      else this.writeSync(path, content);
    }
  }

  async list(path: string): Promise<VmEntry[]> {
    const p = normalizePath(path);
    const node = this.nodes.get(p);
    if (!node) throw new VmError(`find: '${p}': No such file or directory`);
    if (node.type !== "dir") throw new VmError(`find: '${p}': Not a directory`);
    const prefix = p === "/" ? "/" : p + "/";
    const entries: VmEntry[] = [];
    for (const [key, n] of this.nodes) {
      if (key === p || !key.startsWith(prefix) || key.slice(prefix.length).includes("/")) continue;
      entries.push({ name: basename(key), path: key, type: n.type, size: n.type === "dir" ? 4096 : n.data.length, mtime: n.mtime });
    }
    return sortEntries(entries);
  }

  async read(path: string): Promise<Uint8Array> {
    return this.readSync(path);
  }

  async write(path: string, data: Uint8Array | string): Promise<void> {
    this.writeSync(path, data);
  }

  async mkdir(path: string): Promise<void> {
    this.mkdirSync(path);
  }

  async remove(path: string, opts: { recursive?: boolean } = {}): Promise<void> {
    this.removeSync(path, opts.recursive);
  }

  async rename(from: string, to: string): Promise<void> {
    const src = normalizePath(from);
    const dst = normalizePath(to);
    if (src === dst) return;
    if (!this.nodes.has(src)) throw new VmError(`mv: cannot stat '${src}': No such file or directory`);
    if (this.nodes.has(dst)) throw new VmError(`${basename(dst)} already exists`);
    if (dst.startsWith(src + "/")) throw new VmError("Cannot move a folder into itself");
    this.requireDir(dirname(dst));
    for (const [key, node] of [...this.nodes]) {
      if (key === src || key.startsWith(src + "/")) {
        this.nodes.delete(key);
        this.nodes.set(dst + key.slice(src.length), node);
      }
    }
  }

  /* sync helpers, shared with the fake shell */

  exists(path: string) {
    return this.nodes.has(normalizePath(path));
  }

  isDir(path: string) {
    return this.nodes.get(normalizePath(path))?.type === "dir";
  }

  readSync(path: string): Uint8Array {
    const p = normalizePath(path);
    const node = this.nodes.get(p);
    if (!node) throw new VmError(`cat: ${p}: No such file or directory`);
    if (node.type === "dir") throw new VmError(`cat: ${p}: Is a directory`);
    return node.data;
  }

  writeSync(path: string, data: Uint8Array | string, append = false) {
    const p = normalizePath(path);
    this.requireDir(dirname(p));
    const existing = this.nodes.get(p);
    if (existing?.type === "dir") throw new VmError(`${p}: Is a directory`);
    const bytes = toBytes(data);
    const next = append && existing ? concat(existing.data, bytes) : bytes.slice();
    this.nodes.set(p, { type: "file", data: next, mtime: Date.now() });
  }

  mkdirSync(path: string) {
    let current = "";
    for (const part of normalizePath(path).split("/").filter(Boolean)) {
      current += "/" + part;
      const node = this.nodes.get(current);
      if (node?.type === "file") throw new VmError(`mkdir: ${current}: File exists`);
      if (!node) this.nodes.set(current, dir());
    }
  }

  removeSync(path: string, recursive = false) {
    const p = normalizePath(path);
    if (p === "/") throw new VmError("Refusing to delete /");
    const node = this.nodes.get(p);
    if (!node) return;
    if (node.type === "dir" && !recursive) throw new VmError(`rm: cannot remove '${p}': Is a directory`);
    for (const key of [...this.nodes.keys()]) {
      if (key === p || key.startsWith(p + "/")) this.nodes.delete(key);
    }
  }

  private requireDir(path: string) {
    if (this.nodes.get(path)?.type !== "dir") throw new VmError(`${path}: No such directory`);
  }
}

function dir(): Node {
  return { type: "dir", data: new Uint8Array(), mtime: Date.now() };
}

function concat(a: Uint8Array, b: Uint8Array) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}
