/**
 * Schema shape descriptors (LIRA-306, R9, FR-016) — PURE, browser-safe.
 *
 * An offline event stores the shape of the schema its payload was parsed
 * with (keys, base types, optional / nullable / default). On replay the
 * server compares it with today's schema: compatible ⇔ every event key
 * exists unchanged and every key only the server has is optional WITHOUT a
 * default. Zod silently strips renamed keys and silently fills `.default()`s
 * (rules 22/23), so anything else is refused for re-entry instead of being
 * booked with a field quietly lost or invented.
 *
 * Works on zod 4 AND zod 3 internals (see `defOf`); validation constraints
 * (min, regex, refine) are deliberately NOT part of the shape.
 */
import type { z } from "zod";
import { canonicalJson } from "./canonicalJson.js";

export interface ShapeNode {
  type: string;
  optional?: true;
  nullable?: true;
  hasDefault?: true;
  /** JSON text of the default value (when it serialises) */
  default?: string;
  keys?: Record<string, ShapeNode>;
  /** object with passthrough / catchall */
  extraKeys?: true;
  element?: ShapeNode;
  options?: ShapeNode[];
  values?: Array<string | number | boolean | null>;
}

interface Def {
  type: string;
  /** zod 3 normalisation: passthrough / non-never catchall */
  passthrough?: boolean;
  innerType?: z.ZodType;
  defaultValue?: unknown;
  in?: z.ZodType;
  out?: z.ZodType;
  options?: z.ZodType[];
  values?: unknown[];
  entries?: Record<string, unknown>;
  element?: z.ZodType;
  shape?: Record<string, z.ZodType>;
  catchall?: z.ZodType;
  getter?: () => z.ZodType;
  left?: z.ZodType;
  right?: z.ZodType;
  items?: z.ZodType[];
  valueType?: z.ZodType;
}

/**
 * The schema's definition in zod v4 form, whichever zod built it.
 *
 * Core is typed against zod 4, but at RUNTIME the built package resolves the
 * repo's hoisted zod (3.25 today) in the backend and the desktop app, so its
 * schemas are zod 3 objects there (`_def.typeName`), and zod 4 objects under
 * core's own jest (`def.type`). Found by running the web e2e (rule 28): the
 * jest-only version crashed on the first real upload. Both are normalised
 * here so shapes, envelopes and fixtures work on either.
 */
export function defOf(schema: z.ZodType): Def {
  const s = schema as unknown as {
    def?: Def;
    _zod?: { def?: Def };
    _def?: Record<string, unknown> & { typeName?: string };
  };
  if (s.def && typeof s.def.type === "string") return s.def;
  if (s._zod?.def && typeof s._zod.def.type === "string") return s._zod.def;
  const d = s._def;
  if (!d || typeof d.typeName !== "string") return { type: "unknown" };
  const t = <T>(k: string) => d[k] as T;
  switch (d.typeName) {
    case "ZodObject": {
      const shape = typeof d.shape === "function" ? (d.shape as () => Record<string, z.ZodType>)() : t<Record<string, z.ZodType>>("shape");
      const catchall = t<z.ZodType | undefined>("catchall");
      const catchallIsNever = !catchall || (catchall as unknown as { _def?: { typeName?: string } })._def?.typeName === "ZodNever";
      return {
        type: "object",
        shape,
        passthrough: d.unknownKeys === "passthrough" || !catchallIsNever,
      };
    }
    case "ZodOptional":
      return { type: "optional", innerType: t("innerType") };
    case "ZodNullable":
      return { type: "nullable", innerType: t("innerType") };
    case "ZodDefault": {
      const dv = d.defaultValue;
      return { type: "default", innerType: t("innerType"), defaultValue: typeof dv === "function" ? (dv as () => unknown)() : dv };
    }
    case "ZodCatch":
      return { type: "catch", innerType: t("innerType") };
    case "ZodReadonly":
      return { type: "readonly", innerType: t("innerType") };
    case "ZodBranded":
      return { type: "readonly", innerType: t("type") };
    case "ZodEffects":
      return { type: "pipe", in: t("schema") };
    case "ZodPipeline":
      return { type: "pipe", in: t("in") };
    case "ZodLazy":
      return { type: "lazy", getter: t("getter") };
    case "ZodArray":
      return { type: "array", element: t("type") };
    case "ZodUnion":
      return { type: "union", options: t("options") };
    case "ZodDiscriminatedUnion": {
      const o = d.options as z.ZodType[] | Map<unknown, z.ZodType>;
      return { type: "union", options: Array.isArray(o) ? o : [...o.values()] };
    }
    case "ZodLiteral":
      return { type: "literal", values: [d.value] };
    case "ZodEnum":
      return { type: "enum", entries: Object.fromEntries((d.values as string[]).map((v) => [v, v])) };
    case "ZodNativeEnum":
      return { type: "enum", entries: t("values") };
    case "ZodIntersection":
      return { type: "intersection", left: t("left"), right: t("right") };
    case "ZodTuple":
      return { type: "tuple", items: t("items") };
    case "ZodRecord":
      return { type: "record", valueType: t("valueType") };
    default:
      return { type: d.typeName.replace(/^Zod/, "").toLowerCase() };
  }
}

