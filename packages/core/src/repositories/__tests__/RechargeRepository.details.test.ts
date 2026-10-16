/**
 * LIRA-329 T016 / T020 / T022 — MTC / Alfa sales, credit buy-backs and
 * wallet top-ups keep every field the cashier entered on their own
 * transaction (User Story 2, Mobile Recharge).
 *
 * For each case: every field of the kind (`telecom_recharge`,
 * `telecom_buyback`, `wallet_topup`), the row's client name and phone, and —
 * where a customer paid or was paid — a `payment_snapshot` matching the legs.
 * The money columns are asserted FIRST, at the values today's code produces
 * (FR-008): those assertions passed on the pre-change run, which is what
 * proves the details do not move money.
 *
 * Rule 24: every expected details object is run through its kind's own
 * schema (`expectDetails`), so a field name the schema does not have fails
 * here instead of encoding a typo.
 *
 * Rule 17: written before the builders existed and run against the unfixed
 * repository — every details / client-phone / snapshot assertion failed
 * (details absent), the money assertions passed.
 *
 * Real schema: create_db.sql + migrations, with the wrong-number fixture's
 * shop lines (Alfa 03222875 primary, MTC 71000111 primary).
 */
import Database from "better-sqlite3";
import type { ZodTypeAny } from "zod";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { RechargeRepository } from "../RechargeRepository";
import {
  buildDb,
  resetAll,
  seed,
  type WrongNumberFixture,
} from "../testHelpers/wrongNumberDb";
import { fundDrawer } from "../testHelpers/omtAccountDb";
import { resetPartnerRepository } from "../PartnerRepository";
import { resetSupplierRepository } from "../SupplierRepository";
import {
  telecomBuybackDetailsSchema,
  telecomRechargeDetailsSchema,
  walletTopupDetailsSchema,
} from "../../validators/transactionDetails";
import {
  expectEverySnapshotMatchesPayments,
  isProviderBookkeepingRow,
} from "../testHelpers/paymentSnapshotAssert";

const DAY = "2026-10-16";

function isDrawerToDrawerTopUp(txn: { metadata: Record<string, unknown> }) {
  const details = txn.metadata.details as
    | { kind?: string; source?: string }
    | undefined;
  return details?.kind === "wallet_topup" && details.source === "DRAWER";
}

interface TxnRow {
  id: number;
  type: string;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  client_id: number | null;
  client_name: string | null;
  client_phone: string | null;
  metadata_json: string;
}

