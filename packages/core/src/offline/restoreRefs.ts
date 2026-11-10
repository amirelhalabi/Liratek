/**
 * References an offline event makes, for the shop-restore hold (LIRA-377,
 * FR-021, research R7) — PURE, browser-safe.
 *
 * The same id positions as `idPositions.ts` (same key rules, same embedded
 * JSON keys, same path spelling), plus what the hold and the review list
 * need on top: the parent object (for the name the PC showed) and a way to
 * replace ONE removed client reference when an admin applies the item with
 * another client or as walk-in.
 *
 * Which table a PLAIN server id belongs to comes from its key only
 * (`client_id` / `clientId` → `clients`); a key that names no business table
 * (bare `id`, `reference_id`, …) is not guessed — such a position is never
 * checked, so it can never cause a false hold.
 */
import { EMBEDDED_JSON_KEYS, ID_ARRAY_KEY, SINGLE_ID_KEY } from "./idPositions.js";
import { decodeOfflineId, isOfflineId, parseIdLike } from "./idRange.js";
import { MANIFEST_KEY_TABLES } from "./tables.js";
import { recordedSchema } from "./channelPolicy.js";

export interface IdReference {
  path: string;
  key: string;
  /** the value in the payload (an offline id or a plain server id) */
  value: number;
  /** the name the PC showed next to it (`client_name`, …), if any */
  label: string | null;
  /** an element of an id array (`client_ids[0]`) */
  inArray: boolean;
}

/** Key words that name a table other than their plural. */
const KEY_ALIASES: Record<string, string> = { customer: "clients" };

function camelToSnake(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/** `client_id` → "client", `productUnitId` → "product_unit", bare `id` → "". */
function keyBase(key: string): string {
  const k = key.replace(/(_ids?|Ids?)$/, "").replace(/^ids?$/, "");
  return camelToSnake(k);
}

/** The business table a key names (a manifest table), or null. */
export function tableForIdKey(key: string): string | null {
  const base = keyBase(key);
  if (!base) return null;
  const alias = KEY_ALIASES[base];
  if (alias) return alias;
  const candidates = [base, `${base}s`, `${base}es`, base.replace(/y$/, "ies")];
  return candidates.find((c) => MANIFEST_KEY_TABLES.includes(c)) ?? null;
}

/** The table of a reference: an offline id's own table, else its key's. */
export function tableOfReference(ref: Pick<IdReference, "key" | "value">): string | null {
  if (isOfflineId(ref.value)) return decodeOfflineId(ref.value)?.table ?? null;
  return tableForIdKey(ref.key);
}

function nameKeys(key: string, suffix: "name" | "phone"): string[] {
  const prefix = key.replace(/(_id|Id)$/, "");
  const cap = suffix === "name" ? "Name" : "Phone";
  const keys = [`${prefix}_${suffix}`, `${prefix}${cap}`];
  if (tableForIdKey(key) === "clients") {
    keys.push(`client_${suffix}`, `client${cap}`, `customer_${suffix}`, `customer${cap}`);
  }
  return [...new Set(keys)];
}

function siblingText(parent: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = parent[k];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

type ObjectVisitor = (obj: Record<string, unknown>, path: string) => Record<string, unknown>;

/** Rebuild `value`, letting `onObject` edit each plain object (after its
 *  children). Embedded JSON strings are parsed, walked and re-stringified. */
function mapObjects(value: unknown, path: string, onObject: ObjectVisitor): unknown {
  if (Array.isArray(value)) return value.map((v, i) => mapObjects(v, `${path}[${i}]`, onObject));
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const p = path ? `${path}.${k}` : k;
    if (EMBEDDED_JSON_KEYS.includes(k) && typeof v === "string") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(v);
      } catch {
        out[k] = v;
        continue;
      }
      out[k] = parsed && typeof parsed === "object" ? JSON.stringify(mapObjects(parsed, p, onObject)) : v;
      continue;
    }
    out[k] = mapObjects(v, p, onObject);
  }
  return onObject(out, path);
}

/** Every integer in an id position, with its key and the PC's label. */
export function collectIdReferences(payload: unknown): IdReference[] {
  const found: IdReference[] = [];
  mapObjects(payload, "", (obj, path) => {
    for (const [k, v] of Object.entries(obj)) {
      const p = path ? `${path}.${k}` : k;
      if (SINGLE_ID_KEY.test(k)) {
        const n = parseIdLike(v);
        if (n !== null && n > 0) found.push({ path: p, key: k, value: n, label: siblingText(obj, nameKeys(k, "name")), inArray: false });
      } else if (ID_ARRAY_KEY.test(k) && Array.isArray(v)) {
        v.forEach((x, i) => {
          const n = parseIdLike(x);
          if (n !== null && n > 0) found.push({ path: `${p}[${i}]`, key: k, value: n, label: null, inArray: true });
        });
      }
    }
    return obj;
  });
  return found;
}

export interface ClientReplacement {
  id: number;
  name: string;
  phone: string | null;
}

/**
 * Replace the single-id positions at `paths` with another client
 * (`replacement`) or with no client (`null` = walk-in: the id becomes null
 * and the name/phone the PC showed are removed, so no service re-creates
 * the removed client from them). Returns the paths it could not replace
 * (an id array element, or a path not found) — the caller refuses then.
 * `dropKey`: walk-in removes the id key instead of writing null (for a
 * schema whose client key is optional but not nullable).
 */
export function replaceIdReferences<T>(
  payload: T,
  paths: readonly string[],
  replacement: ClientReplacement | null,
  opts: { dropKey?: boolean } = {},
): { payload: T; missing: string[] } {
  const pending = new Set(paths);
  const out = mapObjects(payload, "", (obj, path) => {
    const next = { ...obj };
    for (const k of Object.keys(obj)) {
      const p = path ? `${path}.${k}` : k;
      if (!pending.has(p) || !SINGLE_ID_KEY.test(k)) continue;
      pending.delete(p);
      const asString = typeof obj[k] === "string";
      const names = nameKeys(k, "name").filter((nk) => nk in obj);
      const phones = nameKeys(k, "phone").filter((pk) => pk in obj);
      if (replacement) {
        next[k] = asString ? String(replacement.id) : replacement.id;
        for (const nk of names) next[nk] = replacement.name;
        for (const pk of phones) next[pk] = replacement.phone ?? "";
      } else {
        if (opts.dropKey) delete next[k];
        else next[k] = null;
        for (const nk of [...names, ...phones]) delete next[nk];
      }
    }
    return next;
  }) as T;
  return { payload: out, missing: [...pending] };
}

export type ClientChoiceResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; reason: "not_replaceable" | "client_required" };

/**
 * The ONE builder of the payload an Apply-with-replacement books (rule 22):
 * another client replaces the removed one; walk-in writes null, or drops the
 * key when the channel's recorded schema refuses null. When neither parses
 * the action needs a client (e.g. a debt repayment) → `client_required`.
 */
export function applyClientChoice(
  channel: string,
  payload: Record<string, unknown>,
  paths: readonly string[],
  replacement: ClientReplacement | null,
): ClientChoiceResult {
  const first = replaceIdReferences(payload, paths, replacement);
  if (first.missing.length > 0) return { ok: false, reason: "not_replaceable" };
  const schema = recordedSchema(channel);
  if (replacement || !schema || schema.safeParse(first.payload).success) return { ok: true, payload: first.payload };
  const dropped = replaceIdReferences(payload, paths, null, { dropKey: true });
  if (schema.safeParse(dropped.payload).success) return { ok: true, payload: dropped.payload };
  return { ok: false, reason: "client_required" };
}
