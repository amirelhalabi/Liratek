/**
 * LIRA-371 — is this payment method drawer cash bound to General (the cash
 * the system cash drawer would take by default)? Moved out of the Debts
 * Repay preview with its exact rule, and shared with the settle screens
 * (rule 14):
 *  - GIFT_CARD and CUSTOMER_ACCOUNT are never cash;
 *  - a method with a `drawer_name` is cash iff it affects the drawer and
 *    that drawer is General;
 *  - a method without one is cash iff its code is CASH.
 */
export interface CashMethodInfo {
  code: string;
  drawer_name?: string;
  affects_drawer?: number;
}

export function isGeneralCash(
  code: string,
  methods: ReadonlyArray<CashMethodInfo>,
): boolean {
  if (code === "GIFT_CARD" || code === "CUSTOMER_ACCOUNT") return false;
  const m = methods.find((x) => x.code === code);
  return m && m.drawer_name !== undefined
    ? m.affects_drawer === 1 && m.drawer_name === "General"
    : code === "CASH";
}
