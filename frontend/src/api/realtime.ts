/**
 * Realtime cache invalidation for the web transport.
 *
 * The backend emits ONE event — `data:invalidate` — to a tenant's room after
 * any successful write (backend/src/middleware/invalidateOnMutation.ts). The
 * payload names the entity that changed and nothing else; consumers refetch
 * through their normal authorised read path.
 *
 * ── Why invalidation rather than state ──
 *
 * No money figure is ever read from a socket message, so a duplicated or
 * out-of-order delivery cannot make the UI show a stale drawer total. A
 * duplicate costs one redundant GET. That trade is deliberate.
 *
 * ── Why this does NOT replace polling ──
 *
 * Sockets drop, laptops sleep, events get missed while a tab is backgrounded.
 * Push narrows the staleness window from "the poll interval" to "instant"; the
 * slow safety poll and refetch-on-focus close what push cannot guarantee.
 * Anything that treats push as a complete replacement diverges silently, and
 * silent divergence in a POS is a number someone acts on.
 *
 * On RECONNECT every subscriber is notified unconditionally, because the gap
 * while disconnected is exactly the window where changes were missed.
 *
 * ── Desktop ──
 *
 * Electron has no Socket.IO server to talk to — the renderer reaches the
 * database directly over IPC — so this is a no-op there. Gated on the
 * canonical `isElectron()`, never on raw `window.api` truthiness (rule 19a).
 */

import { isElectron } from "./backendApi";
import { getToken } from "./httpClient";
import { connectSocket } from "./socket";
import logger from "@/utils/logger";

/** Must match INVALIDATE_EVENT in backend/src/middleware/invalidateOnMutation.ts. */
const INVALIDATE_EVENT = "data:invalidate";

export interface InvalidatePayload {
  entity: string;
  action: string;
  at: string;
}

/** `"*"` receives every invalidation, including the reconnect sweep. */
export type InvalidationEntity = string | "*";

type Handler = (payload: InvalidatePayload) => void;

const handlers = new Map<InvalidationEntity, Set<Handler>>();
let wired = false;

function dispatch(payload: InvalidatePayload): void {
  // A sweep (entity "*", emitted on reconnect) must reach EVERY subscriber, not
  // just those registered under the literal "*" key: while the socket was down
  // any entity could have changed, and a subscriber that only asked about
  // "sessions" is exactly as stale as one that asked about everything. Looking
  // up only the literal key here silently defeated the reconnect recovery.
  const keys: InvalidationEntity[] =
    payload.entity === "*" ? [...handlers.keys()] : [payload.entity, "*"];

  for (const key of keys) {
    const set = handlers.get(key);
    if (!set) continue;
    for (const h of set) {
      try {
        h(payload);
      } catch (err) {
        // One bad subscriber must not stop the others.
        logger.error("invalidation handler threw:", err);
      }
    }
  }
}

/**
 * Attach the socket listeners once, lazily. Called on first subscription so
 * nothing connects before the user is authenticated (the handshake is
 * token-verified server-side and would simply be rejected).
 */
function ensureWired(): void {
  if (wired) return;

  const token = getToken();
  if (!token) return; // try again on the next subscribe

  try {
    const socket = connectSocket(token);

    socket.on(INVALIDATE_EVENT, (payload: InvalidatePayload) => {
      dispatch(payload);
    });

    // A reconnect means we were deaf for a while: assume everything is stale.
    socket.on("connect", () => {
      dispatch({
        entity: "*",
        action: "reconnect",
        at: new Date().toISOString(),
      });
    });

    socket.on("connect_error", (err: Error) => {
      // Not fatal — the safety poll still keeps data fresh. Debug-level on
      // purpose: a backend without sockets reachable should not spam errors.
      logger.info(
        `realtime socket unavailable, polling still active: ${err.message}`,
      );
    });

    wired = true;
  } catch (err) {
    logger.info(`realtime socket could not be created: ${String(err)}`);
  }
}

/**
 * Subscribe to invalidations for one entity (e.g. `"sessions"`), or `"*"`.
 * Returns an unsubscribe function. A no-op on desktop.
 */
export function subscribeToInvalidation(
  entity: InvalidationEntity,
  handler: Handler,
): () => void {
  if (isElectron()) return () => {};

  let set = handlers.get(entity);
  if (!set) {
    set = new Set();
    handlers.set(entity, set);
  }
  set.add(handler);

  ensureWired();

  return () => {
    const s = handlers.get(entity);
    if (!s) return;
    s.delete(handler);
    if (s.size === 0) handlers.delete(entity);
  };
}

/** Test seam: forget listeners so a fresh subscribe re-wires. */
export function resetRealtimeForTests(): void {
  handlers.clear();
  wired = false;
}
