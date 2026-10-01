import { SESSION_DB_PREFIX } from "./config";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const DB_NAME_RE = new RegExp(`${SESSION_DB_PREFIX}(${UUID})(?:-[a-z]+)?/?$`, "i");

/** Extract the session id from a database name (plain or CheerpX's `cjFS_/…/` form). */
export function sessionIdFromDbName(name: string): string | null {
  const m = DB_NAME_RE.exec(name);
  return m ? m[1].toLowerCase() : null;
}
