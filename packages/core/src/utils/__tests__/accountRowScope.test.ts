/**
 * LIRA-343 (research R4) — day rows vs account rows, by provenance, not sign.
 *
 * RULE 17 — written before `utils/accountRowScope.ts` existed; first run
 * failed with "Cannot find module '../accountRowScope'".
 */
import {
  isRemovableAccountCredit,
  rowScopeOf,
  type RowScopeInput,
} from "../accountRowScope";

const fs = (over: Partial<RowScopeInput> = {}): RowScopeInput => ({
  kind: "FINANCIAL_SERVICE",
  source_ref_table: null,
  entry_type: null,
  ...over,
});
const ledger = (over: Partial<RowScopeInput> = {}): RowScopeInput => ({
  kind: "LEDGER",
  source_ref_table: null,
  entry_type: "TOP_UP",
  ...over,
});

describe("rowScopeOf", () => {
  it("FINANCIAL_SERVICE rows (incl. a RECEIVE, negative owed) are DAY rows", () => {
    expect(rowScopeOf(fs())).toBe("DAY");
    expect(rowScopeOf(fs({ settlement_created: false }))).toBe("DAY");
  });

  it("an OMT App cash-out (PAYMENT, source_ref 'recharges') is a DAY row", () => {
    expect(
      rowScopeOf(
        ledger({ entry_type: "PAYMENT", source_ref_table: "recharges" }),
      ),
    ).toBe("DAY");
  });

  it("settlement-created rows are ACCOUNT rows, whatever their sign or type", () => {
    // overpay PAYMENT (negative), overpay SUPPLIER_PAYS_US (positive),
    // amount-first commission credit SUPPLIER_PAYS_US (link mode)
    for (const entry_type of ["PAYMENT", "SUPPLIER_PAYS_US"]) {
      expect(rowScopeOf(ledger({ entry_type, settlement_created: true }))).toBe(
        "ACCOUNT",
      );
    }
  });

  it("settlement_created wins even if a source link were present", () => {
    expect(
      rowScopeOf(
        ledger({
          entry_type: "SUPPLIER_PAYS_US",
          source_ref_table: "supplier_ledger",
          settlement_created: true,
        }),
      ),
    ).toBe("ACCOUNT");
  });

  it("a manual Pay / Receive (no source link) is an ACCOUNT row", () => {
    expect(rowScopeOf(ledger({ entry_type: "PAYMENT" }))).toBe("ACCOUNT");
    expect(rowScopeOf(ledger({ entry_type: "SUPPLIER_PAYS_US" }))).toBe(
      "ACCOUNT",
    );
  });

  it("TOP_UP charges (iPick / OMT App) are DAY rows", () => {
    expect(rowScopeOf(ledger({ entry_type: "TOP_UP" }))).toBe("DAY");
    expect(
      rowScopeOf(
        ledger({ entry_type: "TOP_UP", source_ref_table: "recharges" }),
      ),
    ).toBe("DAY");
  });

  it("other ledger types with no source link stay DAY rows", () => {
    for (const entry_type of [
      "SALE_COST",
      "RECORDED_DEBT",
      "STOCK_INTAKE",
      "ADJUSTMENT",
      null,
    ]) {
      expect(rowScopeOf(ledger({ entry_type }))).toBe("DAY");
    }
  });

  // LIRA-345 (blocker b) — a supplier DISCOUNT always rides on a manual
  // Pay (D8 removed the standalone write-off; a settlement's waive is
  // self-stamped and never listed). It is account-level like its Pay: linked
  // to the Pay's ledger row (source_ref 'supplier_ledger') or, written
  // before that link existed, with no source at all.
  it("a supplier DISCOUNT is an ACCOUNT row, linked to its Pay or not (LIRA-345)", () => {
    expect(
      rowScopeOf(
        ledger({ entry_type: "DISCOUNT", source_ref_table: "supplier_ledger" }),
      ),
    ).toBe("ACCOUNT");
    expect(rowScopeOf(ledger({ entry_type: "DISCOUNT" }))).toBe("ACCOUNT");
  });

  it("a FINANCIAL_SERVICE row is DAY even when flagged settlement-created", () => {
    expect(rowScopeOf(fs({ settlement_created: true }))).toBe("DAY");
  });
});

describe("LIRA-344 — isRemovableAccountCredit", () => {
  const row = (
    over: Partial<Parameters<typeof isRemovableAccountCredit>[0]>,
  ) => ({
    kind: "LEDGER",
    row_scope: "ACCOUNT" as const,
    remaining_usd: -40,
    remaining_lbp: 0,
    ...over,
  });
  it.each([
    ["an account credit in USD", row({}), true],
    [
      "an account credit in LBP",
      row({ remaining_usd: 0, remaining_lbp: -450000 }),
      true,
    ],
    ["a day row", row({ row_scope: "DAY" }), false],
    ["a transfer row", row({ kind: "FINANCIAL_SERVICE" }), false],
    ["an account debt", row({ remaining_usd: 20 }), false],
    ["a mixed row (owed in LBP)", row({ remaining_lbp: 1000 }), false],
    ["nothing left (under a cent)", row({ remaining_usd: -0.004 }), false],
  ])("%s → %s", (_label, r, expected) => {
    expect(isRemovableAccountCredit(r)).toBe(expected);
  });
});
