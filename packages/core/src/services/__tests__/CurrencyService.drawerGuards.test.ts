/**
 * CurrencyService.setCurrenciesForDrawer — the two write guards
 * (docs/plans/todo_plans/GENERAL_DRAWER_UNRESTRICTED.md §1a).
 *
 * `setCurrenciesForDrawer` is a DESTRUCTIVE replace-all (DELETE then INSERT),
 * and the closing count sheet filters its fields by that same allowlist. So
 * unticking a currency in Settings — one click + Save — used to make real cash
 * **uncountable**: the balance stayed visible on the Dashboard but lost its
 * count field, producing a permanent silent variance that nothing surfaced.
 *
 * Live example when this was written: `Katsh` held 2,957,925 LBP with LBP in
 * its allowlist. One untick away from stranding ~3M LBP. The first draft of
 * the plan guarded only the General drawer and would have missed it entirely
 * — hence the Katsh-shaped fixture below.
 *
 *   Layer 2 — a currency the drawer still HOLDS cannot be removed.
 *   Layer 3 — an unrestricted drawer (General) has no configurable list.
 *
 * Both guards live in the SERVICE, not the IPC handler, because the REST route
 * calls this same service and would otherwise bypass them (rule 19). These
 * tests therefore drive the service with a stub repository — which is also the
 * rule-13 payoff: no DB needed to prove a business rule.
 *
 * Rule 17 — proven against the pre-fix code: with the guards removed, every
 * `expect(success).toBe(false)` case below fails AND
 * `setCurrenciesForDrawer` is reached with the stranding payload.
 */

import type { CurrencyRepository } from "../../repositories/CurrencyRepository";
import { CurrencyService } from "../CurrencyService";

interface HeldBalance {
  currency_code: string;
  balance: number;
}

/** Minimal stub: only the two methods the guard path touches. */
function makeService(held: HeldBalance[]) {
  const setCurrenciesForDrawer = jest.fn();
  const getNonZeroBalancesForDrawer = jest.fn(() => held);

  const repo = {
    getNonZeroBalancesForDrawer,
    setCurrenciesForDrawer,
  } as unknown as CurrencyRepository;

  return {
    service: new CurrencyService(repo),
    setCurrenciesForDrawer,
    getNonZeroBalancesForDrawer,
  };
}

describe("CurrencyService.setCurrenciesForDrawer — Layer 3 (unrestricted drawer)", () => {
  it("refuses to configure General and never reaches the repository", () => {
    const { service, setCurrenciesForDrawer } = makeService([]);

    const result = service.setCurrenciesForDrawer("General", ["USD"]);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/accepts every currency/i);
    expect(setCurrenciesForDrawer).not.toHaveBeenCalled();
  });
});

describe("CurrencyService.setCurrenciesForDrawer — Layer 2 (held money)", () => {
  it("refuses to strip LBP from Katsh while it holds 2,957,925 LBP", () => {
    const { service, setCurrenciesForDrawer } = makeService([
      { currency_code: "LBP", balance: 2957925 },
    ]);

    const result = service.setCurrenciesForDrawer("Katsh", ["USD"]);

    expect(result.success).toBe(false);
    // The operator must be told WHICH currency and HOW MUCH — a bare
    // "operation failed" would just get retried.
    expect(result.error).toContain("LBP");
    expect(result.error).toContain("2,957,925");
    expect(result.error).toContain("Katsh");
    expect(setCurrenciesForDrawer).not.toHaveBeenCalled();
  });

  it("allows the save when the held currency is KEPT", () => {
    const { service, setCurrenciesForDrawer } = makeService([
      { currency_code: "LBP", balance: 2957925 },
    ]);

    const result = service.setCurrenciesForDrawer("Katsh", ["USD", "LBP"]);

    expect(result.success).toBe(true);
    expect(setCurrenciesForDrawer).toHaveBeenCalledWith("Katsh", [
      "USD",
      "LBP",
    ]);
  });

  it("allows removing a currency the drawer does NOT hold", () => {
    const { service, setCurrenciesForDrawer } = makeService([]);

    const result = service.setCurrenciesForDrawer("Katsh", ["USD"]);

    expect(result.success).toBe(true);
    expect(setCurrenciesForDrawer).toHaveBeenCalledWith("Katsh", ["USD"]);
  });

  it("is case-insensitive — lowercase input must not trigger a false rejection", () => {
    const { service, setCurrenciesForDrawer } = makeService([
      { currency_code: "LBP", balance: 2957925 },
    ]);

    const result = service.setCurrenciesForDrawer("Katsh", ["usd", "lbp"]);

    expect(result.success).toBe(true);
    expect(setCurrenciesForDrawer).toHaveBeenCalled();
  });

  it("protects a NEGATIVE balance too — a stranded deficit is just as wrong", () => {
    const { service, setCurrenciesForDrawer } = makeService([
      { currency_code: "USD", balance: -500 },
    ]);

    const result = service.setCurrenciesForDrawer("OMT_System", ["LBP"]);

    expect(result.success).toBe(false);
    expect(result.error).toContain("USD");
    expect(setCurrenciesForDrawer).not.toHaveBeenCalled();
  });

  it("names EVERY stranded currency, not just the first", () => {
    const { service } = makeService([
      { currency_code: "LBP", balance: 2957925 },
      { currency_code: "USD", balance: 40 },
    ]);

    const result = service.setCurrenciesForDrawer("Katsh", []);

    expect(result.success).toBe(false);
    expect(result.error).toContain("LBP");
    expect(result.error).toContain("USD");
  });
});
