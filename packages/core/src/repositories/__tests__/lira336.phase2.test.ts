/**
 * LIRA-336 phase 2 (owner 2026-10-19, FR-013 / FR-014) — added change on an
 * OMT/Whish system RECEIVE made THROUGH a partner, and on a wallet payout.
 *
 *   (a) THROUGH partner, CASH cashout: the customer's $3 in
 *       `customerPayments`, $200 handed. The partner system's cash is the
 *       General drawer, so General nets −197 and the partner ledger moves
 *       exactly as for a plain $197 THROUGH receive.
 *   (b) wallet cashout (OMT/WHISH system RECEIVE paid by Whish): with a
 *       claim the payout is posted line by line (Whish_App −200, the
 *       customer's cash +3 in its own drawer); without one the legacy lump
 *       is unchanged.
 *   (c) FOR partner stays refused.
 *   (d) THROUGH Whish RECEIVE with the fee paid on top: the Services screen
 *       sends `feePayments` with the THROUGH `partnerId` (its fee gate checks
 *       only the For-Partner toggle), and the server refused it. Fixed: the
 *       fee lines post exactly as for a walk-in (same drawers as the
 *       synthesized single fee leg), the partner ledger unchanged.
 *
 * Every accepted case compares against a CONTROL (the same payout with no
 * added change / with the synthesized fee leg): per-drawer deltas, supplier,
 * partner and debt ledgers, amount and profit stamp; then the generic void
 * nets every ledger and the profit to 0 (rule 20). USD and LBP variants
 * (rule 28d). Every payload is parsed through the real core schema first
 * (rule 24) unless the case is explicitly "repository, no Zod".
 *
 * Rule 17 — run on 2026-10-19 against the code BEFORE the phase-2 change:
 * 19 of 26 failed. Every control payout saved (so each failure is the
 * subject, not the setup). How they failed:
 *   - (a) all 6 accepted cases (WHISH and OMT THROUGH, USD / LBP-line / LBP
 *     payout) and (b) the THROUGH-wallet case: ZodError "customerPayments
 *     cannot be used on a partner transaction — there is no walk-in customer
 *     paying."; the 2 "schema accepts THROUGH lines with a claim": false;
 *   - (b) the 3 walk-in wallet cases and "lines don't cover owed + added":
 *     "The customer can't add change on this payout. (OMT RECEIVE: a wallet
 *     payout is sent exactly)" — the up-front refusal;
 *   - (d) CONFIRMED EXISTING BUG: the screen's payload (feePayments + THROUGH
 *     partnerId) failed the schema, and every save — through the schema AND
 *     the repository with no Zod — threw "feePayments cannot be used on a
 *     partner transaction — the partner handles the fee" (USD, LBP, LBP fee
 *     line, fee lines + claim). The controls (same receive, synthesized fee
 *     leg) saved: General −192 for $197 + $5 fee.
 * The 7 that passed must pass on both sides: the "no claim" repository
 * refusals, "a claim with no payout lines", the two FOR refusals and the two
 * no-claim wallet lump regressions.
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
  FinancialServiceRepository,
  resetFinancialServiceRepository,
} from "../FinancialServiceRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetExpenseRepository } from "../ExpenseRepository";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetDebtService } from "../../services/DebtService";
import { resetClientRepository } from "../ClientRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import {
  createFinancialServiceSchema,
  type CreateFinancialServiceInput,
} from "../../validators/financial";
import {
  snapshotLedgers,
  ledgerDeltas,
  expectPostings,
  type LedgerName,
} from "../testHelpers/postingAssert";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL = fs.readFileSync(
  path.join(REPO_ROOT, "electron-app/create_db.sql"),
  "utf-8",
);

const RATE = 89_500;

let db: Database.Database;

function resetAll(): void {
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
  const seed = db.prepare(
    `INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, ?, ?, ?)`,
  );
  for (const [d, c, b] of [
    ["General", "USD", 10_000],
    ["General", "LBP", 900_000_000],
    ["OMT_System", "USD", 10_000],
    ["OMT_System", "LBP", 900_000_000],
    ["Whish_System", "USD", 10_000],
    ["Whish_System", "LBP", 900_000_000],
    ["Whish_App", "USD", 10_000],
    ["Whish_App", "LBP", 900_000_000],
  ] as const)
    seed.run(d, c, b);
  db.prepare(
    `INSERT OR REPLACE INTO exchange_rates (tenant_id, to_code, market_rate, buy_rate, sell_rate, is_stronger) VALUES (1, 'LBP', 89500, 89000, 90000, 1)`,
  ).run();
});

afterEach(() => {
  resetTenantContext();
  resetAll();
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

// ─── helpers ────────────────────────────────────────────────────────────────

const r2 = (n: number) => Math.round(n * 100) / 100;
const roundKey = (k: string, v: number) =>
  k.endsWith("|LBP") ? Math.round(v) : r2(v);

function setBaseSystem(code: "OMT" | "WHISH"): void {
  const upd = db
    .prepare(
      `UPDATE system_settings SET value = ? WHERE key_name = 'shop_base_system'`,
    )
    .run(code);
  if (upd.changes === 0) {
    db.prepare(
      `INSERT INTO system_settings (key_name, value) VALUES ('shop_base_system', ?)`,
    ).run(code);
  }
}

function addPartner(system: "OMT" | "WHISH"): number {
  return Number(
    db
      .prepare(
        `INSERT INTO partners (tenant_id, name, is_active, system_association) VALUES (1, ?, 1, ?)`,
      )
      .run(`Partner ${system} ${Math.random()}`, system).lastInsertRowid,
  );
}

interface ParentTxn {
  id: number;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  metadata_json: string | null;
}

function fsParent(fsId: number): ParentTxn {
  return db
    .prepare(
      `SELECT id, amount_usd, amount_lbp, profit_usd, profit_lbp, metadata_json FROM transactions
        WHERE source_table = 'financial_services' AND source_id = ? AND reverses_id IS NULL
        ORDER BY id ASC LIMIT 1`,
    )
    .get(fsId) as ParentTxn;
}

function profitSum(): { usd: number; lbp: number } {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(profit_usd),0) AS usd, COALESCE(SUM(profit_lbp),0) AS lbp
         FROM transactions WHERE status = 'ACTIVE'`,
    )
    .get() as { usd: number; lbp: number };
  return { usd: Math.round(r.usd * 1e6) / 1e6, lbp: Math.round(r.lbp) };
}

function countRows(table: "transactions" | "payments" | "partner_ledger") {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
  ).n;
}

type FsPayload = Partial<CreateFinancialServiceInput> & Record<string, unknown>;

function fsCreate(p: FsPayload): number {
  const parsed = createFinancialServiceSchema.parse(p);
  return new FinancialServiceRepository().createTransaction({
    exchangeRate: RATE,
    ...parsed,
  } as Parameters<FinancialServiceRepository["createTransaction"]>[0]).id;
}

/** Repository entry point with no Zod (offline replay / internal callers). */
function fsCreateRaw(p: FsPayload): number {
  return new FinancialServiceRepository().createTransaction({
    exchangeRate: RATE,
    ...p,
  } as Parameters<FinancialServiceRepository["createTransaction"]>[0]).id;
}

