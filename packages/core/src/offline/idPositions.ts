/**
 * Id positions of an offline event's payload (LIRA-306, R3, FR-014,
 * FR-019) — PURE, browser-safe.
 *
 * The server swaps PC ids for server ids ONLY in id positions:
 *   - keys named `id`, `*_id`, `*Id` (a single id), and `ids`, `*_ids`,
 *     `*Ids` (an array of ids);
 *   - polymorphic pairs (`targets[].{kind, id}`, `referenceTable` +
 *     `referenceId`) are covered by the key rule — the VALUE says which
 *     table it belongs to (idRange), so no table declaration is needed;
 *   - nested payloads (`cartItems[].formData`, …) are walked recursively;
 *   - JSON strings in {@link EMBEDDED_JSON_KEYS} are parsed, walked and
 *     written back as strings.
 * A number written as text in an id position counts (`"1017000000001"`) and
 * is written back as text. Every other value — amounts, phones, IMEIs,
 * barcodes, notes — is never touched, even when it falls in the offline
 * range (a 13-digit EAN or an LBP amount can).
 */
import { isOfflineId, parseIdLike } from "./idRange.js";

/** Keys whose STRING value is a JSON document holding more id positions. */
export const EMBEDDED_JSON_KEYS: readonly string[] = ["form_data", "formData"];

const SINGLE_ID_KEY = /(^id$|_id$|[a-z0-9]Id$)/;
const ID_ARRAY_KEY = /(^ids$|_ids$|[a-z0-9]Ids$)/;

export function isIdKey(key: string): boolean {
  return SINGLE_ID_KEY.test(key) || ID_ARRAY_KEY.test(key);
}

export interface IdPosition {
  path: string;
  value: number;
  /** the payload held it as a numeric string */
  asString: boolean;
}

type Visitor = (path: string, raw: unknown) => unknown;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Walk a payload, calling `onId` for every value in an id position and
 * `onOther` for every other leaf; both may return a replacement. Returns a
 * NEW structure (the input is never mutated).
 */
function walk(value: unknown, path: string, onId: Visitor, onOther?: Visitor): unknown {
  if (Array.isArray(value)) {
    return value.map((v, i) => walk(v, `${path}[${i}]`, onId, onOther));
  }
  if (!isPlainObject(value)) return onOther ? onOther(path, value) : value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const p = path ? `${path}.${k}` : k;
    if (EMBEDDED_JSON_KEYS.includes(k) && typeof v === "string") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(v);
      } catch {
        out[k] = onOther ? onOther(p, v) : v;
        continue;
      }
      if (parsed && typeof parsed === "object") {
        out[k] = JSON.stringify(walk(parsed, p, onId, onOther));
      } else {
        out[k] = onOther ? onOther(p, v) : v;
      }
      continue;
    }
    if (SINGLE_ID_KEY.test(k) && (typeof v === "number" || typeof v === "string")) {
      out[k] = onId(p, v);
      continue;
    }
    if (ID_ARRAY_KEY.test(k) && Array.isArray(v)) {
      out[k] = v.map((x, i) =>
        typeof x === "number" || typeof x === "string"
          ? onId(`${p}[${i}]`, x)
          : walk(x, `${p}[${i}]`, onId, onOther),
      );
      continue;
    }
    out[k] = walk(v, p, onId, onOther);
  }
  return out;
}

/**
 * Every id position of the payload that holds an integer (or numeric
 * string), in walk order. `channel` is accepted for channel-specific
 * declarations; today every channel uses the generic rules.
 */
export function collectIdPositions(_channel: string, payload: unknown): IdPosition[] {
  const found: IdPosition[] = [];
  walk(payload, "", (path, raw) => {
    const n = parseIdLike(raw);
    if (n !== null) found.push({ path, value: n, asString: typeof raw === "string" });
    return raw;
  });
  return found;
}

/**
 * Replace every offline id in an id position through `lookup`. Offline ids
 * `lookup` cannot resolve are left as they are and listed in `unmapped`
 * (the caller holds the event, FR-019).
 */
export function rewriteIdPositions<T extends Record<string, unknown>>(
  _channel: string,
  payload: T,
  lookup: (offlineId: number) => number | undefined,
): { payload: T; unmapped: number[]; rewritten: number } {
  const unmapped: number[] = [];
  let rewritten = 0;
  const out = walk(payload, "", (_path, raw) => {
    const n = parseIdLike(raw);
    if (n === null || !isOfflineId(n)) return raw;
    const server = lookup(n);
    if (server === undefined) {
      unmapped.push(n);
      return raw;
    }
    rewritten += 1;
    return typeof raw === "string" ? String(server) : server;
  }) as T;
  return { payload: out, unmapped: [...new Set(unmapped)], rewritten };
}

/**
 * Offline-range NUMBERS sitting outside every id position — the PC refuses
 * to record such an action (FR-014) because the server would never rewrite
 * them. Strings outside id positions (phones, barcodes) are not ids.
 */
export function offlineIdsOutsidePositions(payload: unknown): Array<{ path: string; value: number }> {
  const out: Array<{ path: string; value: number }> = [];
  walk(
    payload,
    "",
    (_p, raw) => raw,
    (path, raw) => {
      if (isOfflineId(raw)) out.push({ path, value: raw });
      return raw;
    },
  );
  return out;
}

/** Offline ids referenced in id positions (used for `dependsOn`). */
export function offlineIdsInPositions(channel: string, payload: unknown): number[] {
  return [
    ...new Set(collectIdPositions(channel, payload).map((p) => p.value).filter((v) => isOfflineId(v))),
  ];
}
