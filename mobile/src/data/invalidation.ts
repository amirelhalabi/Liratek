import type { QueryKey } from "@tanstack/react-query";

import { queryClient } from "./queryClient";
import { queryKeys } from "./queryKeys";

/** A money action the phone just booked successfully (data-model § Invalidation map). */
export type BookedAction =
  | { kind: "sale"; paidBy: string; clientId: number | null }
  | { kind: "repayment"; clientId: number };

/** Which cached reads an action makes out of date. Pure, so it is unit-tested. */
export function keysToInvalidate(shop: string, action: BookedAction): QueryKey[] {
  const keys: QueryKey[] = [queryKeys.balances(shop), queryKeys.sinceLastCountAll(shop), queryKeys.recentAll(shop)];
  const touchesDebt = action.kind === "repayment" || action.paidBy === "CUSTOMER_ACCOUNT";
  if (touchesDebt) {
    keys.push(queryKeys.debtors(shop));
    if (action.clientId !== null) keys.push(queryKeys.clientBalance(shop, action.clientId));
  }
  return keys;
}

/** Mounted screens refetch at once; the others refetch when next shown. */
export function invalidateAfter(shop: string, action: BookedAction): Promise<void> {
  return Promise.all(keysToInvalidate(shop, action).map((queryKey) => queryClient.invalidateQueries({ queryKey }))).then(
    () => undefined,
  );
}
