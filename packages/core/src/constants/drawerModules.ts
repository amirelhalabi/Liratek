/**
 * Which module owns which drawer, and which drawers no module may hide.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * This mapping was written out FOUR times, independently, and every copy was
 * wrong in the same way:
 *
 *   Dashboard.tsx              `drawerModuleMap`            (which cards show)
 *   StepDrawerAmounts.tsx      `DRAWER_MODULE_REQUIREMENT`  (opening balances)
 *   InitialDrawerAmountsModal  `DRAWER_MODULE_REQUIREMENT`  (opening balances)
 *   ModulesManager.tsx         `RECHARGE_PROVIDERS[].module`(Settings table)
 *
 * The third one carried the comment "mirrors Dashboard drawerModuleMap",
 * which is the copy-paste rule 14 exists to prevent, admitted in writing. All
 * four claimed the OMT and Whish drawers belonged to `ipec_katch` — the
 * iPick/Katsh module. They do not: OMT/Whish is `omt_whish`, its own module,
 * enabled by default. So a tenant with `ipec_katch` off — which is EVERY
 * web-provisioned tenant, since seedConfig ships it disabled — lost four
 * drawers to a module they had switched on.
 *
 * ── Why that mattered beyond the dashboard ──────────────────────────────────
 *
 * Two of those copies gate which drawers the operator is ASKED TO COUNT when
 * setting opening balances. `OMT_System` is not a feature: FEATURE_GUIDE §235
 * defines it as "the banknotes physically inside the dedicated money-transfer
 * drawer at the counter — the same kind of countable cash as General, counted
 * at closing the same way". Gating it meant a shop could be holding real
 * banknotes in a real drawer that was never given an opening balance, so no
 * starting checkpoint existed and closing could not reconcile it. Hiding a
 * card is cosmetic; skipping the count of physical cash is not.
 *
 * Hence the two ideas here, deliberately separate:
 *
 *   UNGATED_DRAWERS      drawers holding till cash. No module may hide them,
 *                        because the money is in the till whatever the
 *                        feature flags say.
 *   DRAWER_MODULE_OWNER  provider wallets, which genuinely belong to a
 *                        feature and should vanish with it.
 *
 * Consume `isDrawerVisible()` rather than reading the table directly — that is
 * what keeps the four call sites from drifting apart again.
 */

import { PRIMARY_CASH_DRAWER_NAMES } from "./systemFloatDrawers.js";

/**
 * The three provider modules the UI consolidates into one "Mobile Recharge"
 * entry (one sidebar link, one grouped row in Settings, one group in the setup
 * wizard). Restated in four files before this — Sidebar, HomeGrid,
 * ModulesManager and Step2Modules — so adding a fourth provider meant editing
 * four lists and silently half-working if you missed one.
 *
 * `omt_whish` is deliberately NOT here. It is a peer module with its own
 * route, not a recharge provider, and treating it as one is the same mistake
 * this file corrects.
 */
export const RECHARGE_MODULE_KEYS = [
  "recharge",
  "ipec_katch",
  "binance",
] as const;

export type RechargeModuleKey = (typeof RECHARGE_MODULE_KEYS)[number];

/** Is this module one of the consolidated "Mobile Recharge" providers? */
export function isRechargeModuleKey(key: string): key is RechargeModuleKey {
  return (RECHARGE_MODULE_KEYS as readonly string[]).includes(key);
}

/**
 * Drawers that hold physical cash at the counter and are therefore ALWAYS
 * shown and always counted, whatever any module flag says.
 *
 * `General` plus both primary cash drawers. The PCD names come from
 * PRIMARY_CASH_DRAWER_NAMES rather than being retyped, so if that list ever
 * changes this follows it.
 */
export const UNGATED_DRAWERS: readonly string[] = [
  "General",
  ...PRIMARY_CASH_DRAWER_NAMES,
];

/**
 * Provider wallet drawers → the module that owns them.
 *
 * A drawer absent from this table is ungated: unknown drawer names are shown
 * rather than hidden, which is the safe direction. A drawer nobody recognises
 * may still hold money, and a visible drawer that shouldn't be there is a
 * question; an invisible one holding cash is a loss.
 */
export const DRAWER_MODULE_OWNER: Readonly<Record<string, string>> = {
  // App wallets — the actual OMT/Whish module, not iPick/Katsh.
  OMT_App: "omt_whish",
  Whish_App: "omt_whish",
  // iPick/Katsh.
  iPick: "ipec_katch",
  Katsh: "ipec_katch",
  // Mobile recharge carriers.
  MTC: "recharge",
  Alfa: "recharge",
  // Crypto.
  Binance: "binance",
};

/**
 * The module that owns `drawer`, or null when nothing gates it (till cash, or
 * a drawer this table does not know about).
 */
export function moduleOwningDrawer(drawer: string): string | null {
  if (UNGATED_DRAWERS.includes(drawer)) return null;
  return DRAWER_MODULE_OWNER[drawer] ?? null;
}

/**
 * Should `drawer` be offered to the operator — as a dashboard card, or as a
 * balance to count?
 *
 * The single predicate every call site shares. `isModuleEnabled` is passed in
 * rather than imported so this stays free of React and usable from either
 * transport (rule 13's spirit: the policy lives here, the plumbing does not).
 */
export function isDrawerVisible(
  drawer: string,
  isModuleEnabled: (key: string) => boolean,
): boolean {
  const owner = moduleOwningDrawer(drawer);
  return owner === null || isModuleEnabled(owner);
}

/** Every drawer this table knows a module for, owned by `moduleKey`. */
export function drawersOwnedByModule(moduleKey: string): string[] {
  return Object.keys(DRAWER_MODULE_OWNER).filter(
    (d) => DRAWER_MODULE_OWNER[d] === moduleKey,
  );
}
