/**
 * LIRA-399 (owner 2026-11-18, option A) — the cash drawer is chosen ON the
 * cash line: the method list of a main-system supplier's payment box offers
 * "Cash · OMT Cash Drawer" (code CASH, today's routing) and "Cash · General"
 * (code CASH_GENERAL). The second is a screen-only code: the payload leg
 * carries `method: "CASH", cash_drawer: "GENERAL"` (the schema's own key).
 * ONE place turns the code into the leg (rule 14).
 */
import type { CashMethodInfo } from "./isGeneralCash";

export const CASH_GENERAL_CODE = "CASH_GENERAL";

/** A method as the forms list it: the shown label, and the bare one the
 *  database holds ("Cash"), kept so a second relabel never stacks. */
export interface LabelledMethod {
  code: string;
  label: string;
  rawLabel?: string;
}

/** "Cash" → "Cash · <drawer>" (owner 2026-11-18: the label names where the
 *  cash goes). Only the CASH entry changes; others pass through. */
export function labelCashByDrawer<T extends LabelledMethod>(
  methods: readonly T[],
  drawerLabel: string,
): Array<T & { rawLabel?: string }> {
  return methods.map((m) =>
    m.code === "CASH"
      ? {
          ...m,
          rawLabel: m.rawLabel ?? m.label,
          label: `${m.rawLabel ?? m.label} · ${drawerLabel}`,
        }
      : m,
  );
}

/** The payload leg fields a line's method code stands for. */
export function legFromMethodCode(code: string): {
  method: string;
  cash_drawer?: "GENERAL";
} {
  return code === CASH_GENERAL_CODE
    ? { method: "CASH", cash_drawer: "GENERAL" }
    : { method: code };
}

/** The real payment method behind a line's code. */
export function baseMethodCode(code: string): string {
  return code === CASH_GENERAL_CODE ? "CASH" : code;
}

/**
 * The method list with the Cash entry split in two, drawer named. Only the
 * CASH entry is touched; a list without it is returned as is.
 */
export function withCashDrawerMethods<
  T extends CashMethodInfo & LabelledMethod,
>(
  methods: readonly T[],
  labels: { system: string; general: string },
): Array<T | { code: string; label: string }> {
  const out: Array<T | { code: string; label: string }> = [];
  for (const m of methods) {
    if (m.code !== "CASH") {
      out.push(m);
      continue;
    }
    const base = m.rawLabel ?? m.label;
    out.push({ ...m, label: `${base} · ${labels.system}` });
    out.push({ code: CASH_GENERAL_CODE, label: `${base} · ${labels.general}` });
  }
  return out;
}