function safeJson(v: unknown): string | undefined {
  try {
    return JSON.stringify(v);
  } catch {
    return undefined;
  }
}

export function describeShape(schema: z.ZodType): ShapeNode {
  const def = defOf(schema);
  switch (def.type) {
    case "optional":
      return { ...describeShape(def.innerType!), optional: true };
    case "nullable":
      return { ...describeShape(def.innerType!), nullable: true };
    case "default":
    case "prefault": {
      const inner = describeShape(def.innerType!);
      const value = def.defaultValue;
      const text = safeJson(typeof value === "function" ? undefined : value);
      return { ...inner, hasDefault: true, ...(text !== undefined ? { default: text } : {}) };
    }
    case "catch":
    case "readonly":
    case "nonoptional":
      return describeShape(def.innerType!);
    case "pipe":
      return describeShape(def.in!);
    case "lazy":
      return { type: "lazy" };
    case "object": {
      const shape = def.shape ?? {};
      const keys: Record<string, ShapeNode> = {};
      for (const k of Object.keys(shape).sort()) keys[k] = describeShape(shape[k]);
      const node: ShapeNode = { type: "object", keys };
      if (def.passthrough || (def.catchall && defOf(def.catchall).type !== "never")) node.extraKeys = true;
      return node;
    }
    case "array":
      return { type: "array", element: describeShape(def.element!) };
    case "union":
      return { type: "union", options: (def.options ?? []).map(describeShape) };
    case "literal":
      return { type: "literal", values: (def.values ?? []) as ShapeNode["values"] };
    case "enum":
      return { type: "enum", values: Object.values(def.entries ?? {}) as ShapeNode["values"] };
    case "intersection":
      return { type: "intersection", options: [describeShape(def.left!), describeShape(def.right!)] };
    case "tuple":
      return { type: "tuple", options: (def.items ?? []).map(describeShape) };
    case "record":
      return { type: "record", element: def.valueType ? describeShape(def.valueType) : undefined };
    default:
      return { type: def.type };
  }
}

function sameFlags(a: ShapeNode, b: ShapeNode): boolean {
  return (
    !!a.optional === !!b.optional &&
    !!a.nullable === !!b.nullable &&
    !!a.hasDefault === !!b.hasDefault &&
    a.default === b.default
  );
}

/**
 * True when a payload recorded against `event` can be parsed by `server`
 * without Zod silently dropping or inventing anything.
 */
export function isCompatible(event: ShapeNode, server: ShapeNode): boolean {
  if (event.type !== server.type || !sameFlags(event, server)) return false;
  if (event.type === "object") {
    const ek = event.keys ?? {};
    const sk = server.keys ?? {};
    if (!!event.extraKeys !== !!server.extraKeys) return false;
    for (const k of Object.keys(ek)) {
      if (!(k in sk) || !isCompatible(ek[k], sk[k])) return false;
    }
    for (const k of Object.keys(sk)) {
      if (k in ek) continue;
      if (!sk[k].optional || sk[k].hasDefault) return false;
    }
    return true;
  }
  return canonicalJson(event) === canonicalJson(server);
}

// ---------------------------------------------------------------------------
// Key walk (used by the id-position guard)
// ---------------------------------------------------------------------------

