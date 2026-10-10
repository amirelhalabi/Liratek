/**
 * LIRA-304 T047 — basket checkout cash split, OMT first (owner decision
 * 2026-10-10): the cash pays the primary-system transfers first; change
 * comes out of General. Failing-first (rule 17): on the by-share code the
 * $50 case books ≈ $43.91 to OMT_System and ≈ $6.09 to General.
 */
import type Database from "better-sqlite3";
import {
  installDebtItemTestDb,
  uninstallDebtItemTestDb,
  addClient,
  seedBasketMembers,
  setBaseSystem,
  drawers,
  drawerDelta,
  RATE,
} from "../testHelpers/debtItemDb";
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

function checkout(
  items: Parameters<typeof seedBasketMembers>[2],
  legs: Array<{
    method: string;
    currencyCode: string;
    amount: number;
    direction?: "IN" | "OUT";
  }>,
) {
  const basket = seedBasketMembers(db, 7, items);
  const before = drawers(db);
  getSessionPaymentService().recordBasketPayment(basket.sessionId, {
    legs,
    exchangeRate: RATE,
    userId: 1,
    clientId: 7,
  });
  return drawerDelta(before, drawers(db));
}

it("$50 cash + $65 on account: all $50 to the OMT drawer", () => {
  expect(
    checkout(
      [
        { kind: "transfer", provider: "OMT", usd: 101 },
        { kind: "sale", usd: 14 },
      ],
      [
        { method: "CASH", currencyCode: "USD", amount: 50 },
        { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 65 },
      ],
    ),
  ).toEqual({ "OMT_System|USD": 50 });
});

it("full cash: OMT drawer gets exactly the transfer", () => {
  expect(
    checkout(
      [
        { kind: "transfer", provider: "OMT", usd: 101 },
        { kind: "sale", usd: 33 },
      ],
      [{ method: "CASH", currencyCode: "USD", amount: 134 }],
    ),
  ).toEqual({ "OMT_System|USD": 101, "General|USD": 33 });
});

it("overpaid with change: change comes out of General, the OMT drawer gets its $101", () => {
  expect(
    checkout(
      [
        { kind: "transfer", provider: "OMT", usd: 101 },
        { kind: "sale", usd: 14 },
      ],
      [
        { method: "CASH", currencyCode: "USD", amount: 150 },
        { method: "CASH", currencyCode: "USD", amount: 35, direction: "OUT" },
      ],
    ),
  ).toEqual({ "OMT_System|USD": 101, "General|USD": 14 });
});

it("Whish-primary shop: the Whish transfer's cash goes to Whish_System first", () => {
  setBaseSystem(db, "WHISH");
  expect(
    checkout(
      [
        { kind: "transfer", provider: "WHISH", usd: 50 },
        { kind: "sale", usd: 14 },
      ],
      [{ method: "CASH", currencyCode: "USD", amount: 30 }],
    ),
  ).toEqual({ "Whish_System|USD": 30 });
});
