/**
 * LIRA-302 T012–T014 — a Katsh / iPick catalog cart booked through core's
 * shared builder (the payload the phone sends and the web's plain cart now
 * builds), on the REAL schema (create_db.sql).
 *
 * For provider × payment method × currency it asserts, as deltas (rule 15):
 *   - the provider drawer drops by the cart's gross cost (LBP);
 *   - the wallet paid into rises by what the customer paid, or the
 *     customer's debt does (on account);
 *   - the client is stamped on the transaction (rule 11);
 *   - profit = price − cost; no supplier ledger row (prepaid drawdown);
 *   - voiding it brings every drawer and the debt back (rule 20).
 *
 * Characterization of the existing money path through the new builder (no
 * unfixed version exists), not a failing-first guard.
 */
import type Database from "better-sqlite3";
import { addClient, installWarrantyTestDb, uninstallWarrantyTestDb } from "../testHelpers/warrantyDb";
import { initFixedTenantContext, resetTenantContext } from "../../db/tenantContext";
import { createFinancialServiceSchema } from "../../validators/financial";
import { buildCatalogSalePayload, catalogCartTotals, usdForLbp, type CatalogCartLine } from "../../utils/catalogSale";
import { transactionSummary, transactionTitle } from "../../utils/transactionText";
import { getFinancialService, resetFinancialService } from "../../services/FinancialService";
import { getTransactionService, resetTransactionService } from "../../services/TransactionService";

let db: Database.Database;
let nextClient = 500;
const RATE = 89_000;

const drawers = (): Record<string, number> =>
  Object.fromEntries(
    (db.prepare(`SELECT drawer_name || ':' || currency_code AS k, balance FROM drawer_balances`).all() as { k: string; balance: number }[]).map(
      (r) => [r.k, r.balance],
    ),
  );

function deltas(before: Record<string, number>, after: Record<string, number>) {
  const out: Record<string, number> = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const v = (after[k] ?? 0) - (before[k] ?? 0);
    if (Math.abs(v) > 1e-9) out[k] = Math.round(v * 100) / 100;
  }
  return out;
}

const debt = (clientId: number) =>
  db
    .prepare(`SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_lbp), 0) AS lbp FROM debt_ledger WHERE client_id = ?`)
    .get(clientId) as { usd: number; lbp: number };

const supplierRows = () => (db.prepare(`SELECT COUNT(*) AS n FROM supplier_ledger`).get() as { n: number }).n;

const CART: CatalogCartLine[] = [
  { item: { category: "Alfa", label: "$22 card", subcategory: "Prepaid", cost_lbp: 1_900_000, sell_lbp: 2_000_000 }, quantity: 2 },
  { item: { category: "PUBG", label: "60 UC", subcategory: "", cost_lbp: 80_000, sell_lbp: 100_000 }, quantity: 1 },
];
const { price: PRICE, cost: COST } = catalogCartTotals(CART);
const WALLET: Record<string, string> = { WHISH: "Whish_App", OMT: "OMT_App" };

type AddInput = Parameters<ReturnType<typeof getFinancialService>["addTransaction"]>[0];

function book(provider: "Katsh" | "iPick", method: string, currency: "LBP" | "USD", clientId: number | null, lines = CART) {
  const { price } = catalogCartTotals(lines);
  const amount = currency === "USD" ? usdForLbp(price, RATE) : price;
  const body = createFinancialServiceSchema.parse(
    buildCatalogSalePayload({
      provider,
      lines,
      paidByMethod: method,
      payments: [{ method, currencyCode: currency, amount }],
      ...(currency === "USD" ? { tenderExchangeRate: RATE } : {}),
      client: clientId ? { id: clientId, name: "Hassan" } : undefined,
    }),
  );
  const result = getFinancialService().addTransaction({ ...(body as unknown as AddInput), userId: 1 });
  expect(result.success).toBe(true);
  const txn = db
    .prepare(`SELECT id, client_id, metadata_json, summary, type, amount_usd, amount_lbp FROM transactions WHERE source_table = 'financial_services' AND source_id = ?`)
    .get(result.id) as { id: number; client_id: number | null; metadata_json: string | null; summary: string | null; type: string; amount_usd: number; amount_lbp: number };
  const fs = db.prepare(`SELECT commission, cost, price FROM financial_services WHERE id = ?`).get(result.id) as {
    commission: number;
    cost: number;
    price: number;
  };
  return { txn, fs, amount };
}

