import { HOLD_MONEY_METHODS } from "@liratek/core";
import type { PaymentLine } from "@liratek/ui";

export interface HoldMoneyMethodOption {
  code: string;
  label: string;
}

/**
 * Shown while the shop's payment methods are still loading (shop-day
 * 2026-10-16: the Hold Money dropdowns sat EMPTY for 1.5 s+ until
 * `usePaymentMethods` answered). The payment lines already default to CASH,
 * so offering Cash keeps the dropdown truthful from the first paint; the
 * real list replaces it as soon as it arrives.
 */
const CASH_ONLY: readonly HoldMoneyMethodOption[] = [
  // i18n-exempt: same English label as the payment_methods table rows it stands in for
  { code: "CASH", label: "Cash" },
];

/**
 * The methods a hold / pickup may use: the shop's active methods filtered to
 * HOLD_MONEY_METHODS (the SAME allow-list the server enforces — rule 14),
 * or Cash alone while that list has not loaded.
 */
export function holdMoneyMethodOptions(
  methods: readonly HoldMoneyMethodOption[],
): HoldMoneyMethodOption[] {
  const allowed = methods.filter((m) =>
    (HOLD_MONEY_METHODS as readonly string[]).includes(m.code),
  );
  return allowed.length > 0 ? allowed : [...CASH_ONLY];
}

/** Every leg names a method the form offers — never an empty one. */
export function holdMoneyLegsHaveMethods(
  lines: readonly Pick<PaymentLine, "method">[],
  options: readonly HoldMoneyMethodOption[],
): boolean {
  return lines.every(
    (l) => !!l.method && options.some((o) => o.code === l.method),
  );
}
