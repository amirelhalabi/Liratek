/**
 * Phase 5 (POSTING_INTEGRITY_PLAN.md §7) — the Recharge & carrier family
 * (POSTING_MAP.md §4.3, plus the top-up / self-charge / cash-out rows of
 * §4.2) checked against the posting rules table (constants/postingRules.ts).
 *
 * Each case drives the REAL writer against the REAL schema
 * (`electron-app/create_db.sql`, fresh in-memory DB per case), then:
 *   1. exactly one transaction of the expected type was written;
 *   2. every ledger moved exactly as its rule says (`expectPostingsMatchRule`
 *      — a ledger the rule marks `none` must not move at all);
 *   3. the shop's carrier lines moved by exactly what the carrier drawer
 *      moved (drawer == Σ line credits, LIRA-252). Carrier lines are not one
 *      of the four snapshot ledgers, so this is checked here, beside the rule;
 *   4. reversal (rule 20): a reversible type is voided and every ledger plus
 *      the line credits net back to 0, per currency. A type in
 *      NON_REVERSIBLE_TRANSACTION_TYPES must refuse the void, change nothing,
 *      and be corrected by its documented owner (an opposite edit).
 *
 * CHARACTERIZATION, not failing-first (rule 17): these pin what today's code
 * does against what the map says. No fix is involved, and none was seen
 * failing before it passed.
 *
 * Amounts the rules cannot compute themselves (the SMS fee, the OMT App
 * cash-out commission) are taken from the same helpers / return values the
 * code uses — never hand-typed (rule 24).
 */
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import { RechargeRepository, type RechargeData } from "../RechargeRepository";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import {
  getCarrierLineRepository,
  resetCarrierLineRepository,
} from "../CarrierLineRepository";
import { resetCarrierLineMovementRepository } from "../CarrierLineMovementRepository";
import { resetCarrierLineOwedDeliveryRepository } from "../CarrierLineOwedDeliveryRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetExpenseRepository } from "../ExpenseRepository";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { resetVoucherRepository } from "../VoucherRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { resetMobileServiceItemRepository } from "../MobileServiceItemRepository";
import { resetClientRepository } from "../ClientRepository";
import { resetDebtService } from "../../services/DebtService";
import { resetCarrierLineService } from "../../services/CarrierLineService";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { planSmsTransfer } from "../../utils/telecomCredit";
import { omtAppCashoutCommission } from "../../constants/omtAppCashout";
import { NON_REVERSIBLE_TRANSACTION_TYPES } from "../../constants/transactionTypes";
import {
  POSTING_RULES,
  type PostingInputs,
  type PostingRuleKey,
} from "../../constants/postingRules";
import {
  snapshotLedgers,
  ledgerDeltas,
  expectPostings,
  expectPostingsMatchRule,
  type PostingRoleKeys,
} from "../testHelpers/postingAssert";

const SCHEMA = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "..",
    "electron-app",
    "create_db.sql",
  ),
  "utf-8",
);

type G = { __LIRATEK_TEST_DB__?: Database.Database };
let db: Database.Database;
let TODAY = "";

const CLIENT_ID = 1;
const SHOP_MTC = "03123456";
const LINE_CREDITS = 500;

function resetSingletons(): void {
  resetTransactionRepository();
  resetDebtRepository();
  resetDebtService();
  resetExpenseRepository();
  resetSupplierRepository();
  resetPartnerRepository();
  resetVoucherRepository();
  resetPaymentMethodRepository();
  resetMobileServiceItemRepository();
  resetClientRepository();
  resetCarrierLineRepository();
  resetCarrierLineMovementRepository();
  resetCarrierLineOwedDeliveryRepository();
  resetCarrierLineService();
}

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(SCHEMA);
  db.pragma("foreign_keys = OFF");
  (globalThis as G).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  resetSingletons();
  TODAY = (
    db.prepare(`SELECT date('now','localtime') AS d`).get() as { d: string }
  ).d;

  const seed = db.prepare(
    `INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, ?, ?, ?)`,
  );
  for (const [d, c, b] of [
    // Carrier drawers EQUAL Σ their line credits, so the buy-back's
    // drift-correction leg stays 0 (see the buy-back rule's note).
    ["MTC", "USD", LINE_CREDITS],
    ["Alfa", "USD", LINE_CREDITS],
    ["General", "USD", 5000],
    ["General", "LBP", 500_000_000],
    ["OMT_App", "USD", 1000],
    ["OMT_App", "LBP", 50_000_000],
    ["iPick", "LBP", 50_000_000],
  ] as const)
    seed.run(d, c, b);

  const line = db.prepare(
    `INSERT INTO carrier_lines (tenant_id, carrier, phone_number, label, credits, validity_expires_at, is_active, is_primary)
     VALUES (1, ?, ?, ?, ?, '2099-01-01', 1, 1)`,
  );
  line.run("mtc", SHOP_MTC, "Shop MTC", LINE_CREDITS);
  line.run("alfa", "71123456", "Shop Alfa", LINE_CREDITS);

  db.prepare(
    `INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (?, 1, 'Posting Client', '70111222')`,
  ).run(CLIENT_ID);
});