const voidTxn = (t: ParentTxn) =>
  getTransactionRepository().voidTransaction(t.id, 1);

function diffMap(
  a: Record<string, number>,
  b: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const d = roundKey(k, (a[k] ?? 0) - (b[k] ?? 0));
    if (d !== 0) out[k] = d;
  }
  return out;
}

interface CompareArgs {
  control: () => ParentTxn;
  subject: () => ParentTxn;
  /** "drawer|currency" → how much MORE it moved than in the control. */
  extraDrawerMoves: Record<string, number>;
  /** Absolute drawer movement of the CONTROL, when the case pins it. */
  controlDrawers?: Record<string, number>;
  /** A line the customer handed over: a positive payments row of the
   *  subject AND an IN line of its payment snapshot (the receipt). */
  customerLine?: SnapshotLine;
  /** A payout line: an OUT line of the subject's payment snapshot. */
  payoutLine?: SnapshotLine;
}

interface SnapshotLine {
  method: string;
  currencyCode: string;
  amount: number;
}

function snapshotHas(
  t: ParentTxn,
  line: SnapshotLine,
  direction: "IN" | "OUT",
): boolean {
  const snap = JSON.parse(t.metadata_json ?? "{}").payment_snapshot as
    | {
        lines: Array<{
          method: string;
          currency: string;
          amount: number;
          direction: string;
        }>;
      }
    | undefined;
  return !!snap?.lines.some(
    (l) =>
      l.direction === direction &&
      l.method === line.method &&
      l.currency === line.currencyCode &&
      Math.abs(l.amount - line.amount) < 0.001,
  );
}

