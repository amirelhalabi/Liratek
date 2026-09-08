/**
 * `React.lazy` that survives a deploy landing under an open tab.
 *
 * Vite emits content-hashed chunk names, and the loaded `index.js` hardcodes
 * the ones that existed when it was built. After a deploy those files are gone,
 * so the next route a user navigates to fails with:
 *
 *   Failed to fetch dynamically imported module: .../assets/DashboardChart-<oldhash>.js
 *
 * The page looks broken while the app is in fact perfectly healthy — the tab is
 * simply holding a stale manifest. A reload fixes it, but expecting users to
 * know that is not a design.
 *
 * This matters more here than in a typical app: the backend runs behind a
 * Cloudflare quick tunnel whose hostname changes on restart, and `yarn web:up`
 * redeploys the frontend each time to follow it. Deploys are frequent and
 * routine, so stale-chunk failures would be too.
 *
 * Reloading is guarded by a sessionStorage flag so a genuinely missing or
 * broken chunk cannot become an infinite reload loop: the first failure
 * reloads, and a second one in the same tab is rethrown for the error boundary
 * to show. The flag is cleared on any successful load, so a later deploy gets
 * its own single reload.
 */

import { lazy, type ComponentType } from "react";

const RELOAD_FLAG = "liratek.chunk-reload-attempted";

function readFlag(): boolean {
  try {
    return sessionStorage.getItem(RELOAD_FLAG) === "1";
  } catch {
    // Private mode / blocked storage: without the guard a reload loop is
    // possible, so treat it as "already tried" and let the error surface.
    return true;
  }
}

function writeFlag(value: boolean): void {
  try {
    if (value) sessionStorage.setItem(RELOAD_FLAG, "1");
    else sessionStorage.removeItem(RELOAD_FLAG);
  } catch {
    // Nothing to do — readFlag() fails closed.
  }
}

/**
 * Drop-in replacement for `React.lazy` for route-level code splitting.
 */
// The `any` here is React s, not a shortcut. Both `React.lazy` and
// `LazyExoticComponent<T>` constrain T to ComponentType<any> for variance
// reasons, so a narrower bound cannot satisfy the return type:
// ComponentType<unknown> rejects every component that takes props, and
// ComponentType<never> fails LazyExoticComponent s own constraint. Narrowing
// it would mean giving up the typed return, which is worse than mirroring
// React exactly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithReload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      const mod = await factory();
      // Loaded fine, so this tab's manifest is current: re-arm the guard for
      // whatever the next deploy does.
      writeFlag(false);
      return mod;
    } catch (error) {
      if (readFlag()) throw error;
      writeFlag(true);
      window.location.reload();
      // Deliberately never settles: the reload replaces this document, and
      // resolving or rejecting here would render an error for the split second
      // before it does.
      return new Promise<{ default: T }>(() => {});
    }
  });
}
