/**
 * The two "primary cash drawer" (PCD) names — `OMT_System` when
 * `shop_base_system = 'OMT'`, `Whish_System` when `'WHISH'`
 * (docs/plans/todo_plans/PRIMARY_CASH_DRAWER_PLAN.md §8.1).
 *
 * Superseded meaning (owner verdict 2026-07-30): these drawers are NOT a
 * spendable float held inside the provider's own system (PR #66's model,
 * rejected by the owner: "we dont have omt system balance.. no need for
 * another drawer. we can use our omt system drawer") — they ARE the
 * physical cash drawer at the shop's money-transfer counter, countable at
 * closing like any cash box. The drawer-name STRINGS never change; only
 * their meaning and the constant/type names do (renaming the strings
 * themselves would touch ~30 sites for zero user value).
 *
 * Single definition (CLAUDE.md rule 14) consumed by:
 *  - `resolveServiceCashDrawer` (`utils/payments.ts`) — the routing
 *    resolver every primary-system SEND/RECEIVE cash leg goes through,
 *  - `DrawerTopUpRepository` / `DrawerTopUpService` (the repository/service
 *    allow-list for the generic drawer-transfer mechanism — General ↔ PCD,
 *    both directions),
 *  - `validators/drawerTransfer.ts` (the Zod schema derives its
 *    `z.enum([...])` from this list instead of re-declaring it, so the
 *    schema and the repository/service allow-list cannot drift apart).
 */
export const PRIMARY_CASH_DRAWER_NAMES = [
  "OMT_System",
  "Whish_System",
] as const;

export type PrimaryCashDrawerName = (typeof PRIMARY_CASH_DRAWER_NAMES)[number];

/** Resolve the primary cash drawer name for whichever system is primary. */
export function primaryCashDrawerName(
  baseSystem: "OMT" | "WHISH",
): PrimaryCashDrawerName {
  return baseSystem === "OMT" ? "OMT_System" : "Whish_System";
}