/**
 * The subject moves every drawer by the control's movement + exactly
 * `extraDrawerMoves`; supplier / partner / debt ledgers, amount and profit
 * equal the control's; the void nets every ledger and the profit to 0.
 */
function expectLikeControl(a: CompareArgs): ParentTxn {
  const c0 = snapshotLedgers(db);
  const control = a.control();
  const cd = ledgerDeltas(c0, snapshotLedgers(db));
  if (a.controlDrawers) {
    expect(diffMap(cd.drawers, {})).toEqual(a.controlDrawers);
  }
  voidTxn(control);
  expectPostings(c0, snapshotLedgers(db), {});

  const before = snapshotLedgers(db);
  const p0 = profitSum();
  const t = a.subject();
  expect(t).toBeDefined();
  const sd = ledgerDeltas(before, snapshotLedgers(db));

  for (const ledger of ["supplier", "partner", "debt"] as LedgerName[]) {
    expect({ ledger, off: diffMap(sd[ledger], cd[ledger]) }).toEqual({
      ledger,
      off: {},
    });
  }
  expect(diffMap(sd.drawers, cd.drawers)).toEqual(
    diffMap(a.extraDrawerMoves, {}),
  );
  expect(r2(t.amount_usd)).toBe(r2(control.amount_usd));
  expect(Math.round(t.amount_lbp)).toBe(Math.round(control.amount_lbp));
  expect(r2(t.profit_usd)).toBe(r2(control.profit_usd));
  expect(Math.round(t.profit_lbp)).toBe(Math.round(control.profit_lbp));

  if (a.customerLine) {
    const cl = a.customerLine;
    const rows = db
      .prepare(
        `SELECT method, currency_code, amount FROM payments WHERE transaction_id = ? AND amount > 0`,
      )
      .all(t.id) as Array<{
      method: string;
      currency_code: string;
      amount: number;
    }>;
    expect(
      rows.some(
        (r) =>
          r.method === cl.method &&
          r.currency_code === cl.currencyCode &&
          Math.abs(r.amount - cl.amount) < 0.001,
      ),
    ).toBe(true);
    expect(snapshotHas(t, cl, "IN")).toBe(true);
  }
  if (a.payoutLine) {
    expect(snapshotHas(t, a.payoutLine, "OUT")).toBe(true);
  }

  voidTxn(t);
  expectPostings(before, snapshotLedgers(db), {});
  expect(profitSum()).toEqual(p0);
  return t;
}

function expectRefused(run: () => void, message: RegExp): void {
  const before = snapshotLedgers(db);
  const n = countRows("transactions");
  const np = countRows("payments");
  const nl = countRows("partner_ledger");
  expect(run).toThrow(message);
  expect(countRows("transactions")).toBe(n);
  expect(countRows("payments")).toBe(np);
  expect(countRows("partner_ledger")).toBe(nl);
  expectPostings(before, snapshotLedgers(db), {});
}

const NOT_ALLOWED = /can't add change on this payout/;
const usd3 = { method: "CASH", currencyCode: "USD", amount: 3 };

