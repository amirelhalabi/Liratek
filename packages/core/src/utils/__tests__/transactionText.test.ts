/**
 * LIRA-301 — the shared transaction wording (web, desktop and phone).
 * The rules were moved verbatim from the web's transactionDisplay.ts, whose
 * own suites still pass through the re-export; this pins the cases the phone
 * relies on and the fallbacks. Characterization of moved code, not a
 * failing-first guard.
 */
import { PROVIDER_LABELS, transactionSummary, transactionTitle, TRANSACTION_TYPE_LABELS } from "../transactionText";

const meta = (m: unknown) => JSON.stringify(m);
const row = (type: string, metadata: unknown = null, extra: Partial<Parameters<typeof transactionSummary>[0]> = {}) => ({
  type,
  metadata_json: metadata === null ? null : meta(metadata),
  summary: null,
  amount_usd: 0,
  amount_lbp: 0,
  ...extra,
});

describe("transactionTitle", () => {
  it.each([
    [{ provider: "WHISH_APP", service_type: "SEND" }, "Whish App Send"],
    [{ provider: "OMT_APP", service_type: "SEND" }, "OMT App Send"],
    [{ provider: "OMT_APP", service_type: "RECEIVE" }, "OMT App Recv"],
    [{ provider: "WHISH_APP", item_key: "x" }, "Whish App Bills"],
    [{ provider: "Katsh", service_type: "BILL" }, "Katsh Bill"],
    [{ provider: "iPick", service_type: "SEND" }, "iPick"],
    [{ provider: "OMT", service_type: "SEND" }, "OMT System"],
  ])("FINANCIAL_SERVICE %j → %s", (m, title) => {
    expect(transactionTitle(row("FINANCIAL_SERVICE", m))).toBe(title);
  });

  it("recharge and top-up titles use the provider and subtype labels", () => {
    expect(transactionTitle(row("RECHARGE", { provider: "MTC", type: "DAYS" }))).toBe("MTC Days");
    expect(transactionTitle(row("RECHARGE_TOPUP", { provider: "WHISH_SYSTEM" }))).toBe("Whish Cash Drawer Top-up");
  });

  it("fixed per-type labels, then the humanised type", () => {
    expect(transactionTitle(row("LOTO"))).toBe("Loto");
    expect(transactionTitle(row("DEBT_REPAYMENT"))).toBe("DEBT REPAYMENT");
    expect(transactionTitle(row("SOMETHING_NEW"))).toBe("SOMETHING NEW");
  });

  it("unparsable or JSON-null metadata gives the per-type label, not a provider guess", () => {
    expect(transactionTitle({ type: "FINANCIAL_SERVICE", metadata_json: "{bad" })).toBe("FINANCIAL SERVICE");
    expect(transactionTitle({ type: "FINANCIAL_SERVICE", metadata_json: "null" })).toBe("FINANCIAL SERVICE");
    expect(transactionTitle({ type: "FINANCIAL_SERVICE", metadata_json: null })).toBe("Financial Service");
  });

  it("every provider the phone sells has a name", () => {
    for (const p of ["WHISH_APP", "OMT_APP", "Katsh", "iPick"]) expect(PROVIDER_LABELS[p]).toBeTruthy();
    expect(Object.keys(TRANSACTION_TYPE_LABELS)).toContain("FINANCIAL_SERVICE");
  });
});

describe("transactionSummary", () => {
  it("returns the stored summary for ordinary rows", () => {
    expect(transactionSummary(row("FINANCIAL_SERVICE", { provider: "WHISH_APP" }, { summary: "WHISH_APP SEND: $50" }))).toBe(
      "WHISH_APP SEND: $50",
    );
  });

  it("rewords a supplier TOP_UP ledger row by its sign, keeping a VOID prefix", () => {
    const m = { entry_type: "TOP_UP", counterparty: { name: "OMT" } };
    expect(transactionSummary(row("SUPPLIER_PAYMENT", m, { summary: "Supplier TOP_UP: $-100", amount_usd: -100 }))).toBe(
      "Owed to OMT reduced by $100.00",
    );
    expect(transactionSummary(row("SUPPLIER_PAYMENT", m, { summary: "VOID: Supplier TOP_UP", amount_usd: 105 }))).toBe(
      "VOID: Owed to OMT increased by $105.00",
    );
  });
});
