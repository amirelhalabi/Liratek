/**
 * LIRA-326 — one Mobile Recharge basket across providers (iPick, Katsh,
 * Whish App), paid ONCE.
 *
 * RechargeBasketService creates an automatic customer session, checks it out
 * through the existing SessionCheckoutService (one `_batch` cart entry per
 * provider), and deletes the session again if checkout fails. What this file
 * pins:
 *   - every sub-item is booked under its OWN provider: each provider drawer
 *     pays only its own costs (the bug: a mixed iPick + Katsh cart charged
 *     everything to the tab's provider);
 *   - the customer's payment lands in General ONCE, per currency;
 *   - the session is closed, named, noted "Mobile Recharge basket" and links
 *     every sale;
 *   - the whole basket reverses as one (rule 20: every ledger nets to 0 per
 *     currency), and a lone item's reversal stays refused;
 *   - every refusal writes NOTHING (no session, no sale, no drawer move).
 *
 * Real production schema (create_db.sql + migrations); nothing in the money
 * path is mocked.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initDatabase } from "../../db/connection";
import { runMigrations } from "../../db/migrations/index";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import type { CheckoutCartItem } from "../SessionCheckoutService";
import { resetSessionCheckoutService } from "../SessionCheckoutService";
import {
  RechargeBasketService,
  resetRechargeBasketService,
} from "../RechargeBasketService";
import { resetSessionPaymentService } from "../SessionPaymentService";
import { resetDebtService } from "../DebtService";
import { resetFinancialService } from "../FinancialService";
import { resetCustomServiceService } from "../CustomServiceService";
import { resetDebtRepository } from "../../repositories/DebtRepository";
import { resetCustomerSessionRepository } from "../../repositories/CustomerSessionRepository";
import { resetSessionPaymentRepository } from "../../repositories/SessionPaymentRepository";
import { resetClientRepository } from "../../repositories/ClientRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../../repositories/TransactionRepository";
import { resetPartnerRepository } from "../../repositories/PartnerRepository";
import { resetCustomServiceRepository } from "../../repositories/CustomServiceRepository";
import { resetSettingsRepository } from "../../repositories/SettingsRepository";
import { resetFinancialServiceRepository } from "../../repositories/FinancialServiceRepository";
import { resetSupplierRepository } from "../../repositories/SupplierRepository";
import {
  snapshotLedgers,
  ledgerDeltas,
  type LedgerSnapshot,
} from "../../repositories/testHelpers/postingAssert";
import type { RechargeBasketCheckoutInput } from "../../validators/rechargeBasket";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");
const RATE = 89500;

function buildDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(db);
  runMigrations(db);
  return db;
}

function resetAll(): void {
  resetRechargeBasketService();
  resetSessionCheckoutService();
  resetSessionPaymentService();
  resetDebtService();
  resetFinancialService();
  resetCustomServiceService();
  resetDebtRepository();
  resetCustomerSessionRepository();
  resetSessionPaymentRepository();
  resetClientRepository();
  resetTransactionRepository();
  resetPartnerRepository();
  resetCustomServiceRepository();
  resetSettingsRepository();
  resetFinancialServiceRepository();
  resetSupplierRepository();
}

// ─── Cart builders (the shape KatshForm / FinancialForm put in a session) ────

interface Line {
  provider: string;
  amount: number;
  cost: number;
  currency: "LBP" | "USD";
  key: string;
}

function subItem(l: Line): Record<string, unknown> {
  return {
    provider: l.provider,
    serviceType: "SEND",
    amount: l.amount,
    cost: l.cost,
    currency: l.currency,
    commission: Math.max(0, l.amount - l.cost),
    itemKey: l.key,
    itemCategory: "test",
    note: l.key,
  };
}

function batchEntry(
  module: "ipick" | "katsh" | "whish_app",
  lines: Line[],
): CheckoutCartItem {
  const currency = lines[0].currency;
  return {
    id: `entry-${module}`,
    module,
    label: `${module}: ${lines.map((l) => l.key).join(", ")}`,
    amount: lines.reduce((s, l) => s + l.amount, 0),
    currency,
    ipcChannel: "financial:create",
    formData: { _batch: true, items: lines.map(subItem) },
  };
}

const katshLines: Line[] = [
  {
    provider: "Katsh",
    amount: 500_000,
    cost: 450_000,
    currency: "LBP",
    key: "katsh-a",
  },
  {
    provider: "Katsh",
    amount: 300_000,
    cost: 270_000,
    currency: "LBP",
    key: "katsh-b",
  },
];
const whishLbpLines: Line[] = [
  {
    provider: "WHISH_APP",
    amount: 1_000_000,
    cost: 900_000,
    currency: "LBP",
    key: "whish-a",
  },
];
const ipickLines: Line[] = [
  {
    provider: "iPick",
    amount: 900_000,
    cost: 850_000,
    currency: "LBP",
    key: "ipick-a",
  },
];
const whishUsdLines: Line[] = [
  {
    provider: "WHISH_APP",
    amount: 10,
    cost: 9,
    currency: "USD",
    key: "whish-usd",
  },
];

function cashLbp(amount: number) {
  return {
    method: "CASH",
    currency_code: "LBP",
    amount,
    direction: "IN" as const,
  };
}
function cashUsd(amount: number) {
  return {
    method: "CASH",
    currency_code: "USD",
    amount,
    direction: "IN" as const,
  };
}

describe("RechargeBasketService.checkout — one basket across providers", () => {
  let db: Database.Database;

  beforeEach(() => {
    resetAll();
    db = buildDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
    resetTenantContext();
    resetAll();
    db.close();
  });

  function checkout(req: Omit<RechargeBasketCheckoutInput, "userId">) {
    return new RechargeBasketService().checkout(
      { ...req, userId: 1 } as RechargeBasketCheckoutInput & { userId: number },
      { username: "admin" },
    );
  }

  function count(table: string): number {
    return (
      db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
    ).n;
  }

  function fsRows() {
    return db
      .prepare(
        `SELECT id, provider, amount, cost, currency FROM financial_services ORDER BY id`,
      )
      .all() as Array<{
      id: number;
      provider: string;
      amount: number;
      cost: number;
      currency: string;
    }>;
  }

  function sessionRow(id: number) {
    return db
      .prepare(
        `SELECT customer_name, customer_phone, customer_notes, is_active, started_by, closed_by
           FROM customer_sessions WHERE id = ?`,
      )
      .get(id) as
      | {
          customer_name: string | null;
          customer_phone: string | null;
          customer_notes: string | null;
          is_active: number;
          started_by: string;
          closed_by: string | null;
        }
      | undefined;
  }

  function linkedFsIds(sessionId: number): number[] {
    return (
      db
        .prepare(
          `SELECT transaction_id FROM customer_session_transactions
            WHERE session_id = ? ORDER BY transaction_id`,
        )
        .all(sessionId) as Array<{ transaction_id: number }>
    ).map((r) => r.transaction_id);
  }

  function profitTotals(): { usd: number; lbp: number } {
    return db
      .prepare(
        `SELECT COALESCE(SUM(profit_usd), 0) AS usd, COALESCE(SUM(profit_lbp), 0) AS lbp FROM transactions`,
      )
      .get() as { usd: number; lbp: number };
  }

  /** Every ledger untouched since `before` — the "writes nothing" proof. */
  function expectNothingWritten(
    before: LedgerSnapshot,
    sessionsBefore: number,
  ) {
    expect(ledgerDeltas(before, snapshotLedgers(db))).toEqual({
      drawers: {},
      supplier: {},
      partner: {},
      debt: {},
    });
    expect(count("customer_sessions")).toBe(sessionsBefore);
    expect(count("financial_services")).toBe(0);
    expect(count("transactions")).toBe(0);
    expect(count("payments")).toBe(0);
    expect(count("customer_session_transactions")).toBe(0);
  }

  // ── 1. Katsh + Whish App, one cash LBP leg ─────────────────────────────

  it("Katsh + Whish App basket paid in cash: one sale per sub-item under its own provider, each drawer pays only its own costs, General +total once", async () => {
    const before = snapshotLedgers(db);
    const total = 800_000 + 1_000_000;

    const result = await checkout({
      cartItems: [
        batchEntry("katsh", katshLines),
        batchEntry("whish_app", whishLbpLines),
      ],
      payments: [cashLbp(total)],
      exchangeRate: RATE,
    });
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.sessionId).toEqual(expect.any(Number));
    expect(result.checkoutTotalLbp).toBe(total);

    const rows = fsRows();
    expect(rows.map((r) => [r.provider, r.amount, r.cost])).toEqual([
      ["Katsh", 500_000, 450_000],
      ["Katsh", 300_000, 270_000],
      ["WHISH_APP", 1_000_000, 900_000],
    ]);

    const d = ledgerDeltas(before, snapshotLedgers(db));
    expect(d.drawers).toEqual({
      "General|LBP": total,
      "Katsh|LBP": -(450_000 + 270_000),
      "Whish_App|LBP": -900_000,
    });
    expect(d.debt).toEqual({});
    expect(d.partner).toEqual({});

    // A closed walk-in session, labelled, linking every sale.
    const s = sessionRow(result.sessionId!);
    expect(s).toMatchObject({
      customer_name: "Walk-in",
      customer_notes: "Mobile Recharge basket",
      is_active: 0,
      started_by: "admin",
      closed_by: "admin",
    });
    expect(linkedFsIds(result.sessionId!)).toEqual(rows.map((r) => r.id));
  });

  // ── 2. iPick + Katsh — the mis-booking this feature fixes ─────────────

  it("iPick + Katsh basket: the iPick drawer pays only iPick costs, the Katsh drawer only Katsh costs", async () => {
    const before = snapshotLedgers(db);
    const total = 900_000 + 800_000;

    const result = await checkout({
      cartItems: [
        batchEntry("ipick", ipickLines),
        batchEntry("katsh", katshLines),
      ],
      payments: [cashLbp(total)],
      exchangeRate: RATE,
    });
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);

    expect(fsRows().map((r) => r.provider)).toEqual([
      "iPick",
      "Katsh",
      "Katsh",
    ]);
    const d = ledgerDeltas(before, snapshotLedgers(db));
    expect(d.drawers).toEqual({
      "General|LBP": total,
      "iPick|LBP": -850_000,
      "Katsh|LBP": -720_000,
    });
  });

  // ── 3. Mixed currency ───────────────────────────────────────────────────

  it("mixed currency: Katsh in LBP + Whish App in USD, paid USD + LBP legs — each sale in its own currency, legs reconcile", async () => {
    const before = snapshotLedgers(db);

    const result = await checkout({
      cartItems: [
        batchEntry("katsh", katshLines),
        batchEntry("whish_app", whishUsdLines),
      ],
      payments: [cashUsd(10), cashLbp(800_000)],
      exchangeRate: RATE,
    });
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.checkoutTotalUsd).toBe(10);
    expect(result.checkoutTotalLbp).toBe(800_000);

    expect(fsRows().map((r) => [r.provider, r.currency])).toEqual([
      ["Katsh", "LBP"],
      ["Katsh", "LBP"],
      ["WHISH_APP", "USD"],
    ]);
    const d = ledgerDeltas(before, snapshotLedgers(db));
    expect(d.drawers).toEqual({
      "General|USD": 10,
      "General|LBP": 800_000,
      "Katsh|LBP": -720_000,
      "Whish_App|USD": -9,
    });
    expect(d.debt).toEqual({});
  });

  // ── 4. Reversal: the whole basket, never one item (rule 20) ─────────────

  it("refundSessionBasket nets every ledger and profit back to 0 per currency; refunding or voiding one item alone is refused", async () => {
    const before = snapshotLedgers(db);
    const profitBefore = profitTotals();

    const result = await checkout({
      cartItems: [
        batchEntry("katsh", katshLines),
        batchEntry("whish_app", whishUsdLines),
      ],
      payments: [cashUsd(10), cashLbp(800_000)],
      exchangeRate: RATE,
    });
    expect(result.success).toBe(true);
    const sessionId = result.sessionId!;

    // The sale stamped profit (commission) per currency.
    const profitAfterSale = profitTotals();
    expect(profitAfterSale.lbp - profitBefore.lbp).toBeCloseTo(80_000, 2);
    expect(profitAfterSale.usd - profitBefore.usd).toBeCloseTo(1, 2);

    // A lone item cannot be reversed — it belongs to the basket.
    const txnRepo = getTransactionRepository();
    const firstFs = fsRows()[0];
    const firstTxn = txnRepo.getBySourceId("financial_services", firstFs.id)!;
    const midSnapshot = snapshotLedgers(db);
    expect(() => txnRepo.refundTransaction(firstTxn.id, 1)).toThrow(
      /session basket/i,
    );
    expect(() => txnRepo.voidTransaction(firstTxn.id, 1)).toThrow(
      /session basket/i,
    );
    expect(ledgerDeltas(midSnapshot, snapshotLedgers(db))).toEqual({
      drawers: {},
      supplier: {},
      partner: {},
      debt: {},
    });

    const refund = txnRepo.refundSessionBasket(sessionId, 1);
    expect(refund.itemCount).toBe(3);

    expect(ledgerDeltas(before, snapshotLedgers(db))).toEqual({
      drawers: {},
      supplier: {},
      partner: {},
      debt: {},
    });
    const profitAfter = profitTotals();
    expect(profitAfter.lbp).toBeCloseTo(profitBefore.lbp, 2);
    expect(profitAfter.usd).toBeCloseTo(profitBefore.usd, 2);
  });

  // ── 5. Refusals write nothing ───────────────────────────────────────────

  describe("refusals write nothing", () => {
    async function expectRefused(
      req: Omit<RechargeBasketCheckoutInput, "userId">,
      error: RegExp,
    ) {
      const before = snapshotLedgers(db);
      const sessionsBefore = count("customer_sessions");
      const result = await checkout(req);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(error);
      expect(result.sessionId).toBeUndefined();
      expectNothingWritten(before, sessionsBefore);
    }

    it("an empty cart", async () => {
      await expectRefused(
        { cartItems: [], payments: [cashLbp(1)], exchangeRate: RATE },
        /empty/i,
      );
    });

    it("an entry on another channel", async () => {
      const entry = {
        ...batchEntry("katsh", katshLines),
        ipcChannel: "recharge:process",
      };
      await expectRefused(
        {
          cartItems: [entry],
          payments: [cashLbp(800_000)],
          exchangeRate: RATE,
        },
        /mobile recharge basket/i,
      );
    });

    it("an entry for a module outside the basket", async () => {
      const entry = { ...batchEntry("katsh", katshLines), module: "omt_app" };
      await expectRefused(
        {
          cartItems: [entry],
          payments: [cashLbp(800_000)],
          exchangeRate: RATE,
        },
        /mobile recharge basket/i,
      );
    });

    it("an entry that is not a _batch", async () => {
      const entry = batchEntry("katsh", katshLines);
      const notBatch = {
        ...entry,
        formData: { ...entry.formData, _batch: false },
      };
      await expectRefused(
        {
          cartItems: [notBatch],
          payments: [cashLbp(800_000)],
          exchangeRate: RATE,
        },
        /mobile recharge basket/i,
      );
    });

    it("a sub-item whose provider does not match its entry (iPick line inside the Katsh entry)", async () => {
      const mixed = batchEntry("katsh", [...katshLines, ...ipickLines]);
      await expectRefused(
        {
          cartItems: [mixed],
          payments: [cashLbp(1_700_000)],
          exchangeRate: RATE,
        },
        /provider/i,
      );
    });

    it("an entry with no sub-items (its amount would be charged for nothing)", async () => {
      const entry = batchEntry("katsh", katshLines);
      const empty = { ...entry, formData: { _batch: true, items: [] } };
      await expectRefused(
        {
          cartItems: [batchEntry("whish_app", whishLbpLines), empty],
          payments: [cashLbp(1_800_000)],
          exchangeRate: RATE,
        },
        /no items/i,
      );
    });

    it("a sub-item in another currency than its entry (would be bucketed in the entry's currency)", async () => {
      const entry = batchEntry("whish_app", [
        ...whishLbpLines,
        ...whishUsdLines,
      ]);
      await expectRefused(
        {
          cartItems: [entry],
          payments: [cashLbp(1_000_000), cashUsd(10)],
          exchangeRate: RATE,
        },
        /currenc/i,
      );
    });

    it("a checkout failure (on-account basket with no client) deletes the session it created", async () => {
      await expectRefused(
        {
          cartItems: [
            batchEntry("katsh", katshLines),
            batchEntry("whish_app", whishLbpLines),
          ],
          payments: [
            {
              method: "CUSTOMER_ACCOUNT",
              currency_code: "LBP",
              amount: 1_800_000,
              direction: "IN",
            },
          ],
          exchangeRate: RATE,
        },
        /client/i,
      );
    });
  });

  // ── 6. The customer ─────────────────────────────────────────────────────

  it("clientName / clientPhone become the session customer, and name + phone register the client", async () => {
    const result = await checkout({
      cartItems: [
        batchEntry("katsh", katshLines),
        batchEntry("whish_app", whishLbpLines),
      ],
      payments: [cashLbp(1_800_000)],
      exchangeRate: RATE,
      clientName: "  Rami Haddad ",
      clientPhone: "70111222",
    });
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(sessionRow(result.sessionId!)).toMatchObject({
      customer_name: "Rami Haddad",
      customer_phone: "70111222",
      customer_notes: "Mobile Recharge basket",
    });
    const client = db
      .prepare(`SELECT id FROM clients WHERE phone_number = ?`)
      .get("70111222") as { id: number } | undefined;
    expect(client).toBeDefined();
    const clientIds = db
      .prepare(`SELECT DISTINCT client_id FROM financial_services`)
      .all() as Array<{ client_id: number | null }>;
    expect(clientIds).toEqual([{ client_id: client!.id }]);
  });

  it("no client name → the session customer is 'Walk-in' with no phone", async () => {
    const result = await checkout({
      cartItems: [batchEntry("katsh", katshLines)],
      payments: [cashLbp(800_000)],
      exchangeRate: RATE,
      clientName: "   ",
    });
    expect(result.success).toBe(true);
    expect(sessionRow(result.sessionId!)).toMatchObject({
      customer_name: "Walk-in",
      customer_phone: null,
    });
  });

  // ── 7. Bills ride the basket (LIRA-327) ─────────────────────────────────
  //
  // A bill is its own cart entry — the exact shape KatshForm already puts in
  // a customer session for a bill (`financial:create`, serviceType BILL,
  // cost = price = amount, commission 0) — so it is booked by the same
  // FinancialService call as a bill paid on its own.

  describe("bills (LIRA-327)", () => {
    function billEntry(
      module: "ipick" | "katsh",
      amount: number,
      currency: "LBP" | "USD",
    ): CheckoutCartItem {
      const provider = module === "ipick" ? "iPick" : "Katsh";
      return {
        id: `bill-${module}-${currency}-${amount}`,
        module,
        label: `${provider} BILL — ${amount} ${currency}`,
        amount,
        currency,
        ipcChannel: "financial:create",
        formData: {
          provider,
          serviceType: "BILL",
          amount,
          cost: amount,
          price: amount,
          currency,
          commission: 0,
        },
      };
    }

    const BILL_COLUMNS = `provider, service_type, amount, cost, price, commission,
      commission_model, currency, partner_id`;
    function billRow(id: number) {
      return db
        .prepare(`SELECT ${BILL_COLUMNS} FROM financial_services WHERE id = ?`)
        .get(id);
    }

    it("a Katsh bill + a Whish App card paid once: the bill is booked under Katsh exactly like a bill paid on its own", async () => {
      // The reference: the same bill paid on its own (today's walk-in call).
      const { getFinancialService } = await import("../FinancialService");
      const beforeAlone = snapshotLedgers(db);
      const alone = getFinancialService().addTransaction({
        provider: "Katsh",
        serviceType: "BILL",
        amount: 500_000,
        cost: 500_000,
        price: 500_000,
        currency: "LBP",
        commission: 0,
        paidByMethod: "CASH",
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 500_000 }],
        userId: 1,
      } as never);
      expect(alone.success).toBe(true);
      const aloneDelta = ledgerDeltas(beforeAlone, snapshotLedgers(db));

      const before = snapshotLedgers(db);
      const result = await checkout({
        cartItems: [
          billEntry("katsh", 500_000, "LBP"),
          batchEntry("whish_app", whishLbpLines),
        ],
        payments: [cashLbp(1_500_000)],
        exchangeRate: RATE,
      });
      expect(result.error).toBeUndefined();
      expect(result.success).toBe(true);
      expect(result.checkoutTotalLbp).toBe(1_500_000);

      const rows = fsRows();
      const basketBill = rows[1]!;
      // Same row as the bill paid on its own.
      expect(billRow(basketBill.id)).toEqual(billRow(alone.id!));
      // …the WHOLE financial_services row and its unified transactions row,
      // except ids, times, the customer and how it was paid (the basket's one
      // pooled payment, not legs of its own).
      const fullRow = (table: string, where: string, id: number) =>
        db
          .prepare(`SELECT * FROM ${table} WHERE ${where} = ?`)
          .get(id) as Record<string, unknown>;
      const strip = (r: Record<string, unknown>, extra: string[] = []) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r)) {
          if (
            /^(id|created_at|updated_at|source_id|client_id|client_name|transaction_time)$/.test(
              k,
            ) ||
            extra.includes(k)
          )
            continue;
          out[k] = v;
        }
        return out;
      };
      expect(strip(fullRow("financial_services", "id", basketBill.id))).toEqual(
        strip(fullRow("financial_services", "id", alone.id!)),
      );
      const txnOf = (fsId: number) =>
        db
          .prepare(
            `SELECT * FROM transactions WHERE source_table = 'financial_services' AND source_id = ?`,
          )
          .get(fsId) as Record<string, unknown>;
      // The one difference: the basket stamps the rate it was paid at.
      // LIRA-329: how it was paid also lives in the transaction's details —
      // `paid_in_session` and the payment snapshot (the basket's pooled
      // payment, not legs of its own) — so those two are left out too.
      const withoutHowPaid = (r: Record<string, unknown>) => {
        const meta = JSON.parse(String(r.metadata_json)) as Record<
          string,
          unknown
        >;
        const { payment_snapshot: _snapshot, ...rest } = meta;
        if (rest.details && typeof rest.details === "object") {
          const { paid_in_session: _session, ...details } =
            rest.details as Record<string, unknown>;
          rest.details = details;
        }
        return { ...strip(r, ["exchange_rate"]), metadata_json: rest };
      };
      expect(withoutHowPaid(txnOf(basketBill.id))).toEqual(
        withoutHowPaid(txnOf(alone.id!)),
      );
      expect(txnOf(basketBill.id).exchange_rate).toBe(RATE);
      expect(billRow(basketBill.id)).toMatchObject({
        provider: "Katsh",
        service_type: "BILL",
        commission_model: 1,
      });
      expect(rows[2]).toMatchObject({ provider: "WHISH_APP" });

      // The Katsh drawer and supplier move exactly as for the bill alone;
      // the payment lands in General once.
      const d = ledgerDeltas(before, snapshotLedgers(db));
      expect(d.drawers).toEqual({
        "General|LBP": 1_500_000,
        "Katsh|LBP": aloneDelta.drawers["Katsh|LBP"],
        "Whish_App|LBP": -900_000,
      });
      expect(aloneDelta.drawers["Katsh|LBP"]).toBe(-500_000);
      expect(d.supplier).toEqual(aloneDelta.supplier);
      expect(d.debt).toEqual({});

      // The bill joins Katsh's Settle queue, like any bill.
      const { getFinancialServiceRepository } =
        await import("../../repositories/FinancialServiceRepository");
      const unsettled = getFinancialServiceRepository()
        .getUnsettledBySupplier("Katsh")
        .map((r) => r.id);
      expect(unsettled).toContain(basketBill.id);
      expect(linkedFsIds(result.sessionId!)).toEqual([
        basketBill.id,
        rows[2]!.id,
      ]);
    });

    it("an iPick LBP bill, a Katsh USD bill and Katsh LBP cards: each bill under its own provider and currency; refunding the basket nets every ledger to 0 per currency and empties the Settle queue", async () => {
      const before = snapshotLedgers(db);
      const profitBefore = profitTotals();

      const result = await checkout({
        cartItems: [
          batchEntry("katsh", katshLines),
          billEntry("katsh", 20, "USD"),
          billEntry("ipick", 300_000, "LBP"),
          batchEntry("whish_app", whishUsdLines),
        ],
        payments: [cashLbp(800_000 + 300_000), cashUsd(20 + 10)],
        exchangeRate: RATE,
      });
      expect(result.error).toBeUndefined();
      expect(result.success).toBe(true);
      expect(result.checkoutTotalLbp).toBe(1_100_000);
      expect(result.checkoutTotalUsd).toBe(30);

      expect(
        fsRows().map((r) => [r.provider, r.amount, r.cost, r.currency]),
      ).toEqual([
        ["Katsh", 500_000, 450_000, "LBP"],
        ["Katsh", 300_000, 270_000, "LBP"],
        ["Katsh", 20, 20, "USD"],
        ["iPick", 300_000, 300_000, "LBP"],
        ["WHISH_APP", 10, 9, "USD"],
      ]);
      const d = ledgerDeltas(before, snapshotLedgers(db));
      expect(d.drawers).toEqual({
        "General|LBP": 1_100_000,
        "General|USD": 30,
        "Katsh|LBP": -720_000,
        "Katsh|USD": -20,
        "iPick|LBP": -300_000,
        "Whish_App|USD": -9,
      });

      const { getFinancialServiceRepository } =
        await import("../../repositories/FinancialServiceRepository");
      const fsRepo = getFinancialServiceRepository();
      // Katsh bills wait for settlement; iPick bills earn no commission
      // (suppliers.commission_eligible = 0), so they never queue — same as a
      // bill paid on its own.
      expect(
        fsRepo
          .getUnsettledBySupplier("Katsh")
          .filter((r) => (r.service_type as string) === "BILL").length,
      ).toBe(1);

      const refund = getTransactionRepository().refundSessionBasket(
        result.sessionId!,
        1,
      );
      expect(refund.itemCount).toBe(5);

      expect(ledgerDeltas(before, snapshotLedgers(db))).toEqual({
        drawers: {},
        supplier: {},
        partner: {},
        debt: {},
      });
      const profitAfter = profitTotals();
      expect(profitAfter.lbp).toBeCloseTo(profitBefore.lbp, 2);
      expect(profitAfter.usd).toBeCloseTo(profitBefore.usd, 2);
      // A refunded bill is no longer waiting to be settled.
      expect(
        fsRepo
          .getUnsettledBySupplier("Katsh")
          .filter((r) => (r.service_type as string) === "BILL"),
      ).toEqual([]);
    });

    it("voiding the basket nets a bill + card basket to 0 on every ledger", async () => {
      const before = snapshotLedgers(db);
      const result = await checkout({
        cartItems: [
          billEntry("katsh", 500_000, "LBP"),
          batchEntry("whish_app", whishLbpLines),
        ],
        payments: [cashLbp(1_500_000)],
        exchangeRate: RATE,
      });
      expect(result.success).toBe(true);
      getTransactionRepository().voidSessionBasket(result.sessionId!, 1);
      expect(ledgerDeltas(before, snapshotLedgers(db))).toEqual({
        drawers: {},
        supplier: {},
        partner: {},
        debt: {},
      });
    });

    describe("bill refusals write nothing", () => {
      async function expectRefused(
        cartItems: CheckoutCartItem[],
        error: RegExp,
      ) {
        const before = snapshotLedgers(db);
        const sessionsBefore = count("customer_sessions");
        const result = await checkout({
          cartItems,
          payments: [cashLbp(2_000_000)],
          exchangeRate: RATE,
        });
        expect(result.success).toBe(false);
        expect(result.error).toMatch(error);
        expectNothingWritten(before, sessionsBefore);
      }

      it("a bill whose provider does not match its entry", async () => {
        const bill = billEntry("katsh", 500_000, "LBP");
        await expectRefused(
          [{ ...bill, formData: { ...bill.formData, provider: "iPick" } }],
          /provider/i,
        );
      });

      it("a bill on Whish App (bills are iPick / Katsh only)", async () => {
        const bill = billEntry("katsh", 500_000, "LBP");
        await expectRefused(
          [
            {
              ...bill,
              module: "whish_app",
              formData: { ...bill.formData, provider: "WHISH_APP" },
            },
          ],
          /mobile recharge basket/i,
        );
      });

      it("a single entry that is not a bill and not a _batch", async () => {
        const bill = billEntry("katsh", 500_000, "LBP");
        await expectRefused(
          [{ ...bill, formData: { ...bill.formData, serviceType: "SEND" } }],
          /mobile recharge basket/i,
        );
      });

      it("a bill whose currency or amount differs from its entry", async () => {
        const bill = billEntry("katsh", 500_000, "LBP");
        await expectRefused(
          [{ ...bill, formData: { ...bill.formData, currency: "USD" } }],
          /currenc/i,
        );
        await expectRefused([{ ...bill, amount: 400_000 }], /amount/i);
      });

      it("a bill with a profit, or a cost that is not its amount", async () => {
        const bill = billEntry("katsh", 500_000, "LBP");
        await expectRefused(
          [{ ...bill, formData: { ...bill.formData, commission: 1_000 } }],
          /bill/i,
        );
        await expectRefused(
          [{ ...bill, formData: { ...bill.formData, cost: 400_000 } }],
          /bill/i,
        );
      });
    });
  });
});
