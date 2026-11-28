/**
 * Web app: reload an open tab by itself once a newer build is deployed, so a
 * till never keeps running old code for hours after a fix (owner request
 * 2026-11-28; a page from before the partner Only Days fix booked a sale with
 * the old code).
 *
 * How it knows: every web build writes `version.json` (`{ buildId }`, see the
 * `version-json` plugin in vite.config.ts) and bakes the same id into the
 * bundle as `__BUILD_ID__`. The tab reads `version.json` (never cached) when
 * it opens, every few minutes, and whenever it comes back into view. A
 * different id means a newer build is live.
 *
 * When it reloads: no prompt (owner decision 2026-11-28), and NEVER while the
 * cashier has work in progress — something selected or typed
 * (`hasPendingWork`, shared/utils/pendingWork.ts). With nothing in progress
 * it reloads at the first of these:
 *  - the tab is hidden (the cashier switched away);
 *  - the cashier changes page (leaving a page already drops what it held);
 *  - the page has been quiet (no key, click or scroll) for
 *    {@link QUIET_RELOAD_MS}, checked every {@link QUIET_CHECK_MS}.
 * Work in progress simply postpones it to the next such moment.
 *
 * Off in the desktop app (it has its own updater) and in a local dev build.
 * A failed read never reloads.
 */
import { useEffect, useRef } from "react";
import { isElectron } from "@/api/backendApi";
import { hasPendingWork, startFieldTracking } from "../utils/pendingWork";

/** How often an open tab asks whether a newer build is live. */
export const VERSION_CHECK_INTERVAL_MS = 5 * 60_000;
/** With a newer build waiting, a page quiet for this long may reload. */
export const QUIET_RELOAD_MS = 30_000;
/** How often a waiting newer build looks for a quiet moment. */
export const QUIET_CHECK_MS = 15_000;

/** The build id baked into a local dev build (no `version.json` exists). */
export const DEV_BUILD_ID = "dev";

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

export interface AutoReloadOptions {
  /** The build this tab is running. Default: the bundle's `__BUILD_ID__`. */
  currentBuildId?: string;
  /** Default: on in a deployed web build, off on desktop and in dev. */
  enabled?: boolean;
  fetchFn?: FetchLike;
  reload?: () => void;
}

/** The live build's id, or null when it cannot be read. */
export async function fetchLatestBuildId(
  fetchFn: FetchLike,
): Promise<string | null> {
  try {
    const res = await fetchFn(`./version.json?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { buildId?: unknown };
    return typeof body.buildId === "string" && body.buildId
      ? body.buildId
      : null;
  } catch {
    return null;
  }
}

function bundleBuildId(): string {
  return typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : DEV_BUILD_ID;
}

export function useAutoReloadOnNewVersion(
  options: AutoReloadOptions = {},
): void {
  const currentBuildId = options.currentBuildId ?? bundleBuildId();
  const enabled =
    options.enabled ?? (currentBuildId !== DEV_BUILD_ID && !isElectron());
  // Rule 25: injected functions read through a ref, never effect deps.
  const depsRef = useRef({
    fetchFn: options.fetchFn ?? (fetch as unknown as FetchLike),
    reload: options.reload ?? (() => window.location.reload()),
  });

  useEffect(() => {
    if (!enabled) return;
    const stopTracking = startFieldTracking();
    let pending = false;
    let reloaded = false;
    let lastActivity = Date.now();
    let quietTimer: ReturnType<typeof setInterval> | undefined;

    /** Reload — but only when nothing selected or typed would be lost. */
    const reloadIfSafe = () => {
      if (!pending || reloaded || hasPendingWork()) return;
      reloaded = true;
      depsRef.current.reload();
    };
    const onActivity = () => {
      lastActivity = Date.now();
    };
    // After the new page has mounted, so the old page's fields are gone.
    const onRouteChange = () => {
      setTimeout(reloadIfSafe, 0);
    };
    const check = async () => {
      if (pending || reloaded) return;
      const latest = await fetchLatestBuildId(depsRef.current.fetchFn);
      if (!latest || latest === currentBuildId) return;
      pending = true;
      if (document.hidden) reloadIfSafe();
      quietTimer = setInterval(() => {
        if (Date.now() - lastActivity >= QUIET_RELOAD_MS) reloadIfSafe();
      }, QUIET_CHECK_MS);
    };
    const onVisibility = () => {
      if (document.hidden) reloadIfSafe();
      else void check();
    };

    void check();
    const interval = setInterval(() => void check(), VERSION_CHECK_INTERVAL_MS);
    const activity = ["keydown", "pointerdown", "wheel", "touchstart"];
    activity.forEach((e) =>
      window.addEventListener(e, onActivity, { passive: true }),
    );
    window.addEventListener("hashchange", onRouteChange);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(interval);
      if (quietTimer) clearInterval(quietTimer);
      stopTracking();
      activity.forEach((e) => window.removeEventListener(e, onActivity));
      window.removeEventListener("hashchange", onRouteChange);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, currentBuildId]);
}