afterEach(() => {
  resetTenantContext();
  resetSingletons();
  delete (globalThis as G).__LIRATEK_TEST_DB__;
  db.close();
});

// ─── helpers ────────────────────────────────────────────────────────────────

function seedPartner(): number {
  return Number(
    db
      .prepare(
        `INSERT INTO partners (tenant_id, name, is_active) VALUES (1, 'Posting Partner', 1)`,
      )
      .run().lastInsertRowid,
  );
}

function supplierId(provider: string): number {
  const row = db
    .prepare(`SELECT id FROM suppliers WHERE provider = ? AND tenant_id = 1`)
    .get(provider) as { id: number } | undefined;
  if (!row) throw new Error(`no supplier for provider ${provider}`);
  return row.id;
}

function seedSelfChargeItem(): number {
  return Number(
    db
      .prepare(
        `INSERT INTO mobile_service_items (tenant_id, provider, category, subcategory, label, cost_lbp, sell_lbp, credits, validity_days)
         VALUES (1, 'iPick', 'mtc', 'Prepaid', 'MTC $4.5 card', 400000, 450000, 4.5, 30)`,
      )
      .run().lastInsertRowid,
  );
}

/** Σ active line credits per carrier drawer name. */
function lineCredits(): Record<"MTC" | "Alfa", number> {
  const sum = (carrier: string) =>
    (
      db
        .prepare(
          `SELECT COALESCE(SUM(credits), 0) AS s FROM carrier_lines WHERE carrier = ? AND is_active = 1`,
        )
        .get(carrier) as { s: number }
    ).s;
  return { MTC: sum("mtc"), Alfa: sum("alfa") };
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

function recharge(data: Partial<RechargeData>): void {
  const res = new RechargeRepository().processRecharge({
    userId: 1,
    client_day: TODAY,
    ...data,
  } as RechargeData);
  if (!res.success) throw new Error(`processRecharge failed: ${res.error}`);
}

function ok(res: { success: boolean; error?: string }): void {
  if (!res.success) throw new Error(res.error);
}

// ─── cases ──────────────────────────────────────────────────────────────────

interface Case {
  name: string;
  rule: PostingRuleKey;
  /** Runs the writer; returns inputs that depend on its result, if any. */
  act: (ctx: { partnerId: number }) => Partial<PostingInputs> | void;
  inputs: PostingInputs;
  keys: (ctx: { partnerId: number }) => PostingRoleKeys;
}

const sms = (faceUsd: number) => planSmsTransfer(faceUsd).feeUsd;

const cases: Case[] = [
  // ── RECHARGE — §4.3 ──
  {
    name: "walk-in MTC credit transfer, LBP cash",
    rule: "RECHARGE/sale/walk-in",
    act: () =>
      recharge({
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        amount: 3,
        cost: 255_000,
        price: 300_000,
        currency: "LBP",
        phoneNumber: "03999001",
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 300_000 }],
      }),
    inputs: {
      x: 300_000,
      f: 0,
      c: 0,
      currency: "LBP",
      carrierUsd: 3,
      smsUsd: sms(3),
    },
    keys: () => ({ drawers: { tender: "General", carrier: "MTC" } }),
  },
  {
    name: "walk-in MTC credit transfer, USD cash",
    rule: "RECHARGE/sale/walk-in",
    act: () =>
      recharge({
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        amount: 5,
        cost: 4.5,
        price: 6,
        currency: "USD",
        phoneNumber: "03999001",
        payments: [{ method: "CASH", currencyCode: "USD", amount: 6 }],
      }),
    inputs: {
      x: 6,
      f: 0,
      c: 0,
      currency: "USD",
      carrierUsd: 5,
      smsUsd: sms(5),
    },
    keys: () => ({ drawers: { tender: "General", carrier: "MTC" } }),
  },
  {
    name: "walk-in Alfa voucher (no SMS fee), USD cash",
    rule: "RECHARGE/sale/walk-in",
    act: () =>
      recharge({
        provider: "Alfa",
        type: "VOUCHER",
        amount: 10,
        cost: 9,
        price: 11,
        currency: "USD",
        phoneNumber: "71999001",
        payments: [{ method: "CASH", currencyCode: "USD", amount: 11 }],
      }),
    inputs: { x: 11, f: 0, c: 0, currency: "USD", carrierUsd: 10, smsUsd: 0 },
    keys: () => ({ drawers: { tender: "General", carrier: "Alfa" } }),
  },
  {
    name: "customer account, LBP",
    rule: "RECHARGE/sale/account",
    act: () =>
      recharge({
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        amount: 3,
        cost: 255_000,
        price: 300_000,
        currency: "LBP",
        phoneNumber: "03999001",
        clientId: CLIENT_ID,
        payments: [
          { method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 300_000 },
        ],
      }),
    inputs: {
      x: 300_000,
      f: 0,
      c: 0,
      currency: "LBP",
      carrierUsd: 3,
      smsUsd: sms(3),
    },
    keys: () => ({ drawers: { carrier: "MTC" }, clientId: CLIENT_ID }),
  },
  {
    name: "customer account, USD",
    rule: "RECHARGE/sale/account",
    act: () =>
      recharge({
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        amount: 5,
        cost: 4.5,
        price: 6,
        currency: "USD",
        phoneNumber: "03999001",
        clientId: CLIENT_ID,
        payments: [
          { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 6 },
        ],
      }),
    inputs: {
      x: 6,
      f: 0,
      c: 0,
      currency: "USD",
      carrierUsd: 5,
      smsUsd: sms(5),
    },
    keys: () => ({ drawers: { carrier: "MTC" }, clientId: CLIENT_ID }),
  },
  {
    name: "FOR partner, USD",
    rule: "RECHARGE/sale/FOR",
    act: ({ partnerId }) =>
      recharge({
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        amount: 5,
        cost: 4.5,
        price: 6,
        currency: "USD",
        phoneNumber: "03999001",
        payments: [],
        partnerId,
        partnerMode: "FOR",
      }),
    inputs: {
      x: 6,
      f: 0,
      c: 0,
      currency: "USD",
      carrierUsd: 5,
      smsUsd: sms(5),
    },
    keys: ({ partnerId }) => ({ drawers: { carrier: "MTC" }, partnerId }),
  },
  {
    name: "session basket (deferPayment), USD",
    rule: "RECHARGE/sale/basket",
    act: () =>
      recharge({
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        amount: 5,
        cost: 4.5,
        price: 6,
        currency: "USD",
        phoneNumber: "03999001",
        deferPayment: true,
      }),
    inputs: {
      x: 6,
      f: 0,
      c: 0,
      currency: "USD",
      carrierUsd: 5,
      smsUsd: sms(5),
    },
    keys: () => ({ drawers: { carrier: "MTC" } }),
  },
  {
    name: "DAYS sale, Alfa, USD cash",
    rule: "RECHARGE/DAYS/walk-in",
    act: () =>
      recharge({
        provider: "Alfa",
        type: "DAYS",
        amount: 30, // days
        cost: 0.9, // USD days cost — what leaves the drawer
        price: 2,
        currency: "USD",
        phoneNumber: "71999001",
        payments: [{ method: "CASH", currencyCode: "USD", amount: 2 }],
      }),
    inputs: { x: 2, f: 0, c: 0, currency: "USD", carrierUsd: 0.9 },
    keys: () => ({ drawers: { tender: "General", carrier: "Alfa" } }),
  },

  // ── TELECOM_CREDIT_BUYBACK — §4.3 ──
  {
    name: "credit buy-back, USD cash payout",
    rule: "TELECOM_CREDIT_BUYBACK/cash",
    act: () =>
      recharge({
        provider: "MTC",
        type: "CREDIT_BUYBACK",
        amount: 10,
        cost: 0,
        price: 8,
        currency: "USD",
        phoneNumber: SHOP_MTC,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 8 }],
      }),
    inputs: { x: 8, f: 0, c: 0, currency: "USD", carrierUsd: 10 },
    keys: () => ({ drawers: { tender: "General", carrier: "MTC" } }),
  },
  {
    name: "credit buy-back, LBP cash payout",
    rule: "TELECOM_CREDIT_BUYBACK/cash",
    act: () =>
      recharge({
        provider: "MTC",
        type: "CREDIT_BUYBACK",
        amount: 10,
        cost: 0,
        price: 700_000,
        currency: "LBP",
        phoneNumber: SHOP_MTC,
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 700_000 }],
      }),
    inputs: { x: 700_000, f: 0, c: 0, currency: "LBP", carrierUsd: 10 },
    keys: () => ({ drawers: { tender: "General", carrier: "MTC" } }),
  },
  {
    name: "credit buy-back, paid to the customer account",
    rule: "TELECOM_CREDIT_BUYBACK/account",
    act: () =>
      recharge({
        provider: "MTC",
        type: "CREDIT_BUYBACK",
        amount: 10,
        cost: 0,
        price: 8,
        currency: "USD",
        phoneNumber: SHOP_MTC,
        clientId: CLIENT_ID,
        payments: [
          { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 8 },
        ],
      }),
    inputs: { x: 8, f: 0, c: 0, currency: "USD", carrierUsd: 10 },
    keys: () => ({ drawers: { carrier: "MTC" }, clientId: CLIENT_ID }),
  },

  // ── TELECOM_SELF_CHARGE — §4.2 ──
  {
    name: "self-charge an iPick MTC card to the shop line",
    rule: "TELECOM_SELF_CHARGE/catalog",
    act: () => {
      new FinancialServiceRepository().selfChargeTelecomItem({
        mobileServiceItemId: seedSelfChargeItem(),
        userId: 1,
        client_day: TODAY,
      });
    },
    inputs: { x: 400_000, f: 0, c: 0, currency: "LBP", carrierUsd: 4.5 },
    keys: () => ({ drawers: { wallet: "iPick", carrier: "MTC" } }),
  },

  // ── RECHARGE_TOPUP — one rule per writer ──
  {
    name: "topUpApp: OMT App from General, USD",
    rule: "RECHARGE_TOPUP/app",
    act: () =>
      ok(
        new RechargeRepository().topUpApp({
          provider: "OMT_APP",
          amount: 100,
          currency: "USD",
          sourceDrawer: "General",
          userId: 1,
        }),
      ),
    inputs: { x: 100, f: 0, c: 0, currency: "USD" },
    keys: () => ({ drawers: { source: "General", wallet: "OMT_App" } }),
  },
  {
    name: "topUpApp: Whish App from General, LBP",
    rule: "RECHARGE_TOPUP/app",
    act: () =>
      ok(
        new RechargeRepository().topUpApp({
          provider: "WHISH_APP",
          amount: 1_000_000,
          currency: "LBP",
          sourceDrawer: "General",
          userId: 1,
        }),
      ),
    inputs: { x: 1_000_000, f: 0, c: 0, currency: "LBP" },
    keys: () => ({ drawers: { source: "General", wallet: "Whish_App" } }),
  },
  {
    name: "topUpFromSupplier: iPick, LBP",
    rule: "RECHARGE_TOPUP/supplier",
    act: () =>
      ok(
        new RechargeRepository().topUpFromSupplier({
          provider: "iPick",
          amount: 2_000_000,
          currency: "LBP",
          userId: 1,
        }),
      ),
    inputs: { x: 2_000_000, f: 0, c: 0, currency: "LBP" },
    keys: () => ({
      drawers: { wallet: "iPick" },
      providerSupplierId: supplierId("iPick"),
    }),
  },
  {
    name: "topUpFromSupplier: OMT App, USD",
    rule: "RECHARGE_TOPUP/supplier",
    act: () =>
      ok(
        new RechargeRepository().topUpFromSupplier({
          provider: "OMT_APP",
          amount: 100,
          currency: "USD",
          userId: 1,
        }),
      ),
    inputs: { x: 100, f: 0, c: 0, currency: "USD" },
    keys: () => ({
      drawers: { wallet: "OMT_App" },
      providerSupplierId: supplierId("OMT_APP"),
    }),
  },
  {
    name: "topUpFromPartner: Whish App, USD",
    rule: "RECHARGE_TOPUP/partner",
    act: ({ partnerId }) =>
      ok(
        new RechargeRepository().topUpFromPartner({
          provider: "WHISH_APP",
          partnerId,
          amount: 50,
          currency: "USD",
          userId: 1,
        }),
      ),
    inputs: { x: 50, f: 0, c: 0, currency: "USD" },
    keys: ({ partnerId }) => ({ drawers: { wallet: "Whish_App" }, partnerId }),
  },
  {
    name: "topUpFromClient: Whish App credits bought for cash, USD",
    rule: "RECHARGE_TOPUP/client",
    act: () =>
      ok(
        new RechargeRepository().topUpFromClient({
          amount: 100,
          fee: 5,
          currency: "USD",
          payments: [{ method: "CASH", currencyCode: "USD", amount: 95 }],
          clientId: CLIENT_ID,
          userId: 1,
        }),
      ),
    inputs: { x: 100, f: 5, c: 0, currency: "USD" },
    keys: () => ({ drawers: { tender: "General", wallet: "Whish_App" } }),
  },

  // ── WALLET_CASHOUT — §4.2 ──
  ...(["USD", "LBP"] as const).map((currency): Case => {
    const x = currency === "USD" ? 100 : 1_000_000;
    return {
      name: `cashoutToSupplier: OMT App, ${currency}`,
      rule: "WALLET_CASHOUT/OMT_APP",
      act: () => {
        const res = new RechargeRepository().cashoutToSupplier({
          provider: "OMT_APP",
          amount: x,
          currency,
          userId: 1,
        });
        ok(res);
        // The repository's own commission must be the shared helper's.
        expect(res.commission).toBe(omtAppCashoutCommission(x, currency));
        return { c: res.commission };
      },
      inputs: { x, f: 0, c: Number.NaN, currency },
      keys: () => ({
        drawers: { wallet: "OMT_App" },
        providerSupplierId: supplierId("OMT_APP"),
      }),
    };
  }),
];

