/**
 * Session lifecycle: create, boot, destroy, and clean up after tabs that were
 * closed without pressing Stop.
 *
 * Ephemerality guarantee: the base image is read-only; every write lands in
 * IndexedDB databases whose names contain `sandbox-<sessionId>`. Stop deletes
 * them. Orphan cleanup on the next page load deletes any left behind. A Web
 * Lock per session tells cleanup which sessions are still alive in other tabs.
 */

import {
  DEFAULT_ENGINE,
  IMAGE_TYPE,
  IMAGE_URL,
  type EngineId,
} from "./config";
import { sessionIdFromDbName } from "./db-names";
import type { BootProgress, EmulatorAdapter } from "./emulator/types";
import { SHELL_RC, type Preset } from "./presets";

export interface Session {
  id: string;
  engine: EngineId;
  preset: Preset;
  adapter: EmulatorAdapter;
  startedAt: number;
  /** Launch-to-prompt time in ms, set once booted. */
  bootMs?: number;
  releaseLock: () => void;
}

export { sessionIdFromDbName };

const LOCK_PREFIX = "sandbox-session-";

/** Sessions alive in this tab (never cleaned up as orphans). */
const liveSessions = new Set<string>();

export async function createAdapter(engine: EngineId, sessionId: string): Promise<EmulatorAdapter> {
  switch (engine) {
    case "mock": {
      const { MockAdapter } = await import("./emulator/mock-adapter");
      return new MockAdapter({ sessionId });
    }
    case "v86": {
      const { V86Adapter } = await import("./emulator/v86-adapter");
      return new V86Adapter({ sessionId });
    }
    case "cheerpx":
    default: {
      const { CheerpXAdapter } = await import("./emulator/cheerpx-adapter");
      return new CheerpXAdapter({ sessionId, imageUrl: IMAGE_URL, imageType: IMAGE_TYPE });
    }
  }
}

/** Create a session (unique id, lock, adapter). Call `bootSession` next. */
export async function createSession(preset: Preset, engine: EngineId = DEFAULT_ENGINE): Promise<Session> {
  const id = crypto.randomUUID();
  liveSessions.add(id);
  const releaseLock = await acquireLock(LOCK_PREFIX + id);
  const adapter = await createAdapter(engine, id);
  return { id, engine, preset, adapter, startedAt: Date.now(), releaseLock };
}

export async function bootSession(
  session: Session,
  opts: { cols: number; rows: number; onProgress?: (p: BootProgress) => void },
): Promise<void> {
  const t0 = performance.now();
  await session.adapter.start({ ...opts, shellRc: SHELL_RC });
  session.bootMs = Math.round(performance.now() - t0);
}

/** Stop the VM, then delete every IndexedDB database the session created. */
export async function destroySession(session: Session): Promise<string[]> {
  try {
    await session.adapter.destroy();
  } catch (e) {
    console.warn("[sandbox] adapter.destroy failed", e);
  }
  const names = new Set(session.adapter.storageNames?.() ?? []);
  for (const name of await listDatabaseNames()) {
    if (sessionIdFromDbName(name) === session.id) names.add(name);
  }
  const deleted: string[] = [];
  for (const name of names) {
    if ((await deleteDatabase(name)) !== "error") deleted.push(name);
  }
  liveSessions.delete(session.id);
  session.releaseLock();
  return deleted;
}

/**
 * Best effort during `pagehide`: there is no time to await anything, so fire
 * the deletes and let orphan cleanup on the next load finish the job.
 */
export function destroySessionNow(session: Session) {
  void session.adapter.destroy().catch(() => undefined);
  for (const name of session.adapter.storageNames?.() ?? []) {
    try {
      indexedDB.deleteDatabase(name);
    } catch {
      /* ignore */
    }
  }
}

/** Delete leftover session databases whose owner is gone (tab closed without Stop). */
export async function cleanupOrphans(): Promise<string[]> {
  const names = await listDatabaseNames();
  if (!names.length) return [];
  const alive = await heldSessionIds();
  const removed: string[] = [];
  for (const name of names) {
    const id = sessionIdFromDbName(name);
    if (!id || liveSessions.has(id) || alive.has(id)) continue;
    if ((await deleteDatabase(name)) === "deleted") removed.push(name);
  }
  return removed;
}

/**
 * Delete one database. If another connection is still closing, the request is
 * "blocked"; wait briefly, then retry once. Never waits more than ~5 s: a
 * leftover database is removed by orphan cleanup on the next load.
 */
export async function deleteDatabase(name: string, retry = true): Promise<"deleted" | "blocked" | "error"> {
  const result = await new Promise<"deleted" | "blocked" | "error">((resolve) => {
    let settled = false;
    const done = (r: "deleted" | "blocked" | "error") => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => done("deleted");
      req.onerror = () => done("error");
      // A blocked request still completes once connections close; don't wait forever.
      req.onblocked = () => setTimeout(() => done("blocked"), 1500);
      setTimeout(() => done("blocked"), 5000);
    } catch {
      done("error");
    }
  });
  if (result === "blocked" && retry) {
    await new Promise((r) => setTimeout(r, 500));
    return deleteDatabase(name, false);
  }
  return result;
}

export async function listDatabaseNames(): Promise<string[]> {
  if (typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function") return [];
  try {
    return (await indexedDB.databases()).map((d) => d.name ?? "").filter(Boolean);
  } catch {
    return [];
  }
}

async function acquireLock(name: string): Promise<() => void> {
  if (typeof navigator === "undefined" || !navigator.locks) return () => {};
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await new Promise<void>((acquired) => {
    void navigator.locks.request(name, () => {
      acquired();
      return held;
    });
  });
  return release;
}

async function heldSessionIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  if (typeof navigator === "undefined" || !navigator.locks) return ids;
  try {
    const { held = [], pending = [] } = await navigator.locks.query();
    for (const lock of [...held, ...pending]) {
      if (lock.name?.startsWith(LOCK_PREFIX)) ids.add(lock.name.slice(LOCK_PREFIX.length).toLowerCase());
    }
  } catch {
    /* ignore */
  }
  return ids;
}
