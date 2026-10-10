/**
 * LIRA-304 — US1 guards (tasks T015, T016, T017, T021): repayment money goes
 * to the SAME drawers whether the debt came from one session basket or from
 * separate visits; only the shop's PRIMARY system is routed (never the
 * secondary system, never a wallet app, never non-cash); routing follows
 * ticked items first, then "OMT drawer first", always capped per transfer;
 * and a refunded repayment stops counting as routed.
 *
 * Failing-first (rule 17), recorded 2026-10-11 before the routing rewrite:
 * see the task notes in specs/304-debt-item-picking/tasks.md.
 *
 * Debt used throughout (OMT-primary shop, rate 89,000): an OMT send of $101,
 * a cable of $14 and a Loto ticket of 200,000 LBP.
 */
import type Database from "better-sqlite3";
import {
  installDebtItemTestDb,
  uninstallDebtItemTestDb,
  addClient,
  seedBasketMembers,
  seedTransferDebt,
  seedSaleDebt,
  seedChargeDebt,
  setBaseSystem,
  drawers,
  drawerDelta,
  RATE,
} from "../testHelpers/debtItemDb";
import { DebtRepository, type CreateRepaymentData } from "../DebtRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
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
let repo: DebtRepository;

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
  repo = new DebtRepository();
  addClient(db, 7, "Claude Demo", "03101010");
});

afterEach(() => {
  resetAll();
  resetTenantContext();
  uninstallDebtItemTestDb(db);
});

type Target = { kind: "sale" | "charge" | "member"; id: number };

function repay(o: {
  usd?: number;
  lbp?: number;
  legs: Array<{ method: string; currencyCode: "USD" | "LBP"; amount: number }>;
  targets?: Target[];
  rate?: number;
}): number {
  const data = {
    client_id: 7,
    amount_usd: o.usd ?? 0,
    amount_lbp: o.lbp ?? 0,
    created_by: 1,
    payments: o.legs,
    tender_exchange_rate: o.rate ?? RATE,
    ...(o.targets ? { targets: o.targets } : {}),
  } as unknown as CreateRepaymentData;
  return repo.addRepayment(data).id;
}

function cashUsd(amount: number) {
  return [{ method: "CASH", currencyCode: "USD" as const, amount }];
}

function repaymentTxn(ledgerId: number): {
  id: number;
  metadata_json: string;
} {
  return db
    .prepare(
      `SELECT id, metadata_json FROM transactions WHERE source_table = 'debt_ledger' AND source_id = ? AND type = 'DEBT_REPAYMENT'`,
    )
    .get(ledgerId) as { id: number; metadata_json: string };
}

function checkoutOnAccount(
  items: Parameters<typeof seedBasketMembers>[2],
  usd: number,
  lbp: number,
) {
  const basket = seedBasketMembers(db, 7, items);
  const legs = [];
  if (usd) legs.push({ method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: usd });
  if (lbp) legs.push({ method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: lbp });
  getSessionPaymentService().recordBasketPayment(basket.sessionId, {
    legs,
    exchangeRate: RATE,
    userId: 1,
    clientId: 7,
  });
  return basket;
}

const FULL_LEGS = [
  { method: "CASH", currencyCode: "USD" as const, amount: 115 },
  { method: "CASH", currencyCode: "LBP" as const, amount: 200_000 },
];

describe("T015 — same drawers for a basket and for separate visits", () => {
  it("(a) basket on account, settled in cash: OMT share to OMT_System", () => {
    checkoutOnAccount(
      [
        { kind: "transfer", provider: "OMT", usd: 101 },
        { kind: "sale", usd: 14 },
        { kind: "loto", lbp: 200_000 },
      ],
      115,
      200_000,
    );
    const before = drawers(db);
    repay({ usd: 115, lbp: 200_000, legs: FULL_LEGS });
    expect(drawerDelta(before, drawers(db))).toEqual({
      "General|USD": 14,
      "General|LBP": 200_000,
      "OMT_System|USD": 101,
    });
  });

  it("(b) the same three items as separate visits: identical drawer deltas", () => {
    seedTransferDebt(db, { clientId: 7, provider: "OMT", usd: 101 });
    seedSaleDebt(db, { clientId: 7, usd: 14 });
    seedChargeDebt(db, {
      clientId: 7,
      debtType: "Loto Debt",
      txnType: "LOTO",
      lbp: 200_000,
    });
    const before = drawers(db);
    repay({ usd: 115, lbp: 200_000, legs: FULL_LEGS });
    expect(drawerDelta(before, drawers(db))).toEqual({
      "General|USD": 14,
      "General|LBP": 200_000,
      "OMT_System|USD": 101,
    });
  });

  it("(c) Whish-primary shop: a basket Whish send goes to Whish_System", () => {
    setBaseSystem(db, "WHISH");
    checkoutOnAccount(
      [
        { kind: "transfer", provider: "WHISH", usd: 50 },
        { kind: "sale", usd: 14 },
      ],
      64,
      0,
    );
    const before = drawers(db);
    repay({ usd: 64, legs: cashUsd(64) });
    expect(drawerDelta(before, drawers(db))).toEqual({
      "General|USD": 14,
      "Whish_System|USD": 50,
    });
  });

  it("(d) OMT shop, a Whish (system) debt: secondary system is never routed", () => {
    seedTransferDebt(db, { clientId: 7, provider: "WHISH", usd: 50 });
    const before = drawers(db);
    repay({ usd: 50, legs: cashUsd(50) });
    expect(drawerDelta(before, drawers(db))).toEqual({ "General|USD": 50 });
  });

  it("(e) Whish-primary shop, a Whish App debt: wallet apps are never routed", () => {
    setBaseSystem(db, "WHISH");
    seedTransferDebt(db, { clientId: 7, provider: "WHISH_APP", usd: 30 });
    const before = drawers(db);
    repay({ usd: 30, legs: cashUsd(30) });
    expect(drawerDelta(before, drawers(db))).toEqual({ "General|USD": 30 });
  });

  it("(f) an OMT debt paid from a wallet: only cash is routed", () => {
    seedTransferDebt(db, { clientId: 7, provider: "OMT", usd: 50 });
    const before = drawers(db);
    repay({
      usd: 50,
      legs: [{ method: "WHISH", currencyCode: "USD", amount: 50 }],
    });
    expect(drawerDelta(before, drawers(db))).toEqual({ "Whish_App|USD": 50 });
  });
});

