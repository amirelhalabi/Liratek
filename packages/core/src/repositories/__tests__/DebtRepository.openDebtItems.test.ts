/**
 * LIRA-304 T026 — the repayment picker's list: every open item, basket
 * items grouped by session, primary-system transfers flagged, hand-added
 * debt never listed. Not proven failing-first (written after the code).
 */
import type Database from "better-sqlite3";
import {
  installDebtItemTestDb,
  uninstallDebtItemTestDb,
  addClient,
  seedBasketMembers,
  seedTransferDebt,
  seedSaleDebt,
  setBaseSystem,
  RATE,
} from "../testHelpers/debtItemDb";
import { DebtRepository } from "../DebtRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import {
  getSessionPaymentService,
  resetSessionPaymentService,
} from "../../services/SessionPaymentService";
import { resetSessionPaymentRepository } from "../SessionPaymentRepository";
import { resetCustomerSessionRepository } from "../CustomerSessionRepository";
import { resetSalesRepository } from "../SalesRepository";
import { resetClientRepository } from "../ClientRepository";
import { resetSettingsRepository } from "../SettingsRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

let db: Database.Database;

function resetAll(): void {
  resetSessionPaymentService();
  resetSessionPaymentRepository();
  resetCustomerSessionRepository();
  resetSalesRepository();
  resetClientRepository();
  resetSettingsRepository();
  resetPaymentMethodRepository();
  resetTransactionRepository();
}

beforeEach(() => {
  db = installDebtItemTestDb();
  initFixedTenantContext(1);
  resetAll();
  addClient(db, 7, "Claude Demo", "03101010");
});
afterEach(() => {
  resetAll();
  resetTenantContext();
  uninstallDebtItemTestDb(db);
});

it("lists basket items, separate visits and sales; flags primary transfers; skips hand-added debt", () => {
  const b = seedBasketMembers(db, 7, [
    { kind: "transfer", provider: "OMT", usd: 101 },
    { kind: "loto", lbp: 200_000 },
  ]);
  getSessionPaymentService().recordBasketPayment(b.sessionId, {
    legs: [
      { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 101 },
      { method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 200_000 },
    ],
    exchangeRate: RATE,
    userId: 1,
    clientId: 7,
  });
  seedTransferDebt(db, { clientId: 7, provider: "WHISH", usd: 20 });
  seedSaleDebt(db, { clientId: 7, usd: 14 });
  db.prepare(
    `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type, amount_usd, created_by)
     VALUES (1, 7, 'Manual Debt', 30, 1)`,
  ).run();

  const items = new DebtRepository().findOpenDebtItems(7);
  // Oldest first by each item's own debt row (the basket's row is stamped
  // at checkout time, after the seeded visits).
  expect(items).toHaveLength(4);
  const member = items.filter((i) => i.kind === "member");
  expect(member).toEqual([
    expect.objectContaining({
      sessionId: b.sessionId,
      openUsd: 101,
      isPrimary: true,
      primaryDrawer: "OMT_System",
      routingCap: { usd: 101, lbp: 0 },
    }),
    expect.objectContaining({ sessionId: b.sessionId, openLbp: 200_000, isPrimary: false }),
  ]);
  // A Whish (system) transfer in an OMT shop is listed but never routed.
  expect(items.find((i) => i.kind === "charge")).toEqual(
    expect.objectContaining({ openUsd: 20, isPrimary: false, routingCap: null }),
  );
  expect(items.find((i) => i.kind === "sale")).toEqual(
    expect.objectContaining({ openUsd: 14 }),
  );
  expect(items.some((i) => i.openUsd === 30)).toBe(false); // Manual Debt
});

it("in a Whish shop the Whish transfer is the primary one", () => {
  setBaseSystem(db, "WHISH");
  seedTransferDebt(db, { clientId: 7, provider: "WHISH", usd: 20 });
  seedTransferDebt(db, { clientId: 7, provider: "OMT", usd: 10 });
  const items = new DebtRepository().findOpenDebtItems(7);
  expect(items.map((i) => [i.openUsd, i.primaryDrawer])).toEqual([
    [20, "Whish_System"],
    [10, null],
  ]);
});
