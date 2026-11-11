/**
 * cashFlow — 3 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 3).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import {
  getCashFlowDirection,
  getRowCashFlowDirection,
  type TransactionPaymentLeg,
  isCashTransaction,
} from "../cashFlow";

function resetBetweenFiles() {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("cashFlow.customServicePayout", () => {
  beforeAll(resetBetweenFiles);

  /**
   * NOT RUN — proven at the end-of-batch gate.
   *
   * OWNER_NOTES_REMAINING_BUILD.md #16 — a Via-Partner custom service can now
   * be a payout (the Syria "Pay out" flow, migration v185). The IN/OUT badge
   * must say OUT for it, and keep saying IN for every other custom service
   * (the type used to be a fixed "in" — CUSTOM_SERVICE is now "dynamic" in
   * transactionPresentation.ts).
   */

  const meta = (direction?: string) =>
    direction === undefined ? "{}" : JSON.stringify({ direction });

  describe("getCashFlowDirection — CUSTOM_SERVICE direction branch", () => {
    it("is 'out' for a payout (metadata.direction === 'OUT')", () => {
      expect(getCashFlowDirection("CUSTOM_SERVICE", meta("OUT"))).toBe("out");
    });

    it("is 'in' for the ordinary flow (metadata.direction === 'IN')", () => {
      expect(getCashFlowDirection("CUSTOM_SERVICE", meta("IN"))).toBe("in");
    });

    it("falls back to 'in' when metadata has no direction key (every pre-v185 row)", () => {
      expect(getCashFlowDirection("CUSTOM_SERVICE", meta())).toBe("in");
    });

    it("falls back to 'in' when metadata is missing or malformed", () => {
      expect(getCashFlowDirection("CUSTOM_SERVICE", null)).toBe("in");
      expect(getCashFlowDirection("CUSTOM_SERVICE", undefined)).toBe("in");
      expect(getCashFlowDirection("CUSTOM_SERVICE", "not-json{")).toBe("in");
    });

    it("ignores an unrecognised direction value and falls back to 'in'", () => {
      expect(getCashFlowDirection("CUSTOM_SERVICE", meta("SIDEWAYS"))).toBe(
        "in",
      );
    });
  });
});

