import { useCallback, useState } from "react";

/**
 * LIRA-401 — client-side idempotency keys for money writes.
 *
 * The server (`idempotency-key` header) books a write at most once per key.
 * A page therefore needs ONE key per real payment:
 *   - the SAME key for every submit/retry while the form stays open
 *     (a double click or a retry after a network failure replays, never re-books);
 *   - a NEW key the next time the form opens (two real payments = two keys).
 *
 * Two hooks:
 *   - `useIdempotencyKey(active)` — for modal-style forms. New key each time
 *     `active` goes false → true; `undefined` while inactive.
 *   - `useIdempotencyKeyWithReset(active)` — for ALWAYS-VISIBLE forms (POS
 *     checkout, Services, Recharge, …) where `active` stays `true`. Returns
 *     `{ key, reset }`; call `reset()` after every SUCCESSFUL submit so the
 *     next payment gets a fresh key. Do NOT reset after a failure — the retry
 *     must reuse the key.
 */

const KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;

function randomChunk(): string {
  const c: Crypto | undefined =
    typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.getRandomValues === "function") {
    const buf = new Uint32Array(1);
    c.getRandomValues(buf);
    return buf[0].toString(36).padStart(7, "0");
  }
  return Math.floor(Math.random() * 0xffffffff)
    .toString(36)
    .padStart(7, "0");
}

/** `web-<base36 time>-<rand>-<rand>`; always matches `/^[A-Za-z0-9-]{8,128}$/`. */
export function newIdempotencyKey(): string {
  const key = `web-${Date.now().toString(36)}-${randomChunk()}-${randomChunk()}`;
  // Defensive: the pieces above can only produce [a-z0-9-], so this never fires.
  return KEY_PATTERN.test(key)
    ? key
    : `web-${Date.now().toString(36)}-fallback`;
}

interface KeyState {
  active: boolean;
  key: string | undefined;
}

/**
 * Same as {@link useIdempotencyKey} plus `reset()`, which issues a new key
 * while `active` stays true (use after a successful submit on an always-visible form).
 */
export function useIdempotencyKeyWithReset(active: boolean): {
  key: string | undefined;
  reset: () => void;
} {
  // State (not useMemo) so React can never silently recompute the key:
  // a recomputed key would turn a retry into a second booking.
  const [state, setState] = useState<KeyState>(() => ({
    active,
    key: active ? newIdempotencyKey() : undefined,
  }));

  // `active` flipped: adjust state during render (React's documented
  // "storing information from previous renders" pattern). React re-renders
  // straight away, before committing, so no caller ever sees the stale key.
  if (state.active !== active) {
    setState({ active, key: active ? newIdempotencyKey() : undefined });
  }

  const reset = useCallback(
    () =>
      setState((s) =>
        s.active ? { active: true, key: newIdempotencyKey() } : s,
      ),
    [],
  );
  return { key: state.active === active ? state.key : undefined, reset };
}

/** One key per "open" of a money form. New key when `active` turns true; cleared when it turns false. */
export function useIdempotencyKey(active: boolean): string | undefined {
  return useIdempotencyKeyWithReset(active).key;
}

/**
 * The adapter's `opts` argument from a hook key. `exactOptionalPropertyTypes`
 * refuses `{ idempotencyKey: undefined }`, so this omits the field when there
 * is no key: `api.addRepayment(payload, idempotencyOpts(key))`.
 */
export function idempotencyOpts(key: string | undefined): {
  idempotencyKey?: string;
} {
  return key ? { idempotencyKey: key } : {};
}