/** A system RECEIVE THROUGH a partner, CASH cashout, no fee. */
const throughReceive = (
  provider: "OMT" | "WHISH",
  partnerId: number,
  amount: number,
  currency: "USD" | "LBP",
  payout: Array<{ method?: string; currencyCode: string; amount: number }>,
  extra: FsPayload = {},
): FsPayload => ({
  provider,
  serviceType: "RECEIVE",
  amount,
  currency,
  commission: 0,
  ...(provider === "OMT" ? { omtServiceType: "INTRA" } : { whishFee: 0 }),
  cashoutMethod: "CASH",
  partnerId,
  partnerMode: "THROUGH",
  payments: payout.map((l) => ({ method: "CASH", ...l })),
  ...extra,
});

// ─── (a) THROUGH partner, CASH cashout ──────────────────────────────────────

describe.each([
  // The partner system is the shop's SECONDARY system: its cash is General.
  { provider: "WHISH" as const, base: "OMT" as const },
  { provider: "OMT" as const, base: "WHISH" as const },
])("LIRA-336 phase 2 (a) — $provider RECEIVE THROUGH a partner", (c) => {
  let partnerId = 0;
  beforeEach(() => {
    setBaseSystem(c.base);
    partnerId = addPartner(c.provider);
  });

  it("$197 owed, customer gives Cash USD 3, shop hands $200 → General −197, partner ledger as a plain $197 receive", () => {
    expectLikeControl({
      control: () =>
        fsParent(
          fsCreate(
            throughReceive(c.provider, partnerId, 197, "USD", [
              { currencyCode: "USD", amount: 197 },
            ]),
          ),
        ),
      subject: () =>
        fsParent(
          fsCreate(
            throughReceive(
              c.provider,
              partnerId,
              197,
              "USD",
              [{ currencyCode: "USD", amount: 200 }],
              { customerPayments: [usd3], added_change_usd: 3 },
            ),
          ),
        ),
      controlDrawers: { "General|USD": -197 },
      extraDrawerMoves: {},
      customerLine: usd3,
      payoutLine: { method: "CASH", currencyCode: "USD", amount: 200 },
    });
  });

  it("customer gives LBP 268,500 at 89,500 → General USD −3 more, LBP +268,500", () => {
    const lbpLine = { method: "CASH", currencyCode: "LBP", amount: 268_500 };
    expectLikeControl({
      control: () =>
        fsParent(
          fsCreate(
            throughReceive(c.provider, partnerId, 197, "USD", [
              { currencyCode: "USD", amount: 197 },
            ]),
          ),
        ),
      subject: () =>
        fsParent(
          fsCreate(
            throughReceive(
              c.provider,
              partnerId,
              197,
              "USD",
              [{ currencyCode: "USD", amount: 200 }],
              {
                customerPayments: [lbpLine],
                added_change_usd: 3,
                tender_exchange_rate: RATE,
              },
            ),
          ),
        ),
      extraDrawerMoves: { "General|USD": -3, "General|LBP": 268_500 },
      customerLine: lbpLine,
    });
  });

  it("LBP payout: owed 1,345,000, customer gives 5,000, shop hands 1,350,000", () => {
    const line = { method: "CASH", currencyCode: "LBP", amount: 5_000 };
    expectLikeControl({
      control: () =>
        fsParent(
          fsCreate(
            throughReceive(c.provider, partnerId, 1_345_000, "LBP", [
              { currencyCode: "LBP", amount: 1_345_000 },
            ]),
          ),
        ),
      subject: () =>
        fsParent(
          fsCreate(
            throughReceive(
              c.provider,
              partnerId,
              1_345_000,
              "LBP",
              [{ currencyCode: "LBP", amount: 1_350_000 }],
              { customerPayments: [line], added_change_lbp: 5_000 },
            ),
          ),
        ),
      controlDrawers: { "General|LBP": -1_345_000 },
      extraDrawerMoves: {},
      customerLine: line,
      payoutLine: { method: "CASH", currencyCode: "LBP", amount: 1_350_000 },
    });
  });

  it("the schema accepts THROUGH customer lines only with a claim", () => {
    const base = throughReceive(c.provider, partnerId, 197, "USD", [
      { currencyCode: "USD", amount: 200 },
    ]);
    expect(
      createFinancialServiceSchema.safeParse({
        ...base,
        customerPayments: [usd3],
      }).success,
    ).toBe(false);
    expect(
      createFinancialServiceSchema.safeParse({
        ...base,
        customerPayments: [usd3],
        added_change_usd: 3,
      }).success,
    ).toBe(true);
  });

  it("THROUGH customer lines with no claim → refused (repository, no Zod)", () => {
    expectRefused(
      () =>
        fsCreateRaw(
          throughReceive(
            c.provider,
            partnerId,
            197,
            "USD",
            [{ currencyCode: "USD", amount: 200 }],
            { customerPayments: [usd3] },
          ),
        ),
      /customerPayments/,
    );
  });
});