function lastTxn(db: Database.Database, type: string): TxnRow {
  return db
    .prepare(
      `SELECT id, type, amount_usd, amount_lbp, profit_usd, profit_lbp,
              client_id, client_name, client_phone, metadata_json
         FROM transactions WHERE type = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(type) as TxnRow;
}

function txnFor(db: Database.Database, rechargeId: number): TxnRow {
  return db
    .prepare(
      `SELECT id, type, amount_usd, amount_lbp, profit_usd, profit_lbp,
              client_id, client_name, client_phone, metadata_json
         FROM transactions
        WHERE source_table = 'recharges' AND source_id = ?`,
    )
    .get(rechargeId) as TxnRow;
}

function meta(row: TxnRow): Record<string, unknown> {
  return JSON.parse(row.metadata_json) as Record<string, unknown>;
}

/** Rule 24: the expected object must survive its own schema unchanged. */
function expectDetails(
  row: TxnRow,
  schema: ZodTypeAny,
  expected: Record<string, unknown>,
): void {
  expect(schema.parse(expected)).toEqual(expected);
  expect(meta(row).details).toEqual(expected);
}

describe("LIRA-329 — RechargeRepository: Mobile Recharge details", () => {
  let db: Database.Database;
  let f: WrongNumberFixture;
  let repo: RechargeRepository;

  beforeEach(() => {
    resetAll();
    resetPartnerRepository();
    resetSupplierRepository();
    db = buildDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    f = seed(db);
    fundDrawer(db, "General", "USD", 10_000);
    fundDrawer(db, "General", "LBP", 500_000_000);
    repo = new RechargeRepository();
  });

  // LIRA-329 T036 — every payment snapshot saved by a case above equals
  // the payments rows it booked (method, currency, amount, direction).
  afterEach(() => {
    // The carrier line / wallet balance and validity-days cost rows are
    // bookkeeping, not lines the customer paid or received.
    // A drawer-to-drawer top-up is the exception: its two drawer rows ARE
    // the lines it records (OUT of the source, IN to the wallet).
    expectEverySnapshotMatchesPayments(db, {
      excludeRow: (row, txn) =>
        isProviderBookkeepingRow(row) && !isDrawerToDrawerTopUp(txn),
    });
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  function sale(input: Parameters<RechargeRepository["processRecharge"]>[0]) {
    const result = repo.processRecharge({ userId: 1, ...input });
    if (!result.success) throw new Error(result.error);
    return txnFor(db, result.id as number);
  }

  it("Alfa credit sale on a picked line: details, client name + phone, payment lines with change", () => {
    const row = sale({
      provider: "Alfa",
      type: "CREDIT_TRANSFER",
      carrier_line_id: f.shopLineId,
      phoneNumber: "03123456",
      amount: 3,
      cost: 255_000,
      price: 300_000,
      default_price_to_client: 310_000,
      currency: "LBP",
      paid_by_method: "CASH",
      payments: [
        { method: "CASH", currencyCode: "LBP", amount: 400_000 },
        {
          method: "CASH",
          currencyCode: "LBP",
          amount: 100_000,
          direction: "OUT",
        },
      ],
      clientName: "Rami Haddad",
      clientPhone: "71111222",
      client_day: DAY,
    });

    // FR-008 — today's money for this input (passed on the pre-change run).
    expect(row).toMatchObject({
      amount_usd: 0,
      amount_lbp: 300_000,
      profit_usd: 0,
      profit_lbp: 45_000,
    });
    expect(meta(row)).toMatchObject({ provider: "Alfa", phone: "03123456" });

    expectDetails(row, telecomRechargeDetailsSchema, {
      v: 1,
      kind: "telecom_recharge",
      carrier: "ALFA",
      type: "CREDIT_TRANSFER",
      phone: "03123456",
      amount: 3,
      carrierLineId: f.shopLineId,
      defaultPrice: 310_000,
    });
    expect(row.client_name).toBe("Rami Haddad");
    expect(row.client_phone).toBe("71111222");
    expect(meta(row).payment_snapshot).toEqual({
      lines: [
        { method: "CASH", currency: "LBP", amount: 400_000, direction: "IN" },
        { method: "CASH", currency: "LBP", amount: 100_000, direction: "OUT" },
      ],
      change_returned: [{ method: "CASH", currency: "LBP", amount: 100_000 }],
    });
  });

  it("MTC Days: day count, the line, and cost and price as typed in USD", () => {
    const row = sale({
      provider: "MTC",
      type: "DAYS",
      amount: 30,
      cost: 445_000,
      price: 623_000,
      daysTypedUsd: { costUsd: 5, priceUsd: 7 },
      currency: "LBP",
      paid_by_method: "CASH",
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 623_000 }],
      client_day: DAY,
    });

    expect(row).toMatchObject({ amount_lbp: 623_000, profit_lbp: 178_000 });
    expectDetails(row, telecomRechargeDetailsSchema, {
      v: 1,
      kind: "telecom_recharge",
      carrier: "MTC",
      type: "DAYS",
      days: 30,
      carrierLineId: f.mtcShopLineId,
      typed: { costUsd: 5, priceUsd: 7 },
    });
    expect(row.client_name).toBeNull();
    expect(row.client_phone).toBeNull();
  });

  it("Alfa Gift: the tier picked and the discount as typed", () => {
    const row = sale({
      provider: "Alfa",
      type: "ALFA_GIFT",
      amount: 9,
      cost: 800_000,
      price: 900_000,
      discount: 50_000,
      giftTier: { key: "7GB", label: "7 GB" },
      currency: "LBP",
      paid_by_method: "CASH",
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 850_000 }],
      client_day: DAY,
    });

    expect(row).toMatchObject({ amount_lbp: 850_000, profit_lbp: 50_000 });
    expectDetails(row, telecomRechargeDetailsSchema, {
      v: 1,
      kind: "telecom_recharge",
      carrier: "ALFA",
      type: "ALFA_GIFT",
      amount: 9,
      carrierLineId: f.shopLineId,
      giftTier: { key: "7GB", label: "7 GB" },
      discount: { amount: 50_000, currency: "LBP" },
    });
    expect(meta(row).payment_snapshot).toEqual({
      lines: [
        { method: "CASH", currency: "LBP", amount: 850_000, direction: "IN" },
      ],
    });
  });

  it("For Partner: the partner by id, name and mode; no counter payment lines", () => {
    const partnerId = Number(
      db
        .prepare(
          `INSERT INTO partners (tenant_id, name, system_association) VALUES (1, 'Abu Ali', 'WHISH')`,
        )
        .run().lastInsertRowid,
    );
    const row = sale({
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      phoneNumber: "71555666",
      amount: 2,
      cost: 170_000,
      price: 200_000,
      currency: "LBP",
      partnerId,
      partnerMode: "FOR",
      client_day: DAY,
    });

    expect(row).toMatchObject({ amount_lbp: 200_000, profit_lbp: 30_000 });
    expect(row.client_name).toBe("Abu Ali [partner]");
    expectDetails(row, telecomRechargeDetailsSchema, {
      v: 1,
      kind: "telecom_recharge",
      carrier: "MTC",
      type: "CREDIT_TRANSFER",
      phone: "71555666",
      amount: 2,
      carrierLineId: f.mtcShopLineId,
      partner: { id: partnerId, name: "Abu Ali", mode: "FOR" },
    });
    expect(meta(row).payment_snapshot).toBeUndefined();
  });

  it("a session-basket item says it was paid in that session (no payment lines of its own)", () => {
    const row = sale({
      provider: "Alfa",
      type: "CREDIT_TRANSFER",
      phoneNumber: "03777888",
      amount: 1,
      cost: 85_000,
      price: 100_000,
      currency: "LBP",
      clientName: "Walk-in Joe",
      clientPhone: "70999000",
      deferPayment: true,
      paid_in_session: 42,
      client_day: DAY,
    });

    expect(row).toMatchObject({ amount_lbp: 100_000, profit_lbp: 15_000 });
    expect(meta(row).details).toMatchObject({
      kind: "telecom_recharge",
      paid_in_session: 42,
    });
    expect(meta(row).payment_snapshot).toEqual({ lines: [], session_id: 42 });
    expect(row.client_name).toBe("Walk-in Joe");
    expect(row.client_phone).toBe("70999000");
  });

  it("credit buy-back: carrier, credits, phone, payout method and line; payout lines", () => {
    const row = sale({
      provider: "Alfa",
      type: "CREDIT_BUYBACK",
      phoneNumber: "03222875",
      amount: 5,
      cost: 0,
      price: 400_000,
      currency: "LBP",
      paid_by_method: "CASH",
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 400_000 }],
      client_day: DAY,
    });

    expect(row.type).toBe("TELECOM_CREDIT_BUYBACK");
    expect(row).toMatchObject({ amount_lbp: 400_000 });
    expectDetails(row, telecomBuybackDetailsSchema, {
      v: 1,
      kind: "telecom_buyback",
      carrier: "ALFA",
      credits: 5,
      phone: "03222875",
      payoutMethod: "CASH",
      carrierLineId: f.shopLineId,
    });
    expect(meta(row).payment_snapshot).toEqual({
      lines: [
        { method: "CASH", currency: "LBP", amount: 400_000, direction: "OUT" },
      ],
    });
  });

  // Shop-day fix: a top-up's details also keep the amount, the currency and
  // the drawers it moved between; a drawer-to-drawer top-up keeps both
  // lines (OUT of the source drawer, IN to the wallet). Written before the
  // fix and seen failing (details had provider + source only, no snapshot).
  it("top-up from a drawer: provider, source, amount, the two drawers and both lines", () => {
    const result = repo.topUpApp({
      provider: "WHISH_APP",
      amount: 100,
      currency: "USD",
      sourceDrawer: "General",
      userId: 1,
    });
    expect(result.success).toBe(true);
    const row = lastTxn(db, "RECHARGE_TOPUP");
    expect(row).toMatchObject({ amount_usd: 100, profit_usd: 0 });
    expectDetails(row, walletTopupDetailsSchema, {
      v: 1,
      kind: "wallet_topup",
      provider: "WHISH_APP",
      source: "DRAWER",
      amount: 100,
      currency: "USD",
      sourceDrawer: "General",
      destDrawer: "Whish_App",
    });
    expect(meta(row).payment_snapshot).toEqual({
      lines: [
        { method: "General", currency: "USD", amount: 100, direction: "OUT" },
        { method: "Whish_App", currency: "USD", amount: 100, direction: "IN" },
      ],
    });
  });

  it("top-up from the supplier: provider, source, amount and the wallet credited (no lines: no shop cash moves)", () => {
    const result = repo.topUpFromSupplier({
      provider: "iPick",
      amount: 1_000_000,
      currency: "LBP",
      userId: 1,
    });
    expect(result.success).toBe(true);
    const row = lastTxn(db, "RECHARGE_TOPUP");
    expect(row).toMatchObject({ amount_lbp: 1_000_000 });
    expectDetails(row, walletTopupDetailsSchema, {
      v: 1,
      kind: "wallet_topup",
      provider: "iPick",
      source: "SUPPLIER",
      amount: 1_000_000,
      currency: "LBP",
      destDrawer: "iPick",
    });
    expect(meta(row).payment_snapshot).toBeUndefined();
  });

  it("cash out to OMT: provider, source and the commission as fee", () => {
    fundDrawer(db, "OMT_App", "USD", 1_000);
    const result = repo.cashoutToSupplier({
      provider: "OMT_APP",
      amount: 100,
      currency: "USD",
      userId: 1,
    });
    expect(result.success).toBe(true);
    const row = lastTxn(db, "WALLET_CASHOUT");
    expect(row).toMatchObject({ amount_usd: 100, profit_usd: 0 });
    expectDetails(row, walletTopupDetailsSchema, {
      v: 1,
      kind: "wallet_topup",
      provider: "OMT_APP",
      source: "SUPPLIER",
      fee: result.commission,
      amount: 100,
      currency: "USD",
      sourceDrawer: "OMT_App",
    });
    expect(meta(row).payment_snapshot).toBeUndefined();
  });

  it("top-up via a partner: the partner by id and name", () => {
    const partnerId = Number(
      db
        .prepare(
          `INSERT INTO partners (tenant_id, name, system_association) VALUES (1, 'Whish Partner', 'WHISH')`,
        )
        .run().lastInsertRowid,
    );
    const result = repo.topUpFromPartner({
      provider: "WHISH_APP",
      partnerId,
      amount: 50,
      currency: "USD",
      userId: 1,
    });
    expect(result.success).toBe(true);
    const row = lastTxn(db, "RECHARGE_TOPUP");
    expect(row).toMatchObject({ amount_usd: 50 });
    expectDetails(row, walletTopupDetailsSchema, {
      v: 1,
      kind: "wallet_topup",
      provider: "WHISH_APP",
      source: "PARTNER",
      partner: { id: partnerId, name: "Whish Partner", mode: "VIA" },
      amount: 50,
      currency: "USD",
      destDrawer: "Whish_App",
    });
    expect(meta(row).payment_snapshot).toBeUndefined();
  });

  it("Whish top-up from a client: fee, including-fees choice, client name + phone, payout lines", () => {
    const clientId = Number(
      db
        .prepare(
          `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, 'Nour Saleh', '76123123')`,
        )
        .run().lastInsertRowid,
    );
    const result = repo.topUpFromClient({
      amount: 100,
      currency: "USD",
      fee: 1,
      includingFees: true,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 99 }],
      clientId,
      userId: 1,
    });
    expect(result.success).toBe(true);
    const row = lastTxn(db, "RECHARGE_TOPUP");
    expect(row).toMatchObject({ amount_usd: 100, profit_usd: 1 });
    expectDetails(row, walletTopupDetailsSchema, {
      v: 1,
      kind: "wallet_topup",
      provider: "WHISH_APP",
      source: "CLIENT",
      fee: 1,
      includingFees: true,
      amount: 100,
      currency: "USD",
      destDrawer: "Whish_App",
    });
    expect(row.client_name).toBe("Nour Saleh");
    expect(row.client_phone).toBe("76123123");
    expect(meta(row).payment_snapshot).toEqual({
      lines: [
        { method: "CASH", currency: "USD", amount: 99, direction: "OUT" },
      ],
    });
  });
});