describe("T016 — ticked first, then OMT drawer first, capped per transfer", () => {
  function separateVisits() {
    const omt = seedTransferDebt(db, { clientId: 7, provider: "OMT", usd: 101 });
    const sale = seedSaleDebt(db, { clientId: 7, usd: 14 });
    return { omt, sale };
  }

  it("no tick $50 → OMT_System +$50; later tick OMT, pay $65 → +$51 (cap), General +$14", () => {
    const { omt } = separateVisits();
    let before = drawers(db);
    repay({ usd: 50, legs: cashUsd(50) });
    expect(drawerDelta(before, drawers(db))).toEqual({ "OMT_System|USD": 50 });

    before = drawers(db);
    repay({
      usd: 65,
      legs: cashUsd(65),
      targets: [{ kind: "charge", id: omt.debtRowId }],
    });
    expect(drawerDelta(before, drawers(db))).toEqual({
      "OMT_System|USD": 51,
      "General|USD": 14,
    });
  });

  it("tick the cable, pay $14 → General only", () => {
    const { sale } = separateVisits();
    const before = drawers(db);
    repay({
      usd: 14,
      legs: cashUsd(14),
      targets: [{ kind: "sale", id: sale.saleId }],
    });
    expect(drawerDelta(before, drawers(db))).toEqual({ "General|USD": 14 });
  });

  it("tick the cable, pay $60 → General $14, OMT_System $46", () => {
    const { sale } = separateVisits();
    const before = drawers(db);
    repay({
      usd: 60,
      legs: cashUsd(60),
      targets: [{ kind: "sale", id: sale.saleId }],
    });
    expect(drawerDelta(before, drawers(db))).toEqual({
      "General|USD": 14,
      "OMT_System|USD": 46,
    });
  });

  it("LBP cash for a USD OMT debt goes in as LBP and records $101 routed", () => {
    seedTransferDebt(db, { clientId: 7, provider: "OMT", usd: 101 });
    const before = drawers(db);
    const ledgerId = repay({
      usd: 101,
      legs: [{ method: "CASH", currencyCode: "LBP", amount: 8_989_000 }],
    });
    expect(drawerDelta(before, drawers(db))).toEqual({
      "OMT_System|LBP": 8_989_000,
    });
    const meta = JSON.parse(repaymentTxn(ledgerId).metadata_json);
    expect(meta.routed.by_transfer).toEqual([
      expect.objectContaining({ debt_currency: "USD", value: 101 }),
    ]);
  });

  it("an LBP OMT send keeps its cap in LBP across a rate change", () => {
    seedTransferDebt(db, { clientId: 7, provider: "OMT", lbp: 9_000_000 });
    let before = drawers(db);
    repay({ lbp: 4_450_000, legs: cashUsd(50) });
    expect(drawerDelta(before, drawers(db))).toEqual({ "OMT_System|USD": 50 });

    // Remaining cap 4,550,000 LBP. At 95,000 a $50 payment is worth
    // 4,750,000 LBP, so only 4,550,000 LBP ($47.89) may be routed.
    before = drawers(db);
    repay({ lbp: 4_550_000, legs: cashUsd(50), rate: 95_000 });
    expect(drawerDelta(before, drawers(db))).toEqual({
      "OMT_System|USD": 47.89,
      "General|USD": 2.11,
    });
  });
});

describe("T017 — a refunded repayment stops counting as routed", () => {
  it("route, refund, repay → the new repayment routes in full again", () => {
    seedTransferDebt(db, { clientId: 7, provider: "OMT", usd: 101 });
    const first = repay({ usd: 50, legs: cashUsd(50) });
    getTransactionRepository().refundTransaction(repaymentTxn(first).id, 1);
    const before = drawers(db);
    repay({ usd: 101, legs: cashUsd(101) });
    expect(drawerDelta(before, drawers(db))).toEqual({ "OMT_System|USD": 101 });
  });
});
