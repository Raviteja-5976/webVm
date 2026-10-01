import type * as CheerpXTypes from "@leaningtech/cheerpx";
import { CHEERPX_URL } from "../config";
import { installIdbReleaseHook } from "./idb-release";

export type CheerpXModule = typeof CheerpXTypes;

let modulePromise: Promise<CheerpXModule> | null = null;

/**
 * Load the pinned CheerpX ES module from Leaning Technologies' CDN.
 * Memoised, so calling it on hover "pre-warms" the engine and the later
 * launch reuses the same module instance.
 */
export function loadCheerpX(): Promise<CheerpXModule> {
  if (!modulePromise) {
    installIdbReleaseHook(); // must run before CheerpX opens any database

    modulePromise = import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ CHEERPX_URL
    ) as Promise<CheerpXModule>;
    modulePromise.catch(() => {
      modulePromise = null;
    });
  }
  return modulePromise;
}
