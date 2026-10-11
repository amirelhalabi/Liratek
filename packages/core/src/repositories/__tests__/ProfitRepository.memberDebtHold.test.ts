/**
 * LIRA-304 T039 (spec US4, FR-015) — profit of an item sold on account is
 * released when THAT item is paid, including an item inside a session
 * basket. Before LIRA-304 every non-sale item of a basket stayed held until
 * the whole basket row was covered.
 *
 * Failing-first (rule 17): on the basket-level hold, paying the ticked item
 * in full leaves it pending while the other item is still open.
 */
import type Database from "better-sqlite3";
import {
  installDebtItemTestDb,
  uninstallDebtItemTestDb,
  addClient,
  seedBasketMembers,
  RATE,
} from "../testHelpers/debtItemDb";
import { DebtRepository, type CreateRepaymentData } from "../DebtRepository";
import { notDebtPending } from "../ProfitRepository";
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

const released = (txnId: number): boolean =>
  !!db
    .prepare(`SELECT 1 FROM transactions t WHERE t.id = ? AND ${notDebtPending("t.id")}`)
    .get(txnId);

function basketOnAccount() {
  const basket = seedBasketMembers(db, 7, [
    { kind: "transfer", provider: "WHISH_APP", usd: 30, profitUsd: 2 },
    { kind: "transfer", provider: "OMT_APP", usd: 20, profitUsd: 1 },
  ]);
  getSessionPaymentService().recordBasketPayment(basket.sessionId, {
    legs: [{ method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 50 }],
    exchangeRate: RATE,
    userId: 1,
    clientId: 7,
  });
  return basket;
}

function repay(usd: number, targets?: Array<{ kind: "member"; id: number }>) {
  new DebtRepository().addRepayment({
    client_id: 7,
    amount_usd: usd,
    amount_lbp: 0,
    created_by: 1,
    payments: [{ method: "CASH", currencyCode: "USD", amount: usd }],
    tender_exchange_rate: RATE,
    ...(targets ? { targets } : {}),
  } as CreateRepaymentData);
}

it("both items are held while the basket is unpaid", () => {
  const b = basketOnAccount();
  expect(released(b.members[0].txnId)).toBe(false);
  expect(released(b.members[1].txnId)).toBe(false);
});

it("paying the ticked item in full releases ITS profit only", () => {
  const b = basketOnAccount();
  repay(20, [{ kind: "member", id: b.members[1].cstId }]);
  expect(released(b.members[1].txnId)).toBe(true);
  expect(released(b.members[0].txnId)).toBe(false);
});

it("nothing ticked: items are paid oldest first and released one by one", () => {
  const b = basketOnAccount();
  repay(30);
  expect(released(b.members[0].txnId)).toBe(true);
  expect(released(b.members[1].txnId)).toBe(false);
  repay(20);
  expect(released(b.members[1].txnId)).toBe(true);
});
