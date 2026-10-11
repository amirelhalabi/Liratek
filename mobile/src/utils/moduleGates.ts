import { isDrawerVisible } from "@liratek/core/constants/drawerModules";

/**
 * Which parts of the phone app the shop's module switches allow (LIRA-307):
 * the same switches as the web's Settings → Modules, read from
 * GET /api/modules/enabled. Pure, so the rules are unit-tested without React.
 *
 * Fail closed (owner decision D3): until the list has been fetched in this
 * run of the app, nothing gated is enabled.
 */

/**
 * All four phone sales (Whish App, OMT App, Katsh, iPick) follow this switch,
 * as the web Recharge tabs do: frontend/src/features/recharge/types/index.ts
 * gives each of those providers `module: "ipec_katch"` (owner decision D1).
 */
export const SALE_MODULE = "ipec_katch";
export const DEBTS_MODULE = "debts";

export interface GateState {
  /** True once the list was fetched in this run of the app. */
  verified: boolean;
  isEnabled: (key: string) => boolean;
}

/**
 * The module keys from a GET /api/modules/enabled body. Throws on any other
 * shape, so the read fails and the gate stays closed.
 */
export function parseEnabledModuleKeys(body: unknown): ReadonlySet<string> {
  if (typeof body !== "object" || body === null) throw new Error("MODULES_MALFORMED");
  const { success, modules } = body as { success?: unknown; modules?: unknown };
  if (success !== true || !Array.isArray(modules)) throw new Error("MODULES_MALFORMED");
  const keys = new Set<string>();
  for (const m of modules) {
    const key = typeof m === "object" && m !== null ? (m as { key?: unknown }).key : undefined;
    if (typeof key !== "string") throw new Error("MODULES_MALFORMED");
    keys.add(key);
  }
  return keys;
}

const CLOSED: GateState = { verified: false, isEnabled: () => false };

/** The gate for a fetched list, or closed when there is none yet. */
export function gateFrom(keys: ReadonlySet<string> | undefined): GateState {
  if (!keys) return CLOSED;
  return { verified: true, isEnabled: (key) => keys.has(key) };
}

/** The Sell tab: all its sales follow iPick/Katsh, so it hides when that is off (owner decision D2). */
export function sellTabVisible(gate: GateState): boolean {
  return gate.isEnabled(SALE_MODULE);
}

/** The Debts tab follows Accounts (`debts`), as the web's Accounts entry does. */
export function debtsTabVisible(gate: GateState): boolean {
  return gate.isEnabled(DEBTS_MODULE);
}

/**
 * Home's drawer lines: hide a drawer whose owning module is off, with core's
 * rule the web Dashboard uses (drawers no module owns always show).
 */
export function visibleDrawers(drawers: readonly string[], gate: GateState): string[] {
  return drawers.filter((d) => isDrawerVisible(d, gate.isEnabled));
}