describe("cashFlow.reversalDirection", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Production test 2026-10-07 — the ↓/↑ arrow on void rows did not match the
   * sign of the amount. A void copies the original's `type` and
   * `metadata_json` (TransactionRepository._voidTransactionInternal), so the
   * per-type lookup answered the ORIGINAL's direction: a voided sale showed a
   * green "cash in" arrow next to money that went back out. A REFUND row had no
   * arrow at all.
   *
   * Contract pinned here (`getRowCashFlowDirection`):
   *   - a void row (reverses_id set, not a REFUND) shows the original's
   *     direction reversed — "both" and "no badge" stay as they are;
   *   - the original's direction is rebuilt from the original's inputs
   *     (signed amounts negated back, legs flipped back) BEFORE reversing, so
   *     sign-driven types (historical partner rows) are not flipped twice;
   *   - a REFUND row's arrow follows its own legs.
   */

  function leg(direction: "in" | "out", amount: number): TransactionPaymentLeg {
    return {
      direction,
      amount,
      signed_amount: direction === "out" ? -amount : amount,
      currency_code: "USD",
      method: "CASH",
    };
  }

  describe("getRowCashFlowDirection — voids and refunds", () => {
    it("a sale is IN; its void is OUT", () => {
      expect(
        getRowCashFlowDirection({
          type: "SALE",
          metadata_json: null,
          amount_usd: 4.25,
          amount_lbp: 0,
          reverses_id: null,
          payments: [leg("in", 5), leg("out", 0.5)],
        }),
      ).toBe("in");
      expect(
        getRowCashFlowDirection({
          type: "SALE",
          metadata_json: null,
          amount_usd: -4.25,
          amount_lbp: 0,
          reverses_id: 99,
          payments: [leg("out", 5), leg("in", 0.5)],
        }),
      ).toBe("out");
    });

    it("void of an expense (OUT) is IN", () => {
      expect(
        getRowCashFlowDirection({
          type: "EXPENSE",
          metadata_json: null,
          amount_usd: -20,
          amount_lbp: 0,
          reverses_id: 5,
          payments: [leg("in", 20)],
        }),
      ).toBe("in");
    });

    it("void of a partner settlement whose flow is in the copied metadata is reversed", () => {
      expect(
        getRowCashFlowDirection({
          type: "PARTNER_SETTLEMENT",
          metadata_json: JSON.stringify({ counterparty: { flow: "IN" } }),
          amount_usd: -50,
          amount_lbp: 0,
          reverses_id: 8,
          payments: [],
        }),
      ).toBe("out");
    });

    it("void of a HISTORICAL partner settlement (direction from the sign) is not flipped twice", () => {
      // Original: +50 (cash in). The void stores −50. Reading the void's own
      // sign already says "out"; flipping that again would wrongly say "in".
      expect(
        getRowCashFlowDirection({
          type: "PARTNER_SETTLEMENT",
          metadata_json: null,
          amount_usd: -50,
          amount_lbp: 0,
          reverses_id: 8,
          payments: [],
        }),
      ).toBe("out");
    });

    it("void of a fee-on-top RECEIVE (both ways) stays 'both'", () => {
      expect(
        getRowCashFlowDirection({
          type: "FINANCIAL_SERVICE",
          metadata_json: JSON.stringify({ service_type: "RECEIVE" }),
          amount_usd: -100,
          amount_lbp: 0,
          reverses_id: 12,
          payments: [leg("in", 100), leg("out", 3)],
        }),
      ).toBe("both");
    });

    it("void of a type with no badge keeps no badge", () => {
      expect(
        getRowCashFlowDirection({
          type: "SUPPLIER_ADJUSTMENT",
          metadata_json: null,
          amount_usd: -10,
          amount_lbp: 0,
          reverses_id: 3,
          payments: [],
        }),
      ).toBeNull();
    });

    it("a REFUND that handed money back is OUT", () => {
      expect(
        getRowCashFlowDirection({
          type: "REFUND",
          metadata_json: null,
          amount_usd: -4.25,
          amount_lbp: 0,
          reverses_id: 99,
          payments: [leg("out", 4)],
        }),
      ).toBe("out");
    });

    it("a REFUND of a payout (money came back in) is IN; with no cash legs, no badge", () => {
      expect(
        getRowCashFlowDirection({
          type: "REFUND",
          metadata_json: null,
          amount_usd: -100,
          amount_lbp: 0,
          reverses_id: 40,
          payments: [leg("in", 100)],
        }),
      ).toBe("in");
      expect(
        getRowCashFlowDirection({
          type: "REFUND",
          metadata_json: null,
          amount_usd: -4.25,
          amount_lbp: 0,
          reverses_id: 99,
          payments: [],
        }),
      ).toBeNull();
    });
  });
});