// ─── (b) wallet cashout ─────────────────────────────────────────────────────

describe("LIRA-336 phase 2 (b) — system RECEIVE paid out by Whish wallet", () => {
  const walletReceive = (
    amount: number,
    currency: "USD" | "LBP",
    payout: Array<{ currencyCode: string; amount: number }> | undefined,
    extra: FsPayload = {},
  ): FsPayload => ({
    provider: "OMT",
    serviceType: "RECEIVE",
    amount,
    currency,
    omtServiceType: "INTRA",
    cashoutMethod: "WHISH",
    ...(payout
      ? { payments: payout.map((l) => ({ method: "WHISH", ...l })) }
      : {}),
    ...extra,
  });

  it("walk-in OMT (primary): Whish 200 out, Cash 3 in, claim 3 → Whish_App −200, OMT_System +3", () => {
    expectLikeControl({
      control: () => fsParent(fsCreate(walletReceive(197, "USD", undefined))),
      subject: () =>
        fsParent(
          fsCreate(
            walletReceive(197, "USD", [{ currencyCode: "USD", amount: 200 }], {
              customerPayments: [usd3],
              added_change_usd: 3,
            }),
          ),
        ),
      controlDrawers: { "Whish_App|USD": -197 },
      extraDrawerMoves: { "Whish_App|USD": -3, "OMT_System|USD": 3 },
      customerLine: usd3,
      payoutLine: { method: "WHISH", currencyCode: "USD", amount: 200 },
    });
  });

  it("customer gives LBP 268,500 → Whish_App USD −200, OMT_System LBP +268,500", () => {
    const lbpLine = { method: "CASH", currencyCode: "LBP", amount: 268_500 };
    expectLikeControl({
      control: () => fsParent(fsCreate(walletReceive(197, "USD", undefined))),
      subject: () =>
        fsParent(
          fsCreate(
            walletReceive(197, "USD", [{ currencyCode: "USD", amount: 200 }], {
              customerPayments: [lbpLine],
              added_change_usd: 3,
              tender_exchange_rate: RATE,
            }),
          ),
        ),
      extraDrawerMoves: { "Whish_App|USD": -3, "OMT_System|LBP": 268_500 },
      customerLine: lbpLine,
      payoutLine: { method: "WHISH", currencyCode: "USD", amount: 200 },
    });
  });

  it("LBP payout: owed 1,345,000, Whish 1,350,000 out, Cash 5,000 in", () => {
    expectLikeControl({
      control: () =>
        fsParent(fsCreate(walletReceive(1_345_000, "LBP", undefined))),
      subject: () =>
        fsParent(
          fsCreate(
            walletReceive(
              1_345_000,
              "LBP",
              [{ currencyCode: "LBP", amount: 1_350_000 }],
              {
                customerPayments: [
                  { method: "CASH", currencyCode: "LBP", amount: 5_000 },
                ],
                added_change_lbp: 5_000,
              },
            ),
          ),
        ),
      controlDrawers: { "Whish_App|LBP": -1_345_000 },
      extraDrawerMoves: { "Whish_App|LBP": -5_000, "OMT_System|LBP": 5_000 },
      customerLine: { method: "CASH", currencyCode: "LBP", amount: 5_000 },
      payoutLine: { method: "WHISH", currencyCode: "LBP", amount: 1_350_000 },
    });
  });

  it("THROUGH a Whish partner (secondary): Whish_App −200, General +3", () => {
    const partnerId = addPartner("WHISH");
    const through: FsPayload = {
      provider: "WHISH",
      serviceType: "RECEIVE",
      amount: 197,
      currency: "USD",
      commission: 0,
      whishFee: 0,
      cashoutMethod: "WHISH",
      partnerId,
      partnerMode: "THROUGH",
    };
    expectLikeControl({
      control: () => fsParent(fsCreate(through)),
      subject: () =>
        fsParent(
          fsCreate({
            ...through,
            payments: [{ method: "WHISH", currencyCode: "USD", amount: 200 }],
            customerPayments: [usd3],
            added_change_usd: 3,
          }),
        ),
      controlDrawers: { "Whish_App|USD": -197 },
      extraDrawerMoves: { "Whish_App|USD": -3, "General|USD": 3 },
      customerLine: usd3,
      payoutLine: { method: "WHISH", currencyCode: "USD", amount: 200 },
    });
  });

  it("a claim with no payout lines → refused, nothing written", () => {
    expectRefused(
      () =>
        fsCreate(
          walletReceive(197, "USD", undefined, {
            customerPayments: [usd3],
            added_change_usd: 3,
          }),
        ),
      NOT_ALLOWED,
    );
  });

  it("a claim whose wallet lines don't cover owed + added → refused", () => {
    expectRefused(
      () =>
        fsCreate(
          walletReceive(197, "USD", [{ currencyCode: "USD", amount: 197 }], {
            customerPayments: [usd3],
            added_change_usd: 3,
          }),
        ),
      /doesn't add up to the total/,
    );
  });

  // Regression (passes before AND after — not proven failing-first): with no
  // claim the wallet payout is the legacy lump, whatever `payments` says.
  it.each([
    ["no payout lines", undefined],
    ["payout lines present", [{ currencyCode: "USD", amount: 197 }]],
  ] as const)(
    "no claim (%s) → one −197 lump on Whish_App, exactly as today",
    (_label, payout) => {
      const before = snapshotLedgers(db);
      const t = fsParent(
        fsCreate(
          walletReceive(
            197,
            "USD",
            payout ? payout.map((l) => ({ ...l })) : undefined,
          ),
        ),
      );
      expect(
        diffMap(ledgerDeltas(before, snapshotLedgers(db)).drawers, {}),
      ).toEqual({ "Whish_App|USD": -197 });
      const rows = db
        .prepare(
          `SELECT drawer_name, currency_code, amount FROM payments WHERE transaction_id = ?`,
        )
        .all(t.id);
      expect(rows).toEqual([
        { drawer_name: "Whish_App", currency_code: "USD", amount: -197 },
      ]);
    },
  );
});