describe("Recharge & carrier — postings match POSTING_RULES (characterization)", () => {
  for (const c of cases) {
    it(`${c.name}: posts exactly ${c.rule}; void nets every ledger to 0`, () => {
      const rule = POSTING_RULES[c.rule];
      const partnerId = seedPartner();
      const ctx = { partnerId };
      const before = snapshotLedgers(db);
      const linesBefore = lineCredits();

      const late = c.act(ctx) ?? {};
      const inputs = { ...c.inputs, ...late };
      expect(Number.isNaN(inputs.c)).toBe(false);

      // 1. Exactly one transaction of the rule's type (fresh DB per case).
      const rows = db
        .prepare(
          `SELECT id FROM transactions WHERE type = ? AND status = 'ACTIVE'`,
        )
        .all(rule.transactionType) as { id: number }[];
      expect(rows).toHaveLength(1);
      const txnId = rows[0].id;

      // 2. Every ledger, full delta, from the table.
      const after = snapshotLedgers(db);
      expectPostingsMatchRule(rule, before, after, inputs, c.keys(ctx));

      // 3. Lines moved by exactly what the carrier drawer moved.
      const drawerDelta = ledgerDeltas(before, after).drawers;
      const linesAfter = lineCredits();
      for (const carrier of ["MTC", "Alfa"] as const) {
        expect({
          carrier,
          line: r6(linesAfter[carrier] - linesBefore[carrier]),
        }).toEqual({ carrier, line: drawerDelta[`${carrier}|USD`] ?? 0 });
      }

      // 4. Reversal (rule 20): every type here is reversible.
      expect(NON_REVERSIBLE_TRANSACTION_TYPES.has(rule.transactionType)).toBe(
        false,
      );
      getTransactionRepository().voidTransaction(txnId, 1);
      expectPostings(before, snapshotLedgers(db), {});
      expect(lineCredits()).toEqual(linesBefore);
    });
  }
});

