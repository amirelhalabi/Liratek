/**
 * LIRA-339 T015 — a voucher redeemed at session checkout records the session
 * (`redeemed_session_id`, v224), so the Transactions "Vouchers" filter can find
 * the basket; restoring a redemption clears it with the other redeemed fields.
 */
import type Database from "better-sqlite3";
import {
  installVoucherSaleDb,
  uninstallVoucherSaleDb,
  OWNER,
  RATE,
} from "../testHelpers/voucherSaleDb";
import { seedBasketMembers } from "../testHelpers/debtItemDb";
import {
  getVoucherRepository,
  type RedeemVoucherParams,
} from "../VoucherRepository";
import {
  getSessionPaymentService,
  resetSessionPaymentService,
} from "../../services/SessionPaymentService";

let db: Database.Database;
beforeEach(() => {
  db = installVoucherSaleDb();
  resetSessionPaymentService();
});
afterEach(() => {
  resetSessionPaymentService();
  uninstallVoucherSaleDb(db);
});

function insertVoucher(code: string, amount = 20): number {
  return getVoucherRepository().createVoucher({
    code,
    client_id: OWNER,
    client_name: "Jane Owner",
    client_phone: "70111222",
    amount,
    currency_code: "USD",
    expiry_date: null,
    note: null,
    created_by: 1,
  }).id;
}

function sessionIdOf(id: number): number | null {
  return (
    db
      .prepare(`SELECT redeemed_session_id FROM vouchers WHERE id = ?`)
      .get(id) as { redeemed_session_id: number | null }
  ).redeemed_session_id;
}

describe("T015 — session redemption link", () => {
  it("session checkout with a GIFT_CARD leg stamps redeemed_session_id", () => {
    const id = insertVoucher("GIFT-SESS-0001", 14);
    const basket = seedBasketMembers(db, OWNER, [{ kind: "sale", usd: 14 }]);
    getSessionPaymentService().recordBasketPayment(basket.sessionId, {
      legs: [
        {
          method: "GIFT_CARD",
          currencyCode: "USD",
          amount: 14,
          voucherCode: "GIFT-SESS-0001",
        },
      ],
      exchangeRate: RATE,
      userId: 1,
      clientId: OWNER,
    });
    expect(getVoucherRepository().findById(id)?.status).toBe("redeemed");
    expect(sessionIdOf(id)).toBe(basket.sessionId);
  });

  it("restoreRedeemedByTransaction clears redeemed_session_id with the other redeemed fields", () => {
    const id = insertVoucher("GIFT-SESS-0002");
    const txnId = Number(
      db
        .prepare(
          `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp) VALUES (1, 'SALE', 'ACTIVE', 'sales', 1, 1, 20, 0)`,
        )
        .run().lastInsertRowid,
    );
    const params = {
      code: "GIFT-SESS-0002",
      context: "sale",
      transactionId: txnId,
      userId: 1,
      sessionId: 77,
    };
    getVoucherRepository().redeemByCode(params as RedeemVoucherParams);
    expect(sessionIdOf(id)).toBe(77);

    expect(getVoucherRepository().restoreRedeemedByTransaction(txnId)).toBe(1);
    expect(getVoucherRepository().findById(id)?.status).toBe("pending");
    expect(sessionIdOf(id)).toBeNull();
  });
});