/** Every object key reachable in a schema, as `a.b[].c` paths. */
export function schemaKeyPaths(schema: z.ZodType, prefix = ""): string[] {
  return shapeKeyPaths(describeShape(schema), prefix);
}

export function shapeKeyPaths(node: ShapeNode, prefix = ""): string[] {
  const out: string[] = [];
  if (node.type === "object") {
    for (const [k, child] of Object.entries(node.keys ?? {})) {
      const p = prefix ? `${prefix}.${k}` : k;
      out.push(p, ...shapeKeyPaths(child, p));
    }
  } else if (node.type === "array" && node.element) {
    out.push(...shapeKeyPaths(node.element, `${prefix}[]`));
  } else if (node.options) {
    for (const o of node.options) out.push(...shapeKeyPaths(o, prefix));
  }
  return [...new Set(out)];
}

// ---------------------------------------------------------------------------
// Fixtures derived from a schema (rule 24 — field names come from the schema)
// ---------------------------------------------------------------------------

const STRING_CANDIDATES = [
  "x",
  "2026-10-11",
  "2026-10-11 10:00:00",
  "2026-10-11T10:00:00.000Z",
  "USD",
  "CASH",
  "1",
  "00000000-0000-4000-8000-000000000000",
  "a@b.co",
];
const NUMBER_CANDIDATES = [1, 2, 10, 0, 0.5, 100, -1];

function firstPassing(schema: z.ZodType, candidates: unknown[]): unknown {
  for (const c of candidates) if (schema.safeParse(c).success) return c;
  return candidates[0];
}

function sample(schema: z.ZodType, allKeys: boolean): unknown {
  const def = defOf(schema);
  switch (def.type) {
    case "optional":
      return allKeys ? sample(def.innerType!, allKeys) : undefined;
    case "nullable":
    case "default":
    case "prefault":
    case "catch":
    case "readonly":
    case "nonoptional":
      return sample(def.innerType!, allKeys);
    case "pipe":
      return sample(def.in!, allKeys);
    case "lazy":
      return sample(def.getter!(), allKeys);
    case "string":
      return firstPassing(schema, STRING_CANDIDATES);
    case "number":
    case "int":
      return firstPassing(schema, NUMBER_CANDIDATES);
    case "boolean":
      return true;
    case "date":
      return new Date("2026-10-11T10:00:00.000Z");
    case "literal":
      return (def.values ?? [])[0];
    case "enum":
      return Object.values(def.entries ?? {})[0];
    case "array": {
      const el = sample(def.element!, allKeys);
      return firstPassing(schema, [[el], [el, el], []]);
    }
    case "tuple":
      return (def.items ?? []).map((i) => sample(i, allKeys));
    case "union": {
      const opts = (def.options ?? []).map((o) => sample(o, allKeys));
      return firstPassing(schema, opts);
    }
    case "intersection": {
      const l = sample(def.left!, allKeys);
      const r = sample(def.right!, allKeys);
      return l && r && typeof l === "object" && typeof r === "object" ? { ...l, ...r } : l;
    }
    case "record":
      return {};
    case "object": {
      const shape = def.shape ?? {};
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(shape)) {
        const s = sample(v, allKeys);
        if (s !== undefined) out[k] = s;
      }
      return out;
    }
    case "unknown":
    case "any":
      return {};
    case "null":
      return null;
    default:
      return undefined;
  }
}

/**
 * A value built from the schema's own keys that the schema accepts, when the
 * heuristics can find one: required keys only, then every key, then the
 * required keys plus one optional key at a time (refinements such as
 * "credits and/or validity" need exactly one of them).
 */
export function sampleFor(schema: z.ZodType): unknown {
  const required = sample(schema, false);
  if (schema.safeParse(required).success) return required;
  const all = sample(schema, true);
  if (schema.safeParse(all).success) return all;
  if (required && all && typeof required === "object" && typeof all === "object") {
    for (const [k, v] of Object.entries(all as Record<string, unknown>)) {
      if (k in (required as Record<string, unknown>)) continue;
      const attempt = { ...(required as Record<string, unknown>), [k]: v };
      if (schema.safeParse(attempt).success) return attempt;
    }
  }
  return required;
}
