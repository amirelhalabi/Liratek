/**
 * LIRA-339 — both voucher transaction types have a label, an in/out arrow,
 * an Arabic-translatable title and a non-reversible reason that points the
 * operator at the Vouchers page.
 */
import { NON_REVERSIBLE_REASONS } from "../nonReversibleReasons";
import { TRANSACTION_PRESENTATION } from "../transactionPresentation";
import { translateTitle } from "../typeTitleText";
import en from "@liratek/ui/i18n/locales/en/audit.json";
import ar from "@liratek/ui/i18n/locales/ar/audit.json";

const TYPES = ["VOUCHER_SALE", "VOUCHER_CANCEL"] as const;

describe("voucher transaction presentation", () => {
  it.each(TYPES)("%s has a label and an in/out direction", (type) => {
    const p = TRANSACTION_PRESENTATION[type];
    expect(p.label).toBeTruthy();
    expect(["in", "out"]).toContain(p.direction);
  });

  // LIRA-388 — a voucher SALE is now refunded from its row (the Vouchers
  // page's own "Cancel voucher" runs behind it), so only the CANCEL keeps a
  // "can't refund here" reason; the sale has none (guard, rule 24).
  it("VOUCHER_CANCEL has a reason that mentions the Vouchers page", () => {
    expect(NON_REVERSIBLE_REASONS.VOUCHER_CANCEL).toMatch(/Vouchers page/);
    const enR = en.nonReversible as Record<string, string>;
    const arR = ar.nonReversible as Record<string, string>;
    expect(enR.VOUCHER_CANCEL).toBe(NON_REVERSIBLE_REASONS.VOUCHER_CANCEL);
    expect(arR.VOUCHER_CANCEL).toBeTruthy();
  });

  it("VOUCHER_SALE has no reason: it is refunded from its row (LIRA-388)", () => {
    expect(NON_REVERSIBLE_REASONS.VOUCHER_SALE).toBeUndefined();
  });

  it("titles and filter labels translate to Arabic", () => {
    const exact = ar.titles.exact as Record<string, string>;
    for (const en of [
      "Voucher sold",
      "Voucher Sold",
      "Voucher cancelled",
      "Voucher Cancelled",
    ]) {
      const t = ((k: string) => exact[k.split(".").pop() ?? ""] ?? k) as never;
      const out = translateTitle(en, t, "ar");
      expect(out).not.toBe(en);
    }
    expect((ar.filterGroups as Record<string, string>).Vouchers).toBeTruthy();
  });
});