describe("cashFlow", () => {
  beforeAll(resetBetweenFiles);

  /**
   * C2 — OMT/WHISH in/out semantics (LEFT_TO_DO).
   *
   * The transactions-table badge direction for FINANCIAL_SERVICE must follow the
   * service direction: SEND/BILL take customer cash (in), RECEIVE pays the
   * customer out of the drawers (out). The pre-C2 code returned "in" for EVERY
   * FINANCIAL_SERVICE row — the RECEIVE cases below fail against it.
   */

  const meta = (service_type: string) => JSON.stringify({ service_type });

  describe("getCashFlowDirection — FINANCIAL_SERVICE service_type branch", () => {
    it("SEND is cash in (customer pays us)", () => {
      expect(getCashFlowDirection("FINANCIAL_SERVICE", meta("SEND"))).toBe(
        "in",
      );
    });

    it("RECEIVE is cash out (shop pays the customer)", () => {
      expect(getCashFlowDirection("FINANCIAL_SERVICE", meta("RECEIVE"))).toBe(
        "out",
      );
    });

    it("BILL is cash in (customer pays for the bill)", () => {
      expect(getCashFlowDirection("FINANCIAL_SERVICE", meta("BILL"))).toBe(
        "in",
      );
    });

    it("falls back to 'in' when metadata is missing or malformed", () => {
      expect(getCashFlowDirection("FINANCIAL_SERVICE", null)).toBe("in");
      expect(getCashFlowDirection("FINANCIAL_SERVICE", undefined)).toBe("in");
      expect(getCashFlowDirection("FINANCIAL_SERVICE", "not-json{")).toBe("in");
      expect(getCashFlowDirection("FINANCIAL_SERVICE", "{}")).toBe("in");
    });
  });

  /**
   * BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md owner decision #10: a fee-on-top
   * RECEIVE books an extra customer-paid-IN leg (the fee) alongside the shop's
   * payout-OUT leg — the plain "out" badge hides that cash also came IN. The
   * `legs` param is the row's structured payment legs (TransactionsViewer
   * already loads `row.payments` for the payment-legs subtext); this reads it
   * rather than metadata fee fields because metadata doesn't record whether
   * the fee was actually collected via a leg (vs netted into the payout, or
   * deferred inside a session) — only the legs prove real cash moved.
   *
   * Proven failing-first (rule 17): pre-fix, `getCashFlowDirection` had no 4th
   * param at all — a fee-on-top RECEIVE with both an IN and an OUT leg still
   * returned "out", indistinguishable from a plain RECEIVE with no fee.
   */
  describe("getCashFlowDirection — FINANCIAL_SERVICE RECEIVE fee-on-top (owner decision #10)", () => {
    const receiveMeta = meta("RECEIVE");

    it("returns 'both' when a customer-paid IN leg (the fee) exists alongside the payout OUT leg", () => {
      expect(
        getCashFlowDirection("FINANCIAL_SERVICE", receiveMeta, undefined, [
          { direction: "in" }, // fee leg (customer-paid)
          { direction: "out" }, // payout leg (shop pays customer)
        ]),
      ).toBe("both");
    });

    it("stays 'out' when there is no IN leg (no fee collected, or fee included/netted)", () => {
      expect(
        getCashFlowDirection("FINANCIAL_SERVICE", receiveMeta, undefined, [
          { direction: "out" },
        ]),
      ).toBe("out");
    });

    it("stays 'out' when legs are entirely absent (backward-compatible — every existing call site)", () => {
      expect(getCashFlowDirection("FINANCIAL_SERVICE", receiveMeta)).toBe(
        "out",
      );
      expect(
        getCashFlowDirection("FINANCIAL_SERVICE", receiveMeta, undefined, []),
      ).toBe("out");
    });

    it("stays 'out' when only an IN leg exists with no OUT leg (e.g. CUSTOMER_ACCOUNT payout — no drawer leg)", () => {
      expect(
        getCashFlowDirection("FINANCIAL_SERVICE", receiveMeta, undefined, [
          { direction: "in" },
        ]),
      ).toBe("out");
    });

    it("never affects SEND/BILL — legs param is read only inside the RECEIVE branch", () => {
      expect(
        getCashFlowDirection("FINANCIAL_SERVICE", meta("SEND"), undefined, [
          { direction: "in" },
          { direction: "out" },
        ]),
      ).toBe("in");
    });
  });

  describe("getCashFlowDirection — unchanged types (guard against regressions)", () => {
    it.each([
      ["SALE", "in"],
      ["RECHARGE", "in"],
      ["DEBT_REPAYMENT", "in"],
      ["EXPENSE", "out"],
      ["LOTO_SETTLEMENT", "out"],
      ["EXCHANGE", "both"],
      // Same-shop transfer — renamed SYSTEM_FLOAT_TOPUP -> DRAWER_TRANSFER
      // (Primary Cash Drawer plan §8.6): General <-> PCD, now bidirectional
      // (either drawer can be the funding side). Still has no single
      // customer-facing direction, same "both" treatment as EXCHANGE.
      ["DRAWER_TRANSFER", "both"],
      // B7: loto rows were unmapped → blank badge on every ticket sale / payout
      ["LOTO", "in"],
      ["LOTO_CASH_PRIZE", "out"],
      // Cash Out — owner's draw pulls physical cash OUT of the General drawer.
      ["DRAWER_CASHOUT", "out"],
    ] as const)("%s → %s", (type, expected) => {
      expect(getCashFlowDirection(type)).toBe(expected);
    });

    it("RECHARGE_TOPUP: 'out' with no metadata (legacy/malformed default), 'in' when partner funded", () => {
      expect(getCashFlowDirection("RECHARGE_TOPUP")).toBe("out");
      expect(
        getCashFlowDirection(
          "RECHARGE_TOPUP",
          JSON.stringify({ partnerId: 3 }),
        ),
      ).toBe("in");
    });

    it("unknown types render no badge", () => {
      expect(getCashFlowDirection("CLIENT_CREATED")).toBeNull();
    });

    // CQ-10: COUNTERPARTY_DISCOUNT rows always carry amounts of 0 (the value
    // lives in signed profit_usd/lbp) — no cash physically moved, so the
    // viewer must fall through to the default "no badge" case, same as any
    // other unmapped type, rather than crashing or guessing a direction.
    it("COUNTERPARTY_DISCOUNT renders no badge (no cash moves — value is in profit, not amount)", () => {
      expect(getCashFlowDirection("COUNTERPARTY_DISCOUNT")).toBeNull();
      expect(
        getCashFlowDirection("COUNTERPARTY_DISCOUNT", JSON.stringify({})),
      ).toBeNull();
    });

    // LIRA-066: the paper (no-cash) Partners-page "Record Tx" entry. Unlike
    // PARTNER_SETTLEMENT/PARTNER_PAYMENT it never moves a drawer, so — same
    // rationale as COUNTERPARTY_DISCOUNT above — it must render no badge
    // regardless of its metadata.counterparty.flow or signed amount.
    it("PARTNER_ADJUSTMENT renders no badge (no cash moves — paper entry)", () => {
      expect(getCashFlowDirection("PARTNER_ADJUSTMENT")).toBeNull();
      expect(
        getCashFlowDirection(
          "PARTNER_ADJUSTMENT",
          JSON.stringify({ counterparty: { flow: "IN" } }),
          { usd: 250, lbp: 0 },
        ),
      ).toBeNull();
    });
  });

  /**
   * Top-Up Cash-Flow Direction Audit (TOPUP_CASHFLOW_DIRECTION_AUDIT.md) —
   * owner-approved rule: "in" when no cash-equivalent drawer is actually
   * debited (funded by new supplier/partner debt); "both" when a
   * cash-equivalent drawer is debited INTO another cash-equivalent drawer;
   * "out" when the debited cash buys provider STOCK (MTC/Alfa/Katsh/iPick) or
   * leaves the business.
   *
   * Proven failing-first (rule 17) against the pre-fix code (the single
   * `if (m.partnerId != null || m.cashPaid != null) return "in"; return "out";`
   * body this describe block replaced):
   *   - topUpFromSupplier (`{sourceDrawer:"SUPPLIER",destDrawer:"Katsh"}`):
   *     neither key existed → fell through to "out". FAILED against "in".
   *   - topUpFromClient with `cashPaid > 0` (`{cashPaid:50,...}`): `cashPaid
   *     != null` → "in". FAILED against "both".
   *   - topUpApp into OMT_App (`{sourceDrawer:"General",destDrawer:"OMT_App"}`):
   *     neither `partnerId` nor `cashPaid` present → "out". FAILED against
   *     "both".
   *   - topUpApp into Katsh (`{sourceDrawer:"General",destDrawer:"Katsh"}`):
   *     same shape → "out", which happens to be the CORRECT answer for a
   *     stock destination — included here as the discriminating case that
   *     proves the fix reads `destDrawer`, not just "sourceDrawer present".
   */
  describe("getCashFlowDirection — RECHARGE_TOPUP (Top-Up Cash-Flow Direction Audit)", () => {
    it("topUpFromSupplier (owner's reported Katsh bug): sourceDrawer SUPPLIER, no drawer debited → in", () => {
      expect(
        getCashFlowDirection(
          "RECHARGE_TOPUP",
          JSON.stringify({
            provider: "Katsh",
            amount: 1000000,
            currency: "LBP",
            sourceDrawer: "SUPPLIER",
            destDrawer: "Katsh",
          }),
        ),
      ).toBe("in");
    });

    it("topUpFromSupplier via iPick: same SUPPLIER shape → in", () => {
      expect(
        getCashFlowDirection(
          "RECHARGE_TOPUP",
          JSON.stringify({
            provider: "iPick",
            amount: 100,
            currency: "USD",
            sourceDrawer: "SUPPLIER",
            destDrawer: "iPick",
          }),
        ),
      ).toBe("in");
    });

    it("topUpFromClient: cashPaid > 0 really debits General into Whish_App → both", () => {
      expect(
        getCashFlowDirection(
          "RECHARGE_TOPUP",
          JSON.stringify({
            provider: "WHISH_APP",
            amount: 100,
            cashPaid: 90,
            currency: "USD",
            sourceDrawer: "General",
            destDrawer: "Whish_App",
          }),
        ),
      ).toBe("both");
    });

    it("topUpFromClient: cashPaid === 0 debits nothing → in", () => {
      expect(
        getCashFlowDirection(
          "RECHARGE_TOPUP",
          JSON.stringify({
            provider: "WHISH_APP",
            amount: 100,
            cashPaid: 0,
            currency: "USD",
            sourceDrawer: "General",
            destDrawer: "Whish_App",
          }),
        ),
      ).toBe("in");
    });

    it("topUpApp into OMT_App (only reachable destination from the current UI): both", () => {
      expect(
        getCashFlowDirection(
          "RECHARGE_TOPUP",
          JSON.stringify({
            provider: "OMT_APP",
            amount: 100,
            currency: "USD",
            sourceDrawer: "General",
            destDrawer: "OMT_App",
          }),
        ),
      ).toBe("both");
    });

    it("topUpApp into Whish_App: both (cash-equivalent destination)", () => {
      expect(
        getCashFlowDirection(
          "RECHARGE_TOPUP",
          JSON.stringify({
            provider: "WHISH_APP",
            amount: 100,
            currency: "USD",
            sourceDrawer: "General",
            destDrawer: "Whish_App",
          }),
        ),
      ).toBe("both");
    });

    it("topUpApp into a provider STOCK drawer (Katsh/iPick/MTC/Alfa): stays out", () => {
      expect(
        getCashFlowDirection(
          "RECHARGE_TOPUP",
          JSON.stringify({
            provider: "Katsh",
            amount: 100,
            currency: "USD",
            sourceDrawer: "General",
            destDrawer: "Katsh",
          }),
        ),
      ).toBe("out");
    });

    it("topUpFromPartner: unchanged — partnerId still wins → in", () => {
      expect(
        getCashFlowDirection(
          "RECHARGE_TOPUP",
          JSON.stringify({
            provider: "WHISH_APP",
            partnerId: 7,
            amount: 100,
            currency: "USD",
            destDrawer: "Whish_App",
          }),
        ),
      ).toBe("in");
    });
  });

  /**
   * DRAWER_TOPUP (Top-Up Cash-Flow Direction Audit finding #4): the type was
   * entirely absent from the switch, so BOTH its sub-shapes rendered no badge
   * at all. Proven failing-first (rule 17): pre-fix, `getCashFlowDirection`
   * had no `"DRAWER_TOPUP"` case, so it fell through to `default: return null`
   * for every call below — both assertions FAILED (got `null`, wanted
   * `"in"`/`"both"`).
   */
  describe("getCashFlowDirection — DRAWER_TOPUP (Top-Up Cash-Flow Direction Audit)", () => {
    it('"External (Cash In)": no source_drawer key, genuinely new money → in', () => {
      expect(
        getCashFlowDirection(
          "DRAWER_TOPUP",
          JSON.stringify({
            drawer: "General",
            notes: null,
            extra_currencies: null,
          }),
        ),
      ).toBe("in");
    });

    it('"From Drawer": source_drawer debited into General (both cash-equivalent) → both', () => {
      expect(
        getCashFlowDirection(
          "DRAWER_TOPUP",
          JSON.stringify({
            drawer: "General",
            source_drawer: "OMT_System",
            notes: null,
          }),
        ),
      ).toBe("both");
    });

    it("no metadata / malformed metadata defaults to 'in' (external-cash-in shape)", () => {
      expect(getCashFlowDirection("DRAWER_TOPUP")).toBe("in");
      expect(getCashFlowDirection("DRAWER_TOPUP", null)).toBe("in");
      expect(getCashFlowDirection("DRAWER_TOPUP", "not-json{")).toBe("in");
    });
  });

  /**
   * SUPPLIER_PAYMENT direction (owner-reported 2026-07-28): a manual Suppliers-page
   * PAY rendered the green ↓ "cash in" badge while its own payment-legs subtext read
   * "out: $2,000" — the type was in the hardcoded "in" list, so half its rows were
   * always wrong. Direction comes from the CQ-8 counterparty contract
   * (SupplierRepository.recordSupplierCashflow stamps flow OUT for PAY / IN for
   * RECEIVE) with `metadata.direction` as the secondary read. The PAY/OUT cases
   * below fail against the pre-fix code (rule 17).
   */
  describe("getCashFlowDirection — SUPPLIER_PAYMENT (both directions)", () => {
    it("PAY is cash out (shop pays the supplier out of the drawer)", () => {
      expect(
        getCashFlowDirection(
          "SUPPLIER_PAYMENT",
          JSON.stringify({
            supplier_id: 1,
            direction: "PAY",
            counterparty: { flow: "OUT", method: "CASH" },
          }),
          { usd: 2000, lbp: 0 },
        ),
      ).toBe("out");
    });

    it("RECEIVE is cash in (supplier pays the shop back)", () => {
      expect(
        getCashFlowDirection(
          "SUPPLIER_PAYMENT",
          JSON.stringify({
            supplier_id: 1,
            direction: "RECEIVE",
            counterparty: { flow: "IN", method: "CASH" },
          }),
          { usd: 2000, lbp: 0 },
        ),
      ).toBe("in");
    });

    it("resolves from metadata.direction alone when no counterparty block exists", () => {
      expect(
        getCashFlowDirection(
          "SUPPLIER_PAYMENT",
          JSON.stringify({ supplier_id: 1, direction: "PAY" }),
        ),
      ).toBe("out");
      expect(
        getCashFlowDirection(
          "SUPPLIER_PAYMENT",
          JSON.stringify({ supplier_id: 1, direction: "RECEIVE" }),
        ),
      ).toBe("in");
    });

    it("counterparty.flow wins over metadata.direction", () => {
      expect(
        getCashFlowDirection(
          "SUPPLIER_PAYMENT",
          JSON.stringify({
            direction: "RECEIVE",
            counterparty: { flow: "OUT" },
          }),
        ),
      ).toBe("out");
    });

    // The addLedgerEntry no-drawer branch stamps flow from the ledger sign
    // (PAYMENT → OUT, SUPPLIER_PAYS_US → IN, other accruals by sign) — auto rows
    // are filter-hidden by default but must still badge consistently when shown.
    it("auto ledger rows follow their stamped flow", () => {
      expect(
        getCashFlowDirection(
          "SUPPLIER_PAYMENT",
          JSON.stringify({
            is_auto: true,
            entry_type: "PAYMENT",
            counterparty: { flow: "OUT", method: "LEDGER" },
          }),
        ),
      ).toBe("out");
      expect(
        getCashFlowDirection(
          "SUPPLIER_PAYMENT",
          JSON.stringify({
            is_auto: true,
            entry_type: "TOP_UP",
            counterparty: { flow: "IN", method: "LEDGER" },
          }),
        ),
      ).toBe("in");
    });

    it("historical rows with neither marker keep the legacy 'in' default", () => {
      expect(getCashFlowDirection("SUPPLIER_PAYMENT")).toBe("in");
      expect(getCashFlowDirection("SUPPLIER_PAYMENT", null)).toBe("in");
      expect(getCashFlowDirection("SUPPLIER_PAYMENT", "not-json{")).toBe("in");
      expect(
        getCashFlowDirection(
          "SUPPLIER_PAYMENT",
          JSON.stringify({ supplier_id: 1 }),
        ),
      ).toBe("in");
    });
  });

  /**
   * SUPPLIER_SETTLEMENT direction (BILL_COMMISSION_SETTLEMENT_PLAN.md, LIRA-137):
   * a bills-only commission-at-settlement batch (Katsh) moves NO cash out of a
   * drawer — the entered commission arrives IN via a provider-drawer top-up.
   * A fixed "out" mapping painted a red ↑ on a row that only ever moves cash
   * IN. Direction now reads `metadata.counterparty.flow`, same CQ-8 contract
   * pattern as SUPPLIER_PAYMENT above; every historical/legacy row (real
   * OUT payment to a supplier, or no metadata at all) keeps the "out" default.
   * The "in" case fails against the pre-fix (hardcoded "out") code (rule 17).
   */
  describe("getCashFlowDirection — SUPPLIER_SETTLEMENT (bills commission IN, else OUT)", () => {
    it("a bills-only commission batch is cash IN (provider-drawer top-up, no cash paid out)", () => {
      expect(
        getCashFlowDirection(
          "SUPPLIER_SETTLEMENT",
          JSON.stringify({
            supplier_id: 1,
            commission_model: 1,
            counterparty: { flow: "IN", method: "Katsh" },
          }),
        ),
      ).toBe("in");
    });

    it("a real net-payment settlement (legacy/OMT) stays cash OUT", () => {
      expect(
        getCashFlowDirection(
          "SUPPLIER_SETTLEMENT",
          JSON.stringify({
            supplier_id: 1,
            commission_model: 0,
            counterparty: { flow: "OUT", method: "CASH" },
          }),
        ),
      ).toBe("out");
    });

    it("historical rows with no counterparty metadata default to 'out' (unchanged)", () => {
      expect(getCashFlowDirection("SUPPLIER_SETTLEMENT")).toBe("out");
      expect(getCashFlowDirection("SUPPLIER_SETTLEMENT", null)).toBe("out");
      expect(getCashFlowDirection("SUPPLIER_SETTLEMENT", "not-json{")).toBe(
        "out",
      );
      expect(
        getCashFlowDirection(
          "SUPPLIER_SETTLEMENT",
          JSON.stringify({ supplier_id: 1 }),
        ),
      ).toBe("out");
    });
  });

  describe("getCashFlowDirection — PARTNER_SETTLEMENT / PARTNER_PAYMENT (CQ-8)", () => {
    const flowMeta = (flow: "IN" | "OUT") =>
      JSON.stringify({ counterparty: { flow } });

    it.each(["PARTNER_SETTLEMENT", "PARTNER_PAYMENT"] as const)(
      "%s: metadata.counterparty.flow IN → in",
      (type) => {
        expect(getCashFlowDirection(type, flowMeta("IN"))).toBe("in");
      },
    );

    it.each(["PARTNER_SETTLEMENT", "PARTNER_PAYMENT"] as const)(
      "%s: metadata.counterparty.flow OUT → out",
      (type) => {
        expect(getCashFlowDirection(type, flowMeta("OUT"))).toBe("out");
      },
    );

    it.each(["PARTNER_SETTLEMENT", "PARTNER_PAYMENT"] as const)(
      "%s: no counterparty metadata falls back to the sign of amount_usd (historical rows)",
      (type) => {
        expect(getCashFlowDirection(type, null, { usd: 25, lbp: 0 })).toBe(
          "in",
        );
        expect(getCashFlowDirection(type, null, { usd: -25, lbp: 0 })).toBe(
          "out",
        );
      },
    );

    it.each(["PARTNER_SETTLEMENT", "PARTNER_PAYMENT"] as const)(
      "%s: sign fallback also reads amount_lbp when amount_usd is 0",
      (type) => {
        expect(getCashFlowDirection(type, null, { usd: 0, lbp: 900000 })).toBe(
          "in",
        );
        expect(getCashFlowDirection(type, null, { usd: 0, lbp: -900000 })).toBe(
          "out",
        );
      },
    );

    it("metadata.counterparty.flow takes precedence over the amount sign", () => {
      expect(
        getCashFlowDirection("PARTNER_SETTLEMENT", flowMeta("IN"), {
          usd: -5,
          lbp: 0,
        }),
      ).toBe("in");
      expect(
        getCashFlowDirection("PARTNER_PAYMENT", flowMeta("OUT"), {
          usd: 5,
          lbp: 0,
        }),
      ).toBe("out");
    });

    it("no metadata and no signed amounts → null (no badge, never crashes)", () => {
      expect(getCashFlowDirection("PARTNER_SETTLEMENT", null)).toBeNull();
      expect(getCashFlowDirection("PARTNER_PAYMENT", "not-json{")).toBeNull();
      expect(
        getCashFlowDirection("PARTNER_SETTLEMENT", null, { usd: 0, lbp: 0 }),
      ).toBeNull();
    });

    // LIRA-066 residual fix: a CLIENT_ACCOUNT settlement moves no real drawer
    // cash even though metadata.counterparty.flow is still stamped (IN/OUT) —
    // the method override must win over flow so the badge stays blank, same
    // "no cash, no arrow" treatment PARTNER_ADJUSTMENT already gets.
    it("metadata.counterparty.method CLIENT_ACCOUNT → null, even with flow set", () => {
      const clientAccountMeta = (flow: "IN" | "OUT") =>
        JSON.stringify({ counterparty: { flow, method: "CLIENT_ACCOUNT" } });
      expect(
        getCashFlowDirection("PARTNER_SETTLEMENT", clientAccountMeta("IN")),
      ).toBeNull();
      expect(
        getCashFlowDirection("PARTNER_SETTLEMENT", clientAccountMeta("OUT")),
      ).toBeNull();
      expect(
        getCashFlowDirection("PARTNER_PAYMENT", clientAccountMeta("IN")),
      ).toBeNull();
    });
  });

  describe("isCashTransaction — the 'Cash only (till)' filter predicate (B6)", () => {
    it("true when any leg is CASH", () => {
      expect(isCashTransaction([{ method: "CASH" }])).toBe(true);
      expect(isCashTransaction([{ method: "OMT" }, { method: "CASH" }])).toBe(
        true,
      );
    });

    it("false for wallet-only / on-account / empty transactions", () => {
      expect(isCashTransaction([{ method: "OMT" }])).toBe(false);
      expect(isCashTransaction([{ method: "WHISH" }])).toBe(false);
      expect(isCashTransaction([])).toBe(false);
      expect(isCashTransaction(undefined)).toBe(false);
    });
  });
});
