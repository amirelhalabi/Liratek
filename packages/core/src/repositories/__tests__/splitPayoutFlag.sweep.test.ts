/**
 * LIRA-391 — split payout vs the single-method flag (FR-4 sweep, FR-7 refund
 * symmetry, rule 28d).
 *
 * The bug: a payout page remembers "the" method from a one-line sheet and
 * sends it as `cashoutMethod` NEXT TO split `payments[]`. Picking a client
 * seeds a Customer Account line, so the flag sticks at CUSTOMER_ACCOUNT, and
 * core branched on the flag before the legs: the whole payout went to the
 * customer's account and the other leg was never booked.
 *
 * Each REAL row builds the payload the way its screen builds it (the shared
 * core builders where the screen uses one — `buildWalletTransferPayload` for
 * OMT App / Whish App — otherwise the keys the screen's submit sends, read
 * from its source), with the split "Customer Account first, then Cash or
 * Whish" and the STALE flag the screen sends today. It is parsed through the
 * real core schema (rule 24) and run through the real service on a full DB
 * (create_db.sql + migrations). Assertions, per currency:
 *   - client ledger: a credit equal to the account line only;
 *   - the other line leaves its own drawer;
 *   - an unbalanced split is refused (proves `reconcileLegs` ran).
 *
 * THIN rows (flows with no lump flag routing money next to legs) assert the
 * lump-method keys their schema accepts, so a flag added later re-opens this
 * sweep; each names where it routes money and why it has no hole.
 *
 * Rule 17 — written and run on 2026-11-14 against the UNFIXED code (before
 * any core change): 12 failed / 16 passed. The recorded failures:
 *   - Binance Account $200 + Whish $328.06 and Account $200 + Cash $328.06
 *     (stale CUSTOMER_ACCOUNT): "Expected: -200, Received: -528.06" — the
 *     whole payout went to the account, the other leg was never booked;
 *   - Binance unbalanced split, and a single account line short of the
 *     payout: "Received function did not throw" (legs never reconciled);
 *   - OMT_APP / WHISH_APP Account $100 + Cash $200, WHISH_APP Account $100 +
 *     Whish $200: "Expected: -100, Received: -300";
 *   - OMT and WHISH system RECEIVE Account $100 + Cash $200:
 *     "Expected: -100, Received: -300";
 *   - WHISH system RECEIVE Whish $100 + Cash $200 (stale WHISH):
 *     ["Whish_App|USD", -100] expected, ["Whish_App|USD", -300] received —
 *     the whole payout left the wallet, the cash leg was dropped;
 *   - OMT system unbalanced split: "Received function did not throw";
 *   - FR-7 refund case: its forward booking failed first ("Expected: -200,
 *     Received: -528.06"); the refund-nets-to-0 half was never reached, so
 *     the symmetry itself is NOT proven failing-first (it is a guard).
 * Added later, each recorded honestly:
 *   - BOB RECEIVE (account flag + account leg): written after the first fix
 *     cut, run against it and FAILED ("Expected: -100, Received: 0") — the
 *     fence had reached the other-provider branch, which has no per-leg
 *     payout path; fixed by keeping the flag path there. A real
 *     failing-first guard for that regression.
 *   - iPick sale with a stale paidByMethod: written after the fix, passed;
 *     no hole expected (legs read first) — NOT proven failing-first.
 *   - THIN rows check schema keys only; their "legs first" routing notes
 *     come from reading the source (unverified by a run, rule 28c) except
 *     the iPick row above.
 * Passing before the fix (expected — no hole): the flag-absent Binance
 * control, the single full-payout account line, the round-up / kept-change
 * refusals on an all-account / all-wallet payout, the partner-order refusal
 * and every THIN row.
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
import { resetFinancialServiceRepository } from "../FinancialServiceRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetClientRepository } from "../ClientRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { resetExpenseRepository } from "../ExpenseRepository";
import { resetDebtService } from "../../services/DebtService";
import {
  getFinancialService,
  resetFinancialService,
} from "../../services/FinancialService";
import { findPartnerOrderRefusal } from "../../services/RechargePartnerOrderService";
import {
  createFinancialServiceSchema,
  type CreateFinancialServiceInput,
} from "../../validators/financial";
import { exchangeSubmitSchema } from "../../validators/exchange";
import { addRepaymentSchema } from "../../validators/debt";
import { sessionCheckoutSchema } from "../../validators/session";
import { saveMaintenanceJobSchema } from "../../validators/maintenance";
import { voucherCreateSchema } from "../../validators/voucher";
import { supplierSettleSchema } from "../../validators/supplier";
import { partnerSettleSchema } from "../../validators/partner";
import { lotoCashPrizeSchema, lotoSellSchema } from "../../validators/loto";
import { rechargePartnerOrderSchema } from "../../validators/rechargeBasket";
import {
  buildWalletTransferPayload,
  calculateOmtWhishAppFees,
} from "../../utils/walletTransfer";
import {
  ledgerDeltas,
  snapshotLedgers,
  expectPostings,
} from "../testHelpers/postingAssert";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL = fs.readFileSync(
  path.join(REPO_ROOT, "electron-app/create_db.sql"),
  "utf-8",
);

const RATE = 89_500;
const CLIENT_ID = 1;
const r2 = (n: number) => Math.round(n * 100) / 100;

let db: Database.Database;

function resetAll(): void {
  resetFinancialService();
  resetFinancialServiceRepository();
  resetTransactionRepository();
  resetSupplierRepository();
  resetPartnerRepository();
  resetDebtRepository();
  resetDebtService();
  resetClientRepository();
  resetPaymentMethodRepository();
  resetExpenseRepository();
}

beforeEach(() => {
  resetAll();
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  initDatabase(db);
  runMigrations(db);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  db.prepare(
    `INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (?, 1, 'Maysam Test', '70111222')`,
  ).run(CLIENT_ID);
  const seed = db.prepare(
    `INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, ?, ?, ?)`,
  );
  for (const [d, c, b] of [
    ["General", "USD", 10_000],
    ["General", "LBP", 900_000_000],
    ["OMT_System", "USD", 10_000],
    ["Whish_System", "USD", 10_000],
    ["OMT_App", "USD", 10_000],
    ["Whish_App", "USD", 10_000],
    ["Binance", "USDT", 10_000],
  ] as const)
    seed.run(d, c, b);
  db.prepare(
    `INSERT OR REPLACE INTO exchange_rates (tenant_id, to_code, market_rate, buy_rate, sell_rate, is_stronger) VALUES (1, 'LBP', ?, ?, ?, 1)`,
  ).run(RATE, RATE, RATE);
});

afterEach(() => {
  resetTenantContext();
  resetAll();
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

// ─── helpers ────────────────────────────────────────────────────────────────

type FsPayload = Partial<CreateFinancialServiceInput> & Record<string, unknown>;

/** Schema parse (rule 24) → the real service, as both transports do. */
function submit(p: FsPayload): number {
  const parsed = createFinancialServiceSchema.parse(p);
  const result = getFinancialService().addTransaction({
    exchangeRate: RATE,
    userId: 1,
    ...parsed,
  } as Parameters<ReturnType<typeof getFinancialService>["addTransaction"]>[0]);
  if (!result.success || !result.id) {
    throw new Error(result.error || "addTransaction failed");
  }
  return result.id;
}