// ─── (c) FOR partner stays refused ──────────────────────────────────────────

describe("LIRA-336 phase 2 (c) — FOR partner", () => {
  it("FOR-partner RECEIVE with customer lines and a claim → refused (schema and repository)", () => {
    const partnerId = addPartner("OMT");
    const p: FsPayload = {
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 197,
      currency: "USD",
      omtServiceType: "INTRA",
      partnerId,
      partnerMode: "FOR",
      payments: [],
      customerPayments: [usd3],
      added_change_usd: 3,
    };
    expect(createFinancialServiceSchema.safeParse(p).success).toBe(false);
    expectRefused(() => fsCreateRaw(p), /partner/);
  });

  it("FOR-partner Whish RECEIVE with feePayments → still refused", () => {
    setBaseSystem("WHISH");
    const partnerId = addPartner("WHISH");
    const p: FsPayload = {
      provider: "WHISH",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 0,
      whishFee: 5,
      cashoutMethod: "CASH",
      partnerId,
      partnerMode: "FOR",
      feePayments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
    };
    expect(createFinancialServiceSchema.safeParse(p).success).toBe(false);
    expectRefused(
      () => fsCreateRaw(p),
      /feePayments cannot be used on a partner transaction/,
    );
  });
});

// ─── (d) THROUGH Whish RECEIVE, fee paid on top with fee lines ─────────────

