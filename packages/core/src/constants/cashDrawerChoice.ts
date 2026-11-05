/**
 * LIRA-371 — the cash-drawer choice on Debts → Repay and the main-system
 * supplier's settle screens: "OMT Cash Drawer | General" (Whish on a Whish
 * shop). `SYSTEM` (the default) keeps today's routing; `GENERAL` keeps the
 * cash in (or takes it out of) the General drawer.
 *
 * Pure leaf: imports nothing (rule 29 — reachable from `browser.ts`). The
 * value list, the refusal sentence and the supplier applicability predicate
 * live here ONCE and are shared by the screens and the server (rule 14).
 */

export const CASH_DRAWER_CHOICES = ["SYSTEM", "GENERAL"] as const;

export type CashDrawerChoice = (typeof CASH_DRAWER_CHOICES)[number];

/** Refusal sentence when `GENERAL` is sent where the choice does not apply. */
export function cashDrawerChoiceNotApplicable(
  baseSystem: "OMT" | "WHISH",
): string {
  const system = baseSystem === "OMT" ? "an OMT" : "a Whish";
  return `The drawer choice only applies when cash pays ${system} system transfer. Nothing to choose here.`;
}

export interface SystemCashDrawerChoiceInput {
  /** The supplier's (transaction's) provider, e.g. "OMT", "WHISH", "KATSH". */
  provider: string | null | undefined;
  /** The shop's main system. */
  baseSystem: "OMT" | "WHISH";
  /** Every IN and OUT leg of the payment. */
  legs: ReadonlyArray<{ method: string }>;
  /** True when this method is drawer cash bound to General by default. */
  isGeneralCash: (method: string) => boolean;
}

/**
 * Supplier settle / Pay-Receive: the choice applies iff the payment runs on
 * the shop's main system AND at least one leg (IN or OUT) is General-bound
 * drawer cash, i.e. would land in the system cash drawer by default.
 */
export function systemCashDrawerChoiceApplies(
  input: SystemCashDrawerChoiceInput,
): boolean {
  const { provider, baseSystem, legs, isGeneralCash } = input;
  return provider === baseSystem && legs.some((l) => isGeneralCash(l.method));
}