function txnIdOf(fsId: number): number {
  return (
    db
      .prepare(
        `SELECT id FROM transactions WHERE source_table = 'financial_services' AND source_id = ? AND reverses_id IS NULL ORDER BY id LIMIT 1`,
      )
      .get(fsId) as { id: number }
  ).id;
}

interface Expect {
  /** Client ledger delta (USD): negative = the shop owes the client. */
  debtUsd: number;
  /** "drawer|currency" → delta the non-account leg must post. */
  drawer: Record<string, number>;
}

function expectSplit(p: FsPayload, e: Expect): number {
  const before = snapshotLedgers(db);
  const fsId = submit(p);
  const d = ledgerDeltas(before, snapshotLedgers(db));
  expect(r2(d.debt[`${CLIENT_ID}|USD`] ?? 0)).toBe(e.debtUsd);
  for (const [key, delta] of Object.entries(e.drawer)) {
    expect([key, r2(d.drawers[key] ?? 0)]).toEqual([key, delta]);
  }
  return fsId;
}

const L = (method: string, amount: number, currencyCode = "USD") => ({
  method,
  currencyCode,
  amount,
});

// ─── Binance cash-out (Recharge/index.tsx handleCryptoSubmit) ───────────────
// 533.06 USDT, $5 fee deducted → payout $528.06. The page sends the crypto
// service fields, paidByMethod "MULTI" on a split, the legs, the tender rate,
// the customer's USDT line (`customerPayments`) and — the bug — the stale
// `cashoutMethod: "CUSTOMER_ACCOUNT"` left by the seeded account line.

