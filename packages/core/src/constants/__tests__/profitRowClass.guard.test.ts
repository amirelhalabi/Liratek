/**
 * PA-4.23 (a) — owner decision 2026-09-24 (OWNER_NOTES_2026-09-21.md §6.9):
 * classify each `ProfitByModule.module` value into exactly one rendering
 * class for the By Module expandable detail row, per the owner's own
 * wording:
 *   - "rows where revenue − cost = profit holds by construction" → EQUATION
 *     (render the equation).
 *   - "pass-through/commission rows (FINANCIAL_SERVICE_* providers, loto,
 *     bills, any row whose revenue is transfer principal or ticket face
 *     value)" → COMMISSION (render "Commission: <amount>").
 *   - "profit-only rows (revenue 0 and cost 0 — kept change, discounts,
 *     supplier commission, top-up fees …)" → PROFIT_ONLY (render
 *     "Profit: <amount>" only).
 *
 * Rule 14 — ONE named map/function, not scattered ifs at each render site.
 * This guard is the single source of truth for that classification, so a
 * new module pushed by `ProfitService.getByModule` must be classified here
 * deliberately (defaults to EQUATION, the safe choice for a genuine
 * revenue/cost module — see `classifyProfitModuleRow`'s own doc comment).
 */

import {
  classifyProfitModuleRow,
  PROFIT_ROW_CLASS,
} from "../profitRowClass.js";

describe("classifyProfitModuleRow", () => {
  it.each([
    ["SALE", PROFIT_ROW_CLASS.EQUATION],
    ["RECHARGE_MTC", PROFIT_ROW_CLASS.EQUATION],
    ["RECHARGE_ALFA", PROFIT_ROW_CLASS.EQUATION],
    ["CUSTOM_SERVICE", PROFIT_ROW_CLASS.EQUATION],
    ["MAINTENANCE", PROFIT_ROW_CLASS.EQUATION],
    ["PM_FEE", PROFIT_ROW_CLASS.EQUATION],
  ])(
    "%s is EQUATION (a real revenue/cost module, proven by construction)",
    (module, expected) => {
      expect(classifyProfitModuleRow(module)).toBe(expected);
    },
  );

  it.each([
    ["FINANCIAL_SERVICE_OMT", PROFIT_ROW_CLASS.COMMISSION],
    ["FINANCIAL_SERVICE_WHISH", PROFIT_ROW_CLASS.COMMISSION],
    ["FINANCIAL_SERVICE_OMT_APP", PROFIT_ROW_CLASS.COMMISSION],
    ["FINANCIAL_SERVICE_WHISH_APP", PROFIT_ROW_CLASS.COMMISSION],
    ["FINANCIAL_SERVICE_BINANCE", PROFIT_ROW_CLASS.COMMISSION],
    ["LOTO", PROFIT_ROW_CLASS.COMMISSION],
  ])("%s is COMMISSION (pass-through principal)", (module, expected) => {
    expect(classifyProfitModuleRow(module)).toBe(expected);
  });

  // PFU-a-2: a FINANCIAL_SERVICE_* row whose provider suffix is NOT a real
  // commission provider (constants/commissionProviders.ts) stays EQUATION —
  // the bare `FINANCIAL_SERVICE_` prefix match used to mislabel these cost/
  // price mobile-service margins as "Commission". A tenant-configured bill
  // provider (never in COMMISSION_PROVIDERS either) falls into this same
  // safe-default arm.
  it.each([
    ["FINANCIAL_SERVICE_iPick", PROFIT_ROW_CLASS.EQUATION],
    ["FINANCIAL_SERVICE_Katsh", PROFIT_ROW_CLASS.EQUATION],
    ["FINANCIAL_SERVICE_BOB", PROFIT_ROW_CLASS.EQUATION],
    ["FINANCIAL_SERVICE_EDL_BILL", PROFIT_ROW_CLASS.EQUATION],
  ])(
    "%s is EQUATION (cost/price margin, not a commission provider)",
    (module, expected) => {
      expect(classifyProfitModuleRow(module)).toBe(expected);
    },
  );

  // PFU-a-4: EXCHANGE is a spread (cost = revenue - profit by construction),
  // not a commission — the owner never asked for it to read "Commission".
  it("EXCHANGE is EQUATION (a spread, not a commission)", () => {
    expect(classifyProfitModuleRow("EXCHANGE")).toBe(PROFIT_ROW_CLASS.EQUATION);
  });

  it.each([
    ["KEPT_CHANGE", PROFIT_ROW_CLASS.PROFIT_ONLY],
    ["COUNTERPARTY_DISCOUNT", PROFIT_ROW_CLASS.PROFIT_ONLY],
    ["SUPPLIER_COMMISSION", PROFIT_ROW_CLASS.PROFIT_ONLY],
    ["TOPUP_BUYBACK", PROFIT_ROW_CLASS.PROFIT_ONLY],
  ])(
    "%s is PROFIT_ONLY (revenue 0 and cost 0 by construction)",
    (module, expected) => {
      expect(classifyProfitModuleRow(module)).toBe(expected);
    },
  );

  it("defaults an unrecognized module to EQUATION (safe default — never silently hides a real revenue/cost pair as a bare Commission/Profit line)", () => {
    expect(classifyProfitModuleRow("SOME_FUTURE_MODULE")).toBe(
      PROFIT_ROW_CLASS.EQUATION,
    );
  });
});
