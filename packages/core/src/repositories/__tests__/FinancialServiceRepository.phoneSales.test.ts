/**
 * LIRA-289 T030 — the after-hours sales the phone app records, booked through
 * the SAME shared builder the web form uses (buildWalletTransferPayload) and
 * the same schema the REST route validates with, against the REAL schema
 * (electron-app/create_db.sql).
 *
 * For each app wallet (Whish App, OMT App) × each phone payment choice
 * (customer account, Whish wallet, OMT wallet) it asserts, as DELTAS
 * (rule 15):
 *   - the wallet the transfer is sent from drops by the amount;
 *   - the wallet the customer paid into rises by what the customer pays
 *     (a customer-account payment moves no drawer and books the debt instead);
 *   - the sale is stamped with the client (rule 11);
 *   - voiding it brings every drawer and the customer's debt back to where
 *     they were (rule 20 / FEATURE_GUIDE §13 item 9).
 *
 * Binance is NOT a phone payment choice (yet): a USDT leg is refused by the
 * repository ("not USD or LBP — cannot reconcile") and a USD-coded leg books
 * a "Binance:USD" balance on a USDT drawer. Owner decision pending.
 *
 * Characterization of existing money paths through the new builder; there is
 * no "unfixed" version of this code, so it is not a failing-first guard.
 */
import type Database from "better-sqlite3";
import {
  addClient,
  installWarrantyTestDb,
  uninstallWarrantyTestDb,
} from "../testHelpers/warrantyDb";
import { initFixedTenantContext, resetTenantContext } from "../../db/tenantContext";
import { createFinancialServiceSchema } from "../../validators/financial";
import { buildWalletTransferPayload, calculateOmtWhishAppFees } from "../../utils/walletTransfer";
import { getFinancialService, resetFinancialService } from "../../services/FinancialService";
import { getTransactionService, resetTransactionService } from "../../services/TransactionService";

let db: Database.Database;

function drawerBalances(): Record<string, number> {
  const rows = db
    .prepare(`SELECT drawer_name || ':' || currency_code AS k, balance FROM drawer_balances`)
    .all() as { k: string; balance: number }[];
  return Object.fromEntries(rows.map((r) => [r.k, r.balance]));
}

function deltas(before: Record<string, number>, after: Record<string, number>) {
  const out: Record<string, number> = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const v = (after[k] ?? 0) - (before[k] ?? 0);
    if (Math.abs(v) > 1e-9) out[k] = Math.round(v * 100) / 100;
  }
  return out;
}

function clientDebtUsd(clientId: number): number {
  return (
    db
      .prepare(`SELECT COALESCE(SUM(amount_usd), 0) AS usd FROM debt_ledger WHERE client_id = ?`)
      .get(clientId) as { usd: number }
  ).usd;
}

const DRAWER_OF: Record<string, string> = { WHISH_APP: "Whish_App", OMT_APP: "OMT_App", WHISH: "Whish_App", OMT: "OMT_App" };

function record(provider: "WHISH_APP" | "OMT_APP", method: string, clientId: number) {
  const fees = calculateOmtWhishAppFees({
    activeProvider: provider,
    serviceType: "SEND",
    currency: "USD",
    parsedAmount: 50,
    // Whish App SEND never charges a fee; an OMT App SEND fee is typed in.
    manualFee: provider === "OMT_APP" ? "2" : "",
    includingFees: false,
  });
  const body = buildWalletTransferPayload({
    provider,
    serviceType: "SEND",
    currency: "USD",
    fees,
    includingFees: false,
    client: { id: clientId, name: "Hassan", phone: `70${clientId}000` },
    paidByMethod: method,
    payments: [{ method, currencyCode: "USD", amount: fees.customerPays }],
    tenderExchangeRate: 89500,
  });
  const parsed = createFinancialServiceSchema.parse(body);
  // Same hand-off as the REST route: the validated body plus the actor.
  type AddInput = Parameters<ReturnType<typeof getFinancialService>["addTransaction"]>[0];
  const result = getFinancialService().addTransaction({ ...(parsed as unknown as AddInput), userId: 1 });
  return { fees, result };
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

let nextClient = 100;

describe.each(["WHISH_APP", "OMT_APP"] as const)("%s SEND from the phone", (provider) => {
  it.each(["CUSTOMER_ACCOUNT", "WHISH", "OMT"])("paid %s: right drawers, client stamped, void nets to zero", (method) => {
    const clientId = nextClient++;
    addClient(db, { id: clientId, name: "Hassan", phone: `70${clientId}000` });
    const before = drawerBalances();
    const debtBefore = clientDebtUsd(clientId);

    const { fees, result } = record(provider, method, clientId);
    expect(result.success).toBe(true);

    // Expected movement, from the fee maths (no hand-typed totals).
    const expected: Record<string, number> = {};
    const add = (k: string, v: number) => {
      expected[k] = Math.round(((expected[k] ?? 0) + v) * 100) / 100;
      if (Math.abs(expected[k]) < 1e-9) delete expected[k];
    };
    add(`${DRAWER_OF[provider]}:USD`, -fees.walletAmount);
    if (method !== "CUSTOMER_ACCOUNT") add(`${DRAWER_OF[method]}:USD`, fees.customerPays);
    expect(deltas(before, drawerBalances())).toEqual(expected);
    expect(clientDebtUsd(clientId) - debtBefore).toBeCloseTo(method === "CUSTOMER_ACCOUNT" ? fees.customerPays : 0, 6);

    const txn = db
      .prepare(`SELECT id, client_id FROM transactions WHERE source_table = 'financial_services' AND source_id = ?`)
      .get(result.id) as { id: number; client_id: number | null };
    expect(txn.client_id).toBe(clientId);

    getTransactionService().voidTransaction(txn.id, 1);
    expect(deltas(before, drawerBalances())).toEqual({});
    expect(clientDebtUsd(clientId)).toBeCloseTo(debtBefore, 6);
  });
});
