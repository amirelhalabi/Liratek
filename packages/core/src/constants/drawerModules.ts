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

import {
  PRIMARY_CASH_DRAWER_NAMES,
  primaryCashDrawerName,
} from "./systemFloatDrawers.js";

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
 * What a screen knows about the shop when it decides which drawers to show.
 * Both fields are optional: leave one out (or pass null) while it is still
 * loading, and nothing is hidden on its account.
 */
export interface DrawerVisibilityContext {
  /** The shop's primary money-transfer system (`shop_base_system`). */
  baseSystem?: "OMT" | "WHISH" | null;
  /** This drawer's current balance per currency. */
  balances?: Readonly<Record<string, number>> | null;
}

/** Below this, a balance is floating-point dust, not money. */
const EMPTY_BALANCE_EPSILON = 0.005;

/**
 * Is `drawer` the OTHER system's cash drawer, holding nothing?
 *
 * A shop keeps two physical drawers: General and one for its primary system.
 * Secondary-system cash already goes to General (`resolveServiceCashDrawer`),
 * yet every tenant is seeded with both system drawers. Showing the secondary
 * one put an always-empty card on the dashboard and asked the cashier to
 * count a drawer the shop does not have — on the test tenant that count typed
 * real-looking money into it (2026-10-16).
 *
 * Only an EMPTY secondary drawer is idle. One holding money stays visible so
 * the money is never hidden; moving it to General makes it idle. Unknown base
 * system or balance → not idle (the safe direction).
 */
export function isIdleSecondaryCashDrawer(
  drawer: string,
  ctx: DrawerVisibilityContext,
): boolean {
  const { baseSystem, balances } = ctx;
  if (!baseSystem || !balances) return false;
  if (!(PRIMARY_CASH_DRAWER_NAMES as readonly string[]).includes(drawer)) {
    return false;
  }
  if (drawer === primaryCashDrawerName(baseSystem)) return false;
  return !Object.values(balances).some(
    (amount) => Math.abs(amount) >= EMPTY_BALANCE_EPSILON,
  );
}

/**
 * Should `drawer` be offered to the operator — as a dashboard card, or as a
 * balance to count?
 *
 * The single predicate every call site shares. `isModuleEnabled` is passed in
 * rather than imported so this stays free of React and usable from either
 * transport (rule 13's spirit: the policy lives here, the plumbing does not).
 * Pass `ctx` to also hide the secondary system's empty cash drawer.
 */
export function isDrawerVisible(
  drawer: string,
  isModuleEnabled: (key: string) => boolean,
  ctx: DrawerVisibilityContext = {},
): boolean {
  if (isIdleSecondaryCashDrawer(drawer, ctx)) return false;
  const owner = moduleOwningDrawer(drawer);
  return owner === null || isModuleEnabled(owner);
}

/** Every drawer this table knows a module for, owned by `moduleKey`. */
export function drawersOwnedByModule(moduleKey: string): string[] {
  return Object.keys(DRAWER_MODULE_OWNER).filter(
    (d) => DRAWER_MODULE_OWNER[d] === moduleKey,
  );
}