function binanceCashOut(
  legs: ReturnType<typeof L>[],
  flag: "CUSTOMER_ACCOUNT" | undefined,
): FsPayload {
  return {
    provider: "BINANCE",
    serviceType: "RECEIVE",
    amount: 533.06,
    currency: "USDT",
    clientId: CLIENT_ID,
    clientName: "Maysam Test",
    referenceNumber: "",
    commission: 5,
    feePaidBy: "DEDUCTED",
    paidByMethod: legs.length > 1 ? "MULTI" : legs[0]!.method,
    payments: legs,
    tender_exchange_rate: RATE,
    ...(flag ? { cashoutMethod: flag } : {}),
    customerPayments: [L("BINANCE", 533.06, "USDT")],
    customer_waived_amount: 0,
  };
}

describe("LIRA-391 sweep — Binance cash-out", () => {
  it("Account $200 + Whish $328.06 (stale CUSTOMER_ACCOUNT) → account −200, Whish_App −328.06, Binance +533.06", () => {
    expectSplit(
      binanceCashOut(
        [L("CUSTOMER_ACCOUNT", 200), L("WHISH", 328.06)],
        "CUSTOMER_ACCOUNT",
      ),
      {
        debtUsd: -200,
        drawer: { "Whish_App|USD": -328.06, "Binance|USDT": 533.06 },
      },
    );
  });

  it("Account $200 + Cash $328.06 (stale CUSTOMER_ACCOUNT) → account −200, General −328.06", () => {
    expectSplit(
      binanceCashOut(
        [L("CUSTOMER_ACCOUNT", 200), L("CASH", 328.06)],
        "CUSTOMER_ACCOUNT",
      ),
      { debtUsd: -200, drawer: { "General|USD": -328.06 } },
    );
  });

  it("control: the same split with the flag absent books per leg", () => {
    expectSplit(
      binanceCashOut(
        [L("CUSTOMER_ACCOUNT", 200), L("WHISH", 328.06)],
        undefined,
      ),
      { debtUsd: -200, drawer: { "Whish_App|USD": -328.06 } },
    );
  });

  it("an unbalanced split (Account $200 + Whish $300 ≠ $528.06) is refused", () => {
    expect(() =>
      submit(
        binanceCashOut(
          [L("CUSTOMER_ACCOUNT", 200), L("WHISH", 300)],
          "CUSTOMER_ACCOUNT",
        ),
      ),
    ).toThrow();
  });

  it("a single account line short of the payout is refused (legs reconciled even when all on account)", () => {
    expect(() =>
      submit(binanceCashOut([L("CUSTOMER_ACCOUNT", 500)], "CUSTOMER_ACCOUNT")),
    ).toThrow();
  });

  it("a single account line of the full payout still credits the whole payout (legacy single-line case unchanged)", () => {
    expectSplit(
      binanceCashOut([L("CUSTOMER_ACCOUNT", 528.06)], "CUSTOMER_ACCOUNT"),
      { debtUsd: -528.06, drawer: { "Binance|USDT": 533.06 } },
    );
  });

  it("an all-account payout still refuses a round-up", () => {
    expect(() =>
      submit({
        ...binanceCashOut([L("CUSTOMER_ACCOUNT", 528.06)], "CUSTOMER_ACCOUNT"),
        rounding_given_usd: 0.1,
      }),
    ).toThrow(/Rounding up isn't available/i);
  });
});

// ─── OMT App / Whish App cash-out (OmtWhishAppTransferForm → the shared
// core builder `buildWalletTransferPayload`, rule 22) ───────────────────────

function appCashOut(
  provider: "OMT_APP" | "WHISH_APP",
  legs: ReturnType<typeof L>[],
  flag: "CASH" | "CUSTOMER_ACCOUNT" | "WHISH",
): FsPayload {
  const fees = calculateOmtWhishAppFees({
    activeProvider: provider,
    serviceType: "RECEIVE",
    currency: "USD",
    parsedAmount: 300,
    manualFee: "",
    includingFees: false,
  });
  return buildWalletTransferPayload({
    provider,
    serviceType: "RECEIVE",
    currency: "USD",
    fees,
    includingFees: false,
    client: { id: CLIENT_ID, name: "Maysam Test", phone: "70111222" },
    paidByMethod: legs.length > 1 ? "MULTI" : legs[0]!.method,
    payments: legs,
    tenderExchangeRate: RATE,
    cashoutMethod: flag,
  }) as FsPayload;
}

describe("LIRA-391 sweep — OMT App / Whish App cash-out", () => {
  for (const provider of ["OMT_APP", "WHISH_APP"] as const) {
    it(`${provider}: Account $100 + Cash $200 (stale CUSTOMER_ACCOUNT) → account −100, General −200`, () => {
      expectSplit(
        appCashOut(
          provider,
          [L("CUSTOMER_ACCOUNT", 100), L("CASH", 200)],
          "CUSTOMER_ACCOUNT",
        ),
        { debtUsd: -100, drawer: { "General|USD": -200 } },
      );
    });
  }

  it("WHISH_APP: Account $100 + Whish $200 (stale CUSTOMER_ACCOUNT) → account −100, Whish_App net +103 (inflow 303, payout leg −200)", () => {
    expectSplit(
      appCashOut(
        "WHISH_APP",
        [L("CUSTOMER_ACCOUNT", 100), L("WHISH", 200)],
        "CUSTOMER_ACCOUNT",
      ),
      { debtUsd: -100, drawer: { "Whish_App|USD": 103 } },
    );
  });
});

// ─── OMT / Whish system RECEIVE (Services/index.tsx) ────────────────────────
// The page sends the payout lines as `payments` and `cashoutMethod` from the
// last single line, no `paidByMethod` once lines exist.

function systemReceive(
  provider: "OMT" | "WHISH",
  legs: ReturnType<typeof L>[],
  flag: "CASH" | "CUSTOMER_ACCOUNT" | "WHISH",
  amount = 300,
): FsPayload {
  // The provider is the shop's base system (a walk-in RECEIVE on the
  // secondary system is refused — it must go through a partner).
  db.prepare(
    `DELETE FROM system_settings WHERE key_name = 'shop_base_system' AND tenant_id = 1`,
  ).run();
  db.prepare(
    `INSERT INTO system_settings (tenant_id, key_name, value) VALUES (1, 'shop_base_system', ?)`,
  ).run(provider);
  return {
    provider,
    serviceType: "RECEIVE",
    amount,
    currency: "USD",
    clientName: "Maysam Test",
    phoneNumber: "70111222",
    clientId: CLIENT_ID,
    receiverClientId: CLIENT_ID,
    saveAsClient: false,
    senderName: "Abroad",
    senderPhone: "",
    receiverName: "Maysam Test",
    receiverPhone: "70111222",
    ...(provider === "OMT" ? { omtServiceType: "INTRA", omtFee: 0 } : {}),
    includingFees: false,
    payments: legs,
    cashoutMethod: flag,
    note: `${provider} - RECEIVE`,
  };
}

/** The drawer a single all-cash payout of this provider hits (OMT_System
 *  when OMT is the primary system, else General) — read from a control. */
function cashDrawerFor(provider: "OMT" | "WHISH"): string {
  const before = snapshotLedgers(db);
  submit(systemReceive(provider, [L("CASH", 1)], "CASH", 1));
  const d = ledgerDeltas(before, snapshotLedgers(db)).drawers;
  const hit = Object.entries(d).find(([, v]) => r2(v) === -1);
  if (!hit) throw new Error(`no cash drawer moved for ${provider}`);
  return hit[0];
}

describe("LIRA-391 sweep — OMT / Whish system RECEIVE", () => {
  for (const provider of ["OMT", "WHISH"] as const) {
    it(`${provider}: Account $100 + Cash $200 (stale CUSTOMER_ACCOUNT) → account −100, cash drawer −200`, () => {
      const cash = cashDrawerFor(provider);
      expectSplit(
        systemReceive(
          provider,
          [L("CUSTOMER_ACCOUNT", 100), L("CASH", 200)],
          "CUSTOMER_ACCOUNT",
        ),
        { debtUsd: -100, drawer: { [cash]: -200 } },
      );
    });
  }

  it("WHISH: Whish $100 + Cash $200 (stale WHISH) → Whish_App −100, cash drawer −200", () => {
    const cash = cashDrawerFor("WHISH");
    expectSplit(
      systemReceive("WHISH", [L("WHISH", 100), L("CASH", 200)], "WHISH"),
      { debtUsd: 0, drawer: { "Whish_App|USD": -100, [cash]: -200 } },
    );
  });

  it("OMT: an unbalanced split (Account $100 + Cash $150 ≠ $300) is refused", () => {
    expect(() =>
      submit(
        systemReceive(
          "OMT",
          [L("CUSTOMER_ACCOUNT", 100), L("CASH", 150)],
          "CUSTOMER_ACCOUNT",
        ),
      ),
    ).toThrow();
  });

  it("WHISH: an all-wallet payout still refuses kept change", () => {
    expect(() =>
      submit({
        ...systemReceive("WHISH", [L("WHISH", 299)], "WHISH"),
        // owed 300, hands 299, keeps $1
        kept_change_usd: 1,
      }),
    ).toThrow(/keeping change is not available/i);
  });
});

// ─── Other providers' RECEIVE (BOB / OTHER) — no per-leg payout path ────────
// No screen sends these (Services offers OMT / Whish only); REST callers can.
// That branch has no per-leg payout loop, so the fence must NOT apply there:
// the legacy flag path is kept unchanged (an account payout stays credited).

describe("LIRA-391 sweep — BOB RECEIVE (no per-leg payout path: flag path kept)", () => {
  it("account flag + one account leg → the account is still credited", () => {
    const before = snapshotLedgers(db);
    submit({
      provider: "BOB",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      clientId: CLIENT_ID,
      clientName: "Maysam Test",
      phoneNumber: "70111222",
      payments: [L("CUSTOMER_ACCOUNT", 100)],
      cashoutMethod: "CUSTOMER_ACCOUNT",
    });
    const d = ledgerDeltas(before, snapshotLedgers(db));
    expect(r2(d.debt[`${CLIENT_ID}|USD`] ?? 0)).toBe(-100);
  });
});

// ─── iPick sale (cost/price flow) with a stale paidByMethod — real ──────────
// Added AFTER the fix (no hole expected: the flow reads legs first) — not
// proven failing-first.

describe("LIRA-391 sweep — iPick sale, Account + Cash with a stale paidByMethod", () => {
  it("Account $4 + Cash $6 (stale CUSTOMER_ACCOUNT) → client owes 4, General +6", () => {
    const before = snapshotLedgers(db);
    submit({
      provider: "iPick",
      serviceType: "SEND",
      amount: 10,
      currency: "USD",
      cost: 9,
      price: 10,
      commission: 1,
      clientId: CLIENT_ID,
      clientName: "Maysam Test",
      phoneNumber: "70111222",
      paidByMethod: "CUSTOMER_ACCOUNT",
      payments: [L("CUSTOMER_ACCOUNT", 4), L("CASH", 6)],
    });
    const d = ledgerDeltas(before, snapshotLedgers(db));
    expect(r2(d.debt[`${CLIENT_ID}|USD`] ?? 0)).toBe(4);
    expect(r2(d.drawers["General|USD"] ?? 0)).toBe(6);
  });
});

// ─── FR-7 refund symmetry (rule 20) ─────────────────────────────────────────

describe("LIRA-391 — refund of a split Binance cash-out nets every ledger to 0", () => {
  it("Account $200 + Whish $328.06 → refund → drawers, client ledger, supplier ledger all back to 0 per currency", () => {
    const before = snapshotLedgers(db);
    const fsId = expectSplit(
      binanceCashOut(
        [L("CUSTOMER_ACCOUNT", 200), L("WHISH", 328.06)],
        "CUSTOMER_ACCOUNT",
      ),
      {
        debtUsd: -200,
        drawer: { "Whish_App|USD": -328.06, "Binance|USDT": 533.06 },
      },
    );
    getTransactionRepository().refundTransaction(txnIdOf(fsId), 1);
    expectPostings(before, snapshotLedgers(db), {});
  });
});

// ─── partner recharge order (RechargePartnerOrderService) — real, pure ──────

describe("LIRA-391 sweep — partner recharge order", () => {
  it("the account flag stays a refusal (a partner order takes no customer payment)", () => {
    expect(
      findPartnerOrderRefusal(7, [
        {
          provider: "IPICK",
          serviceType: "SEND",
          amount: 10,
          paidByMethod: "CUSTOMER_ACCOUNT",
        } as Parameters<typeof findPartnerOrderRefusal>[1] extends
          | readonly (infer S)[]
          | undefined
          ? S
          : never,
      ]),
    ).not.toBeNull();
  });
});

// ─── THIN rows: the lump-method keys each flow's schema accepts ─────────────

const LUMP_KEYS = [
  "cashoutMethod",
  "paidByMethod",
  "paid_by_method",
  "payment_method",
  "paid_by",
  "payoutMethod",
] as const;

interface ShapeHolder {
  shape?: Record<string, unknown>;
  def?: { in?: unknown; innerType?: unknown; schema?: unknown };
}

function shapeKeys(schema: unknown): string[] {
  let s = schema as ShapeHolder | undefined;
  for (let i = 0; i < 10 && s; i++) {
    if (s.shape) return Object.keys(s.shape);
    s = (s.def?.in ?? s.def?.innerType ?? s.def?.schema) as
      | ShapeHolder
      | undefined;
  }
  throw new Error("no object shape found");
}

const lumpKeysOf = (schema: unknown) =>
  shapeKeys(schema).filter((k) => (LUMP_KEYS as readonly string[]).includes(k));

const THIN_ROWS: Array<{
  flow: string;
  schema: unknown;
  lumpKeys: string[];
  routing: string;
}> = [
  {
    flow: "Katsh / iPick sale (FinancialServiceRepository cost/price flow)",
    schema: createFinancialServiceSchema,
    lumpKeys: ["paidByMethod", "cashoutMethod"],
    routing:
      "legs first: paidBy is read only in the no-leg `else` branch; the page sends MULTI on a split",
  },
  {
    flow: "exchange payout (ExchangeRepository)",
    schema: exchangeSubmitSchema,
    lumpKeys: [],
    routing: "legs only",
  },
  {
    flow: "debt repayment (DebtRepository.addRepayment)",
    schema: addRepaymentSchema,
    lumpKeys: ["paidByMethod"],
    routing:
      "legs first: paid_by_method builds legs only when payments[] is empty",
  },
  {
    flow: "session checkout payout (SessionPaymentService)",
    schema: sessionCheckoutSchema,
    lumpKeys: ["paidByMethod"],
    routing: "PAYOUT legs; the flag is not read for money",
  },
  {
    flow: "maintenance (MaintenanceRepository)",
    schema: saveMaintenanceJobSchema,
    lumpKeys: ["paid_by"],
    routing: "paid_by is stored for display; money posts from the legs",
  },
  {
    flow: "voucher sale (VoucherRepository)",
    schema: voucherCreateSchema,
    lumpKeys: [],
    routing: "legs only",
  },
  {
    flow: "supplier settle (SupplierRepository)",
    schema: supplierSettleSchema,
    lumpKeys: [],
    routing: "legs only",
  },
  {
    flow: "partner settle (PartnerSettlementRepository)",
    schema: partnerSettleSchema,
    lumpKeys: [],
    routing: "legs only",
  },
  {
    flow: "loto ticket (LotoTicketRepository)",
    schema: lotoSellSchema,
    lumpKeys: ["payment_method"],
    routing: "legs first: payment_method is read only when no leg is sent",
  },
  {
    flow: "loto prize payout (LotoCashPrizeRepository)",
    schema: lotoCashPrizeSchema,
    lumpKeys: [],
    routing: "always cash from General, no split possible",
  },
  {
    flow: "partner recharge order (RechargePartnerOrderService)",
    schema: rechargePartnerOrderSchema,
    lumpKeys: [],
    routing: "per-sale flag is a refusal (row above)",
  },
];

describe("LIRA-391 sweep — thin rows (no lump flag routes money next to legs)", () => {
  for (const row of THIN_ROWS) {
    it(`${row.flow}: lump keys [${row.lumpKeys.join(", ")}] — ${row.routing}`, () => {
      expect(lumpKeysOf(row.schema).sort()).toEqual([...row.lumpKeys].sort());
    });
  }
});