beforeAll(() => {
  db = installWarrantyTestDb();
  initFixedTenantContext(1);
});

afterAll(() => {
  resetTenantContext();
  uninstallWarrantyTestDb(db);
});

beforeEach(() => {
  resetFinancialService();
  resetTransactionService();
});

describe.each(["Katsh", "iPick"] as const)("%s catalog cart from the phone", (provider) => {
  describe.each(["LBP", "USD"] as const)("paid in %s", (currency) => {
    it.each(["CUSTOMER_ACCOUNT", "WHISH", "OMT"])("%s: right drawers, debt, client, profit; void nets to zero", (method) => {
      const clientId = nextClient++;
      addClient(db, { id: clientId, name: "Hassan", phone: `76${clientId}000` });
      const before = drawers();
      const debtBefore = debt(clientId);
      const supplierBefore = supplierRows();

      const { txn, fs, amount } = book(provider, method, currency, clientId);

      const expected: Record<string, number> = { [`${provider}:LBP`]: -COST };
      if (method !== "CUSTOMER_ACCOUNT") expected[`${WALLET[method]}:${currency}`] = amount;
      expect(deltas(before, drawers())).toEqual(expected);

      const debtAfter = debt(clientId);
      if (method === "CUSTOMER_ACCOUNT") {
        // Observed booking (T012 / U1): the debt is in the currency of the leg.
        expect({ usd: debtAfter.usd - debtBefore.usd, lbp: debtAfter.lbp - debtBefore.lbp }).toEqual(
          currency === "USD" ? { usd: amount, lbp: 0 } : { usd: 0, lbp: PRICE },
        );
      } else {
        expect(debtAfter).toEqual(debtBefore);
      }

      expect(txn.client_id).toBe(clientId);
      expect(fs.cost).toBe(COST);
      expect(fs.price).toBe(PRICE);
      expect(fs.commission).toBe(PRICE - COST);
      expect(supplierRows()).toBe(supplierBefore);

      getTransactionService().voidTransaction(txn.id, 1);
      expect(deltas(before, drawers())).toEqual({});
      expect(debt(clientId)).toEqual(debtBefore);
    });
  });

  it("a wallet sale needs no client", () => {
    const before = drawers();
    const { txn } = book(provider, "WHISH", "LBP", null);
    expect(txn.client_id).toBeNull();
    expect(deltas(before, drawers())).toEqual({ [`${provider}:LBP`]: -COST, "Whish_App:LBP": PRICE });
  });

  it("an MTC/Alfa card is a plain line: no carrier-line drawer moves (FR-011)", () => {
    const card: CatalogCartLine[] = [
      { item: { category: "mtc", label: "$7.58", subcategory: "mtc", cost_lbp: 700_000, sell_lbp: 750_000 }, quantity: 1 },
    ];
    const before = drawers();
    book(provider, "WHISH", "LBP", null, card);
    expect(deltas(before, drawers())).toEqual({ [`${provider}:LBP`]: -700_000, "Whish_App:LBP": 750_000 });
  });

  it("reads the same on web and phone: title is the provider, summary lists the items (LIRA-301)", () => {
    const clientId = nextClient++;
    addClient(db, { id: clientId, name: "Hassan", phone: `77${clientId}000` });
    const { txn } = book(provider, "CUSTOMER_ACCOUNT", "LBP", clientId);
    expect(transactionTitle(txn)).toBe(provider);
    const summary = transactionSummary(txn) ?? "";
    expect(summary).toContain("$22 card");
    expect(summary).toContain("60 UC");
  });
});