describe("LIRA-336 phase 2 (d) — THROUGH Whish RECEIVE, fee on top in fee lines", () => {
  let partnerId = 0;
  beforeEach(() => {
    setBaseSystem("OMT"); // Whish is the partner (secondary) system
    partnerId = addPartner("WHISH");
  });

  const whishThrough = (
    amount: number,
    currency: "USD" | "LBP",
    fee: number,
    payout: number,
    extra: FsPayload = {},
  ): FsPayload => ({
    provider: "WHISH",
    serviceType: "RECEIVE",
    amount,
    currency,
    commission: 0,
    whishFee: fee,
    cashoutMethod: "CASH",
    partnerId,
    partnerMode: "THROUGH",
    payments: [{ method: "CASH", currencyCode: currency, amount: payout }],
    ...extra,
  });

  it("the screen's payload (feePayments + THROUGH partnerId) passes the schema", () => {
    expect(
      createFinancialServiceSchema.safeParse(
        whishThrough(197, "USD", 5, 197, {
          feePayments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
        }),
      ).success,
    ).toBe(true);
  });

  it("USD: fee $5 in a Cash fee line → posts as the synthesized fee leg, partner ledger unchanged", () => {
    expectLikeControl({
      control: () => fsParent(fsCreate(whishThrough(197, "USD", 5, 197))),
      subject: () =>
        fsParent(
          fsCreate(
            whishThrough(197, "USD", 5, 197, {
              feePayments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
            }),
          ),
        ),
      controlDrawers: { "General|USD": -192 },
      extraDrawerMoves: {},
      customerLine: { method: "CASH", currencyCode: "USD", amount: 5 },
    });
  });

  it("USD (repository, no Zod): same", () => {
    expectLikeControl({
      control: () => fsParent(fsCreateRaw(whishThrough(197, "USD", 5, 197))),
      subject: () =>
        fsParent(
          fsCreateRaw(
            whishThrough(197, "USD", 5, 197, {
              feePayments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
            }),
          ),
        ),
      extraDrawerMoves: {},
    });
  });

  it("LBP: fee 90,000 in a Cash LBP fee line", () => {
    expectLikeControl({
      control: () =>
        fsParent(fsCreate(whishThrough(1_345_000, "LBP", 90_000, 1_345_000))),
      subject: () =>
        fsParent(
          fsCreate(
            whishThrough(1_345_000, "LBP", 90_000, 1_345_000, {
              feePayments: [
                { method: "CASH", currencyCode: "LBP", amount: 90_000 },
              ],
            }),
          ),
        ),
      controlDrawers: { "General|LBP": -1_255_000 },
      extraDrawerMoves: {},
    });
  });

  it("USD transfer, $5 fee paid in LBP 447,500 → General USD −5 vs control, LBP +447,500", () => {
    expectLikeControl({
      control: () => fsParent(fsCreate(whishThrough(197, "USD", 5, 197))),
      subject: () =>
        fsParent(
          fsCreate(
            whishThrough(197, "USD", 5, 197, {
              feePayments: [
                { method: "CASH", currencyCode: "LBP", amount: 447_500 },
              ],
              tender_exchange_rate: RATE,
            }),
          ),
        ),
      extraDrawerMoves: { "General|USD": -5, "General|LBP": 447_500 },
      customerLine: { method: "CASH", currencyCode: "LBP", amount: 447_500 },
    });
  });

  it("fee $5 + $3 added in the fee lines ($8), shop hands $200 → as the $197 + fee control", () => {
    expectLikeControl({
      control: () => fsParent(fsCreate(whishThrough(197, "USD", 5, 197))),
      subject: () =>
        fsParent(
          fsCreate(
            whishThrough(197, "USD", 5, 200, {
              feePayments: [{ method: "CASH", currencyCode: "USD", amount: 8 }],
              added_change_usd: 3,
            }),
          ),
        ),
      extraDrawerMoves: {},
      customerLine: { method: "CASH", currencyCode: "USD", amount: 8 },
      payoutLine: { method: "CASH", currencyCode: "USD", amount: 200 },
    });
  });
});
