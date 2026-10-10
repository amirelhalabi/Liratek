/**
 * LIRA-289 T055 — a customer repays into the shop's Whish or OMT wallet from
 * the phone (spec US5 / FR-006), on the REAL schema.
 *
 * The body is the shape the web Debts page sends (clientId, amountUSD,
 * amountLBP, payments[]) and is parsed by addRepaymentSchema, the schema the
 * REST route validates with. As deltas (rule 15):
 *   - the client's debt drops by the amount;
 *   - the wallet the customer paid into rises by the same amount;
 *   - voiding the repayment brings the debt and every drawer back (rule 20).
 *
 * Characterization of the existing repayment path; not a failing-first guard.
 */
import type Database from "better-sqlite3";
import { addClient, installWarrantyTestDb, uninstallWarrantyTestDb } from "../testHelpers/warrantyDb";
import { initFixedTenantContext, resetTenantContext } from "../../db/tenantContext";
import { addRepaymentSchema, createFinancialServiceSchema } from "../../validators";
import { buildWalletTransferPayload, calculateOmtWhishAppFees } from "../../utils/walletTransfer";
import { getFinancialService, resetFinancialService } from "../../services/FinancialService";
import { getDebtService, resetDebtService } from "../../services/DebtService";
import { getTransactionService, resetTransactionService } from "../../services/TransactionService";

let db: Database.Database;
let nextClient = 300;

const drawers = (): Record<string, number> =>
  Object.fromEntries(
    (db.prepare(`SELECT drawer_name || ':' || currency_code AS k, balance FROM drawer_balances`).all() as { k: string; balance: number }[]).map((r) => [r.k, r.balance]),
  );

function deltas(before: Record<string, number>, after: Record<string, number>) {
  const out: Record<string, number> = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const v = (after[k] ?? 0) - (before[k] ?? 0);
    if (Math.abs(v) > 1e-9) out[k] = Math.round(v * 100) / 100;
  }
  return out;
}

const debtUsd = (clientId: number) =>
  (db.prepare(`SELECT COALESCE(SUM(amount_usd), 0) AS usd FROM debt_ledger WHERE client_id = ?`).get(clientId) as { usd: number }).usd;

/** A $50 Whish App send put on the client's account: the debt to repay. */
function owe(clientId: number) {
  const fees = calculateOmtWhishAppFees({ activeProvider: "WHISH_APP", serviceType: "SEND", currency: "USD", parsedAmount: 50, manualFee: "", includingFees: false });
  const body = createFinancialServiceSchema.parse(
    buildWalletTransferPayload({
      provider: "WHISH_APP", serviceType: "SEND", currency: "USD", fees, includingFees: false,
      client: { id: clientId, name: "Hassan", phone: `72${clientId}000` }, paidByMethod: "CUSTOMER_ACCOUNT",
      payments: [{ method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: fees.customerPays }],
    }),
  );
  type AddInput = Parameters<ReturnType<typeof getFinancialService>["addTransaction"]>[0];
  expect(getFinancialService().addTransaction({ ...(body as unknown as AddInput), userId: 1 }).success).toBe(true);
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
  resetDebtService();
  resetTransactionService();
});

describe.each([
  ["WHISH", "Whish_App"],
  ["OMT", "OMT_App"],
])("repayment into the %s wallet", (method, drawer) => {
  it("lowers the debt, raises that wallet by the same amount, and a void restores both", () => {
    const clientId = nextClient++;
    addClient(db, { id: clientId, name: "Hassan", phone: `72${clientId}000` });
    owe(clientId);
    const debtBefore = debtUsd(clientId);
    expect(debtBefore).toBeCloseTo(50, 6);
    const before = drawers();

    const body = addRepaymentSchema.parse({
      clientId,
      amountUSD: 20,
      amountLBP: 0,
      payments: [{ method, currencyCode: "USD", amount: 20 }],
    });
    type RepayInput = Parameters<ReturnType<typeof getDebtService>["addRepayment"]>[0];
    const result = getDebtService().addRepayment({ ...(body as unknown as RepayInput), userId: 1 });
    expect(result.success).toBe(true);

    expect(debtBefore - debtUsd(clientId)).toBeCloseTo(20, 6);
    expect(deltas(before, drawers())).toEqual({ [`${drawer}:USD`]: 20 });

    const txn = db
      .prepare(`SELECT id, client_id FROM transactions WHERE type = 'DEBT_REPAYMENT' AND client_id = ? ORDER BY id DESC LIMIT 1`)
      .get(clientId) as { id: number; client_id: number } | undefined;
    expect(txn?.client_id).toBe(clientId);
    getTransactionService().voidTransaction(txn!.id, 1);
    expect(deltas(before, drawers())).toEqual({});
    expect(debtUsd(clientId)).toBeCloseTo(debtBefore, 6);
  });
});
