/**
 * LIRA-258 / G38 — does a single-item refund of a SESSION-LINKED sale miss the
 * item's share of the partner charge (G5) or of change kept as store credit
 * (G21)? `SalesRepository.refundSaleItem` reverses both for a standalone sale,
 * but refuses a session-linked one, which then goes through
 * `TransactionRepository.refundSessionBasketItem` (no counterparty step).
 *
 * Finding: neither shape can reach the session path, so there is nothing to
 * reverse there. These are UNREACHABILITY GUARDS, not failing-first fix tests
 * (rule 17): they pass on the current code and fail if a future change opens
 * the route without also wiring the counterparty shares.
 *
 *   1. A for-partner POS sale finished while a session is active is linked
 *      with `transaction_type = 'sale'`, which `resolveUnifiedTransactionId`
 *      does not map, so `unified_transaction_id` stays NULL. Session-linkage
 *      (`isTransactionSessionLinked`) and session-basket membership
 *      (`_planSessionItemRefund`) both key on `unified_transaction_id`, so the
 *      sale stays on the standalone `refundSaleItem` path, where G5/G21
 *      already apply. Same for a POS sale whose change was kept as credit.
 *   2. The session checkout itself refuses a for-partner sale (G6, pinned by
 *      `SalesRepository.completionGuards.test.ts` "G6 — ...").
 *   3. A session-checkout sale is `deferPayment`: it writes no change and no
 *      CREDIT_DEPOSIT linked to its own transaction. Change kept on account at
 *      basket checkout is a POOLED credit (session_id set, transaction_id
 *      NULL) owned by the basket. The session item refund hands back the
 *      item's VALUE (not a share of the gross tender, which would include the
 *      overpayment), so the pooled credit correctly stays — refunding every
 *      item returns exactly what the items cost and the customer keeps the
 *      overpayment as credit, never paid out twice.
 *
 * Real production schema (create_db.sql + migrations); nothing is mocked.
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
import {
  SalesRepository,
  resetSalesRepository,
  type SaleRequest,
} from "../SalesRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { resetStockBatchRepository } from "../StockBatchRepository";
import { resetProductUnitRepository } from "../ProductUnitRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetVoucherRepository } from "../VoucherRepository";
import {
  getCustomerSessionRepository,
  resetCustomerSessionRepository,
} from "../CustomerSessionRepository";
import { resetSessionPaymentRepository } from "../SessionPaymentRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { resetClientRepository } from "../ClientRepository";
import { resetSettingsRepository } from "../SettingsRepository";
import { resetRateRepository } from "../RateRepository";
import { resetDebtService } from "../../services/DebtService";
import {
  SessionPaymentService,
  resetSessionPaymentService,
} from "../../services/SessionPaymentService";
import { CustomerSessionService } from "../../services/CustomerSessionService";
import { expectPostings, snapshotLedgers } from "../testHelpers/postingAssert";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");
const USER_ID = 1;
const RATE = 89500;

function buildDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(db);
  runMigrations(db);
  return db;
}

function resetAll(): void {
  resetSalesRepository();
  resetTransactionRepository();
  resetPartnerRepository();
  resetStockBatchRepository();
  resetProductUnitRepository();
  resetDebtRepository();
  resetVoucherRepository();
  resetCustomerSessionRepository();
  resetSessionPaymentRepository();
  resetPaymentMethodRepository();
  resetClientRepository();
  resetSettingsRepository();
  resetRateRepository();
  resetDebtService();
  resetSessionPaymentService();
}

let seq = 0;
function addProduct(db: Database.Database): number {
  seq += 1;
  return Number(
    db
      .prepare(
        `INSERT INTO products (tenant_id, name, item_type, cost_price_usd, selling_price_usd, stock_quantity)
         VALUES (1, ?, 'Product', 4, 10, 10)`,
      )
      .run(`Product ${seq}`).lastInsertRowid,
  );
}

function addClient(db: Database.Database): number {
  seq += 1;
  return Number(
    db
      .prepare(
        `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, ?, ?)`,
      )
      .run(`Client ${seq}`, `03${200000 + seq}`).lastInsertRowid,
  );
}

function addPartner(db: Database.Database): number {
  seq += 1;
  return Number(
    db
      .prepare(`INSERT INTO partners (tenant_id, name) VALUES (1, ?)`)
      .run(`Partner ${seq}`).lastInsertRowid,
  );
}

/** Two $10 lines (products A and B), $20 total. */
function twoItemSale(
  a: number,
  b: number,
  extra: Partial<SaleRequest>,
): SaleRequest {
  return {
    client_id: null,
    items: [
      { product_id: a, quantity: 1, price: 10 },
      { product_id: b, quantity: 1, price: 10 },
    ],
    total_amount: 20,
    discount: 0,
    final_amount: 20,
    payment_usd: 0,
    payment_lbp: 0,
    exchange_rate: RATE,
    status: "completed",
    ...extra,
  };
}

