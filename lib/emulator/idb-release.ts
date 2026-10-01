import { sessionIdFromDbName } from "../db-names";

let installed = false;

/**
 * CheerpX (verified with 1.3.9) keeps its IndexedDB connections open even
 * after `Linux.delete()` and `Device.delete()`, so `indexedDB.deleteDatabase`
 * stays "blocked" for the life of the page and Stop could never remove the
 * session's data.
 *
 * This hook makes session databases well-behaved: when someone asks to delete
 * one (a `versionchange` event), the connection closes itself. It only touches
 * databases named `…sandbox-<uuid>…`; everything else is left alone. The
 * session lock prevents other tabs from deleting a live session's databases.
 */
export function installIdbReleaseHook() {
  if (installed || typeof IDBFactory === "undefined") return;
  installed = true;
  const originalOpen = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function open(this: IDBFactory, name: string, version?: number) {
    const request =
      version === undefined ? originalOpen.call(this, name) : originalOpen.call(this, name, version);
    if (sessionIdFromDbName(name)) {
      request.addEventListener("success", () => {
        const db = request.result;
        db.addEventListener("versionchange", () => db.close());
      });
    }
    return request;
  } as IDBFactory["open"];
}
