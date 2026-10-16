/**
 * LIRA-329 T022 — Mobile Recharge items paid through a customer-session
 * basket get the same details as when paid on their own, plus the session
 * that paid for them (`paid_in_session`), and carry the session customer's
 * name and phone on their own transaction.
 *
 * The phone is pinned in the hard case: a client with that phone is already
 * registered under a DIFFERENT name, so the session resolves to that client
 * and the transaction's client resolver (which only copies a phone under
 * the client's own name) cannot supply it — only the session can.
 *
 * Money: each item's amount is asserted first at today's values (FR-008).
 * Rule 17: run before the session injected anything and seen failing
 * (no `paid_in_session`, no phone on either row, no details on the Katsh
 * row); the amount assertions passed.
 *
 * Real schema: create_db.sql + migrations, wrong-number fixture lines.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  buildDb,
  resetAll as resetWrongNumberFixture,
  seed,
  type WrongNumberFixture,
} from "../../repositories/testHelpers/wrongNumberDb";
import { fundDrawer } from "../../repositories/testHelpers/omtAccountDb";
import {
  getCustomerSessionRepository,
  resetCustomerSessionRepository,
} from "../../repositories/CustomerSessionRepository";
import {
  getSessionCheckoutService,
  resetSessionCheckoutService,
  type CheckoutCartItem,
} from "../SessionCheckoutService";
import { resetSessionPaymentService } from "../SessionPaymentService";
import { resetSessionPaymentRepository } from "../../repositories/SessionPaymentRepository";
import { resetFinancialService } from "../FinancialService";
import { resetFinancialServiceRepository } from "../../repositories/FinancialServiceRepository";
import { resetRechargeService } from "../RechargeService";
import { resetRechargeRepository } from "../../repositories/RechargeRepository";
import { resetClientRepository } from "../../repositories/ClientRepository";
import { resetDebtService } from "../DebtService";
import { resetDebtRepository } from "../../repositories/DebtRepository";
import { resetSupplierRepository } from "../../repositories/SupplierRepository";
import { resetPartnerRepository } from "../../repositories/PartnerRepository";
import { resetSettingsRepository } from "../../repositories/SettingsRepository";

const DAY = "2026-10-16";

function resetAll(): void {
  resetWrongNumberFixture();
  resetCustomerSessionRepository();
  resetSessionCheckoutService();
  resetSessionPaymentService();
  resetSessionPaymentRepository();
  resetFinancialService();
  resetFinancialServiceRepository();
  resetRechargeService();
  resetRechargeRepository();
  resetClientRepository();
  resetDebtService();
  resetDebtRepository();
  resetSupplierRepository();
  resetPartnerRepository();
  resetSettingsRepository();
}

interface Row {
  amount_lbp: number;
  client_name: string | null;
  client_phone: string | null;
  metadata_json: string;
}

describe("LIRA-329 — session-basket Mobile Recharge items keep their details", () => {
  let db: Database.Database;
  let f: WrongNumberFixture;

  beforeEach(() => {
    resetAll();
    db = buildDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    f = seed(db);
    fundDrawer(db, "General", "LBP", 500_000_000);
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
    resetTenantContext();
    resetAll();
    db.close();
  });

  function row(sourceTable: string): Row {
    return db
      .prepare(
        `SELECT amount_lbp, client_name, client_phone, metadata_json
           FROM transactions WHERE source_table = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(sourceTable) as Row;
  }

  it("a recharge and a Katsh card in one basket: paid_in_session, the session customer's name and phone", async () => {
    // A client already holds this phone under another name.
    db.prepare(
      `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, 'R. Aziz (old)', '71222333')`,
    ).run();
    const sessionId = getCustomerSessionRepository().createSession({
      customer_name: "Rana Aziz",
      customer_phone: "71222333",
      started_by: "admin",
      user_id: 1,
    });

    const cartItems: CheckoutCartItem[] = [
      {
        id: "r1",
        module: "recharge_alfa",
        label: "Alfa Recharge - 03123456 - 300,000 LBP",
        amount: 300_000,
        currency: "LBP",
        ipcChannel: "recharge:process",
        formData: {
          provider: "Alfa",
          type: "CREDIT_TRANSFER",
          phoneNumber: "03123456",
          amount: 3,
          cost: 255_000,
          price: 300_000,
          currency: "LBP",
          client_day: DAY,
        },
      },
      {
        id: "k1",
        module: "katsh",
        label: "Katsh: PUBG 60 UC",
        amount: 100_000,
        currency: "LBP",
        ipcChannel: "financial:create",
        formData: {
          _batch: true,
          items: [
            {
              provider: "Katsh",
              serviceType: "SEND",
              amount: 100_000,
              cost: 80_000,
              currency: "LBP",
              commission: 20_000,
              itemKey: "pubg-60",
              itemCategory: "PUBG",
              note: "PUBG: 60 UC",
            },
          ],
        },
      },
    ];

    const result = await getSessionCheckoutService().checkout(
      {
        sessionId,
        cartItems,
        payments: [{ method: "CASH", currency_code: "LBP", amount: 400_000 }],
        exchangeRate: 89_500,
        userId: 1,
      },
      { username: "admin" },
    );
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);

    const recharge = row("recharges");
    const katsh = row("financial_services");
    // FR-008 — today's amounts (passed on the pre-change run).
    expect(recharge.amount_lbp).toBe(300_000);
    expect(katsh.amount_lbp).toBe(100_000);

    expect(JSON.parse(recharge.metadata_json).details).toMatchObject({
      kind: "telecom_recharge",
      carrier: "ALFA",
      type: "CREDIT_TRANSFER",
      phone: "03123456",
      carrierLineId: f.shopLineId,
      paid_in_session: sessionId,
    });
    expect(JSON.parse(katsh.metadata_json).details).toMatchObject({
      kind: "catalog_sale",
      provider: "Katsh",
      items: [{ key: "pubg-60", category: "PUBG", quantity: 1 }],
      paid_in_session: sessionId,
    });
    for (const r of [recharge, katsh]) {
      expect(JSON.parse(r.metadata_json).payment_snapshot).toEqual({
        lines: [],
        session_id: sessionId,
      });
      expect(r.client_phone).toBe("71222333");
    }
    // Names are today's: a recharge row shows the linked client's record
    // name (processRecharge re-reads it from client_id); a financial
    // service row shows the name the session typed.
    expect(recharge.client_name).toBe("R. Aziz (old)");
    expect(katsh.client_name).toBe("Rana Aziz");
  });
});
