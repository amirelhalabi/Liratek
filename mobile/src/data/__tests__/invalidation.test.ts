import { keysToInvalidate } from "../invalidation";
import { queryKeys } from "../queryKeys";

const S = "cornertech";
const asSet = (keys: readonly (readonly unknown[])[]) => new Set(keys.map((k) => JSON.stringify(k)));

const MONEY_VIEWS = [queryKeys.balances(S), queryKeys.sinceLastCountAll(S), queryKeys.recentAll(S)];

describe("keysToInvalidate — data-model invalidation map (LIRA-300)", () => {
  it.each(["WHISH", "OMT"])("transfer paid into the %s wallet: balances, since-last-count, recent only", (paidBy) => {
    const keys = keysToInvalidate(S, { kind: "transfer", paidBy, clientId: 12 });
    expect(asSet(keys)).toEqual(asSet(MONEY_VIEWS));
  });

  it("transfer on the customer's account also marks the debt list and that customer's balance", () => {
    const keys = keysToInvalidate(S, { kind: "transfer", paidBy: "CUSTOMER_ACCOUNT", clientId: 12 });
    expect(asSet(keys)).toEqual(asSet([...MONEY_VIEWS, queryKeys.debtors(S), queryKeys.clientBalance(S, 12)]));
  });

  it("repayment marks the money views, the debt list and that customer's balance", () => {
    const keys = keysToInvalidate(S, { kind: "repayment", clientId: 5 });
    expect(asSet(keys)).toEqual(asSet([...MONEY_VIEWS, queryKeys.debtors(S), queryKeys.clientBalance(S, 5)]));
  });

  it("every key it returns belongs to the shop", () => {
    for (const k of keysToInvalidate(S, { kind: "repayment", clientId: 5 })) expect(k[0]).toBe(S);
  });
});