function saleItemIds(db: Database.Database, saleId: number): number[] {
  return (
    db
      .prepare(`SELECT id FROM sale_items WHERE sale_id = ? ORDER BY id`)
      .all(saleId) as { id: number }[]
  ).map((r) => r.id);
}

function saleTxnId(db: Database.Database, saleId: number): number {
  return (
    db
      .prepare(
        `SELECT id FROM transactions WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE'`,
      )
      .get(saleId) as { id: number }
  ).id;
}

describe("LIRA-258 / G38 — session-linked sale item refund vs partner / change-credit shares", () => {
  let db: Database.Database;
  let repo: SalesRepository;
  let a: number;
  let b: number;
  let sessionId: number;

  beforeEach(() => {
    resetAll();
    db = buildDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    repo = new SalesRepository();
    a = addProduct(db);
    b = addProduct(db);
    sessionId = getCustomerSessionRepository().createSession({
      customer_name: "Walk-in",
      started_by: "admin",
    });
  });

  afterEach(() => {
    resetTenantContext();
    resetAll();
    delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
    db.close();
  });

  /** What the POS page does after a successful checkout while a session is
   *  active (`POS/index.tsx` handleCompleteSale → linkTransaction "sale"). */
  async function linkLikePos(saleId: number, amountUsd: number): Promise<void> {
    const res = await new CustomerSessionService().linkTransactionToSession(
      sessionId,
      "sale",
      saleId,
      amountUsd,
      0,
    );
    expect(res).toEqual({ success: true, linked: true });
  }

  describe("route 1 — POS checkout while a session is active stays on the standalone refund path", () => {
    it("for-partner sale: not session-linked, so refundSaleItem lowers the partner by the item's share and undo restores it", async () => {
      const partnerId = addPartner(db);
      const r = repo.processSale(
        twoItemSale(a, b, { partnerId, partnerMode: "FOR", payments: [] }),
        USER_ID,
      );
      expect(r.success).toBe(true);
      const saleId = r.id!;
      await linkLikePos(saleId, 20);

      const txnRepo = getTransactionRepository();
      const txnId = saleTxnId(db, saleId);
      expect(txnRepo.isTransactionSessionLinked(txnId)).toBe(false);
      // The session item-refund path does not accept it as a basket member.
      expect(() =>
        txnRepo.refundSessionBasketItem({
          sessionId,
          transactionId: txnId,
          saleItemId: saleItemIds(db, saleId)[0],
          quantity: 1,
          userId: USER_ID,
        }),
      ).toThrow(/is not a member of session basket/);

      const [itemA] = saleItemIds(db, saleId);
      const beforeRefund = snapshotLedgers(db);
      const refundTxnId = repo.refundSaleItem({
        saleId,
        saleItemId: itemA,
        refundQuantity: 1,
        userId: USER_ID,
      });
      expectPostings(beforeRefund, snapshotLedgers(db), {
        partner: { [`${partnerId}|USD`]: -10 },
      });

      const beforeUndo = snapshotLedgers(db);
      repo.undoSaleItemRefund({
        refundTransactionId: refundTxnId,
        userId: USER_ID,
      });
      expectPostings(beforeUndo, snapshotLedgers(db), {
        partner: { [`${partnerId}|USD`]: 10 },
      });
    });

    it("change kept as credit: not session-linked, so refundSaleItem cancels the item's share of that credit and undo restores it", async () => {
      const clientId = addClient(db);
      const r = repo.processSale(
        twoItemSale(a, b, {
          client_id: clientId,
          payments: [
            { method: "CASH", currency_code: "USD", amount: 30 },
            {
              method: "CUSTOMER_ACCOUNT",
              currency_code: "USD",
              amount: 10,
              direction: "OUT",
            },
          ],
        }),
        USER_ID,
      );
      expect(r.success).toBe(true);
      const saleId = r.id!;
      await linkLikePos(saleId, 20);
      expect(
        getTransactionRepository().isTransactionSessionLinked(
          saleTxnId(db, saleId),
        ),
      ).toBe(false);

      const [itemA] = saleItemIds(db, saleId);
      const beforeRefund = snapshotLedgers(db);
      const refundTxnId = repo.refundSaleItem({
        saleId,
        saleItemId: itemA,
        refundQuantity: 1,
        userId: USER_ID,
      });
      // Half the $30 tender back in cash, half the $10 credit cancelled.
      const afterRefund = snapshotLedgers(db);
      expectPostings(beforeRefund, afterRefund, {
        drawers: {
          [Object.keys(afterRefund.drawers).find(
            (k) =>
              k.endsWith("|USD") &&
              afterRefund.drawers[k] !== (beforeRefund.drawers[k] ?? 0),
          )!]: -15,
        },
        debt: { [`${clientId}|USD`]: 5 },
      });

      const beforeUndo = snapshotLedgers(db);
      repo.undoSaleItemRefund({
        refundTransactionId: refundTxnId,
        userId: USER_ID,
      });
      expectPostings(beforeUndo, snapshotLedgers(db), {
        drawers: Object.fromEntries(
          Object.entries(beforeRefund.drawers)
            .filter(([k, v]) => afterRefund.drawers[k] !== v)
            .map(([k]) => [k, 15]),
        ),
        debt: { [`${clientId}|USD`]: -5 },
      });
    });
  });

  describe("route 3 — a session-checkout sale carries no counterparty share of its own", () => {
    it("change kept on account at basket checkout is a pooled basket credit; one-by-one item refunds hand back item value only and leave it, undo re-takes the cash", () => {
      const clientId = addClient(db);
      const r = repo.processSale(
        twoItemSale(a, b, { client_id: clientId, deferPayment: true }),
        USER_ID,
      );
      expect(r.success).toBe(true);
      const saleId = r.id!;
      const txnId = saleTxnId(db, saleId);
      // How SessionCheckoutService links a cart item (unified id set).
      getCustomerSessionRepository().linkTransaction(
        sessionId,
        "sale",
        saleId,
        20,
        0,
        0,
        0,
        txnId,
      );
      // Customer hands $30 for a $20 basket and keeps $10 on account.
      const beforePay = snapshotLedgers(db);
      new SessionPaymentService().recordBasketPayment(sessionId, {
        legs: [
          { method: "CASH", currencyCode: "USD", amount: 30 },
          {
            method: "CUSTOMER_ACCOUNT",
            currencyCode: "USD",
            amount: 10,
            direction: "OUT",
          },
        ],
        exchangeRate: RATE,
        userId: USER_ID,
        clientId,
      });
      const afterPay = snapshotLedgers(db);
      const cashKey = Object.keys(afterPay.drawers).find(
        (k) => afterPay.drawers[k] !== (beforePay.drawers[k] ?? 0),
      )!;
      expectPostings(beforePay, afterPay, {
        drawers: { [cashKey]: 30 },
        debt: { [`${clientId}|USD`]: -10 },
      });

      // The sale itself owns no change credit (deferPayment writes no OUT
      // legs), so `_saleChangeCreditRows` has nothing to share out.
      expect(
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM debt_ledger WHERE transaction_id = ? AND transaction_type = 'CREDIT_DEPOSIT'`,
          )
          .get(txnId),
      ).toEqual({ n: 0 });

      const txnRepo = getTransactionRepository();
      const [itemA, itemB] = saleItemIds(db, saleId);

      const beforeA = snapshotLedgers(db);
      const resA = txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: txnId,
        saleItemId: itemA,
        quantity: 1,
        userId: USER_ID,
      });
      expectPostings(beforeA, snapshotLedgers(db), {
        drawers: { [cashKey]: -10 },
      });
      const metaA = JSON.parse(
        (
          db
            .prepare(`SELECT metadata_json FROM transactions WHERE id = ?`)
            .get(resA.refundTransactionId) as { metadata_json: string }
        ).metadata_json,
      ) as Record<string, unknown>;
      expect(metaA.creditReversalIds).toBeUndefined();
      expect(metaA.partnerReversals).toBeUndefined();

      const beforeB = snapshotLedgers(db);
      txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: txnId,
        saleItemId: itemB,
        quantity: 1,
        userId: USER_ID,
      });
      expectPostings(beforeB, snapshotLedgers(db), {
        drawers: { [cashKey]: -10 },
      });
      // Net from before payment: $10 cash kept by the shop = the $10 credit
      // the customer still holds. Overpayment never paid out twice.
      expectPostings(beforePay, snapshotLedgers(db), {
        drawers: { [cashKey]: 10 },
        debt: { [`${clientId}|USD`]: -10 },
      });

      const beforeUndo = snapshotLedgers(db);
      txnRepo.undoSessionBasketItemRefund({
        refundTransactionId: resA.refundTransactionId,
        userId: USER_ID,
      });
      expectPostings(beforeUndo, snapshotLedgers(db), {
        drawers: { [cashKey]: 10 },
      });
    });
  });
});
