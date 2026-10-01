import { ANALYTICS_URL } from "./config";

type Props = Record<string, string | number | boolean | undefined>;

declare global {
  interface Window {
    plausible?: (event: string, opts?: { props?: Props }) => void;
  }
}

/**
 * Minimal analytics hook: launch, boot time and stop events. Sends a beacon
 * to NEXT_PUBLIC_ANALYTICS_URL if set, forwards to Plausible if present, and
 * always dispatches a `sandbox:analytics` DOM event (used by the e2e tests).
 */
export function track(event: string, props: Props = {}) {
  if (typeof window === "undefined") return;
  const payload = { event, ...props, ts: Date.now() };
  window.dispatchEvent(new CustomEvent("sandbox:analytics", { detail: payload }));
  try {
    window.plausible?.(event, { props });
    if (ANALYTICS_URL) navigator.sendBeacon?.(ANALYTICS_URL, JSON.stringify(payload));
  } catch {
    /* analytics must never break the app */
  }
  if (process.env.NODE_ENV !== "production") console.debug("[analytics]", payload);
}