// ─── CARRIER_LINE_ADJUSTMENT — non-reversible by design ─────────────────────

describe("CARRIER_LINE_ADJUSTMENT — postings match POSTING_RULES (characterization)", () => {
  const rule = POSTING_RULES["CARRIER_LINE_ADJUSTMENT/manual"];

  function onlyAdjustment(): number {
    const rows = db
      .prepare(`SELECT id FROM transactions WHERE type = ? ORDER BY id`)
      .all(rule.transactionType) as { id: number }[];
    expect(rows).toHaveLength(1);
    return rows[0].id;
  }

  /**
   * Forward rule, then: the void is refused and changes nothing; the
   * documented owner (an opposite edit, which posts its own adjustment)
   * brings every ledger back to 0.
   */
  function check(
    edit: () => void,
    undo: () => void,
    carrierUsd: number,
    drawer: "MTC" | "Alfa",
  ): void {
    const before = snapshotLedgers(db);
    const linesBefore = lineCredits();

    edit();
    const txnId = onlyAdjustment();
    const after = snapshotLedgers(db);
    expectPostingsMatchRule(
      rule,
      before,
      after,
      { x: carrierUsd, f: 0, c: 0, currency: "USD", carrierUsd },
      { drawers: { carrier: drawer } },
    );
    expect(r6(lineCredits()[drawer] - linesBefore[drawer])).toBe(carrierUsd);

    expect(NON_REVERSIBLE_TRANSACTION_TYPES.has(rule.transactionType)).toBe(
      true,
    );
    expect(() =>
      getTransactionRepository().voidTransaction(txnId, 1),
    ).toThrow();
    expectPostings(after, snapshotLedgers(db), {});

    undo();
    expectPostings(before, snapshotLedgers(db), {});
    expect(lineCredits()).toEqual(linesBefore);
  }

  it("a new Alfa line with credits posts +credits to the Alfa drawer", () => {
    let newId = 0;
    check(
      () => {
        newId = getCarrierLineRepository().createLine(
          { carrier: "alfa", phone_number: "71000999", credits: 20 },
          1,
        ).id;
      },
      () => {
        getCarrierLineRepository().updateBalance(newId, { credits: 0 }, 1);
      },
      20,
      "Alfa",
    );
  });

  it("a quick-update lowering the MTC line posts −delta to the MTC drawer", () => {
    const mtcId = (
      db
        .prepare(`SELECT id FROM carrier_lines WHERE phone_number = ?`)
        .get(SHOP_MTC) as { id: number }
    ).id;
    check(
      () => {
        getCarrierLineRepository().updateBalance(
          mtcId,
          { credits: LINE_CREDITS - 10 },
          1,
        );
      },
      () => {
        getCarrierLineRepository().updateBalance(
          mtcId,
          { credits: LINE_CREDITS },
          1,
        );
      },
      -10,
      "MTC",
    );
  });
});

// ─── topUpApp refuses MTC/Alfa (POSTING_MAP §4.3 row, G15) ──────────────────

describe("topUpApp into a carrier drawer is refused and posts nothing (characterization)", () => {
  for (const provider of ["MTC", "Alfa"] as const) {
    it(`${provider}: success false, no ledger moves, no RECHARGE_TOPUP row`, () => {
      const before = snapshotLedgers(db);
      const linesBefore = lineCredits();
      const res = new RechargeRepository().topUpApp({
        provider,
        amount: 10,
        currency: "USD",
        sourceDrawer: "General",
        userId: 1,
      });
      expect(res.success).toBe(false);
      expectPostings(before, snapshotLedgers(db), {});
      expect(lineCredits()).toEqual(linesBefore);
      expect(
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM transactions WHERE type = 'RECHARGE_TOPUP'`,
          )
          .get(),
      ).toEqual({ n: 0 });
    });
  }
});
