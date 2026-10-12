/**
 * LIRA-310 follow-up (owner decision 2026-10-12) — a session basket's Waive
 * (`WAIVED_SHORTFALL`, amount 0, profit −waived) is its OWN "Waived" line on
 * the Profits page, never folded into "Kept Change".
 *
 * Owner example: Sales $120, Kept Change $2, Waived −$3, Total $119 — the
 * totals do not move, only the split does.
 *
 * A single basket can never hold both (the checkout refuses kept change
 * together with a waive), so the fixture uses two baskets: one where the
 * shop kept $2 of change, one where it waived $3.
 *
 * Rule 17: written before ProfitRepository/ProfitService learned a separate
 * waived figure; the red run is recorded in specs/310-waive-everywhere/
 * tasks.md (follow-up section).
 */
import type Database from "better-sqlite3";
import {
  installDebtItemTestDb,
  uninstallDebtItemTestDb,
} from "../testHelpers/debtItemDb";
import { SessionCheckoutService } from "../../services/SessionCheckoutService";
import {
  CustomerSessionRepository,
  resetCustomerSessionRepository,
} from "../CustomerSessionRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetClientRepository } from "../ClientRepository";
import { resetFinancialServiceRepository } from "../FinancialServiceRepository";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetSettingsRepository } from "../SettingsRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { resetSessionPaymentRepository } from "../SessionPaymentRepository";
import { resetSalesRepository } from "../SalesRepository";
import { resetProfitRepository } from "../ProfitRepository";
import { resetSessionPaymentService } from "../../services/SessionPaymentService";
import {
  getProfitService,
  resetProfitService,
  type ProfitByModule,
} from "../../services/ProfitService";
import {
  classifyProfitModuleRow,
  PROFIT_ROW_CLASS,
} from "../../constants/profitRowClass";
import { hasModuleDetailSupport } from "../../constants/profitModuleDetailSupport";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

const RATE = 89_000;
const FROM = "2000-01-01";
const TO = "2100-12-31";

let db: Database.Database;
let service: SessionCheckoutService;
let sessionRepo: CustomerSessionRepository;

function resetAll(): void {
  resetTransactionRepository();
  resetClientRepository();
  resetFinancialServiceRepository();
  resetSupplierRepository();
  resetSettingsRepository();
  resetPaymentMethodRepository();
  resetCustomerSessionRepository();
  resetSessionPaymentRepository();
  resetSessionPaymentService();
  resetSalesRepository();
  resetProfitRepository();
  resetProfitService();
}

beforeEach(() => {
  db = installDebtItemTestDb();
  initFixedTenantContext(1);
  resetAll();
  service = new SessionCheckoutService();
  sessionRepo = new CustomerSessionRepository(db);
});
afterEach(() => {
  resetAll();
  resetTenantContext();
  uninstallDebtItemTestDb(db);
});

/** A $20 OMT SEND with no fee or commission: net charge exactly $20. */
function sendItem(id: string) {
  return {
    id,
    module: "omt",
    label: "OMT Send",
    amount: 20,
    currency: "USD",
    formData: {
      provider: "OMT",
      serviceType: "SEND",
      amount: 20,
      currency: "USD",
      commission: 0,
      omtFee: 0,
    },
    ipcChannel: "financial:create",
  };
}

function newSession(name: string): number {
  return sessionRepo.createSession({
    customer_name: name,
    started_by: "admin",
    user_id: 1,
  });
}

/** $22 paid on $20, the shop keeps the $2. */
async function keptBasket(): Promise<number> {
  const sessionId = newSession("Kept Customer");
  const r = await service.checkout(
    {
      sessionId,
      cartItems: [sendItem("cart-kept")],
      exchangeRate: RATE,
      userId: 1,
      payments: [
        { method: "CASH", currency_code: "USD", amount: 22, direction: "IN" },
      ],
      kept_change_usd: 2,
    },
    { username: "admin" },
  );
  expect(r).toMatchObject({ success: true });
  return sessionId;
}

/** $17 paid on $20, the shop waives the $3. */
async function waivedBasket(): Promise<number> {
  const sessionId = newSession("Waived Customer");
  const r = await service.checkout(
    {
      sessionId,
      cartItems: [sendItem("cart-waived")],
      exchangeRate: RATE,
      userId: 1,
      payments: [
        { method: "CASH", currency_code: "USD", amount: 17, direction: "IN" },
      ],
      waived_usd: 3,
    },
    { username: "admin" },
  );
  expect(r).toMatchObject({ success: true });
  return sessionId;
}

interface Snapshot {
  gross: { usd: number; lbp: number };
  byDate: number;
  byUser: number;
  byClient: number;
  byModuleTotal: number;
}

function snapshot(): Snapshot {
  resetProfitRepository();
  resetProfitService();
  const svc = getProfitService();
  const t = svc.getSummary(FROM, TO).totals;
  const sum = (rows: { profit_usd: number }[]) =>
    rows.reduce((s, r) => s + r.profit_usd, 0);
  return {
    gross: { usd: t.gross_profit_usd, lbp: t.gross_profit_lbp },
    byDate: sum(svc.getByDate(FROM, TO)),
    byUser: sum(svc.getByUser(FROM, TO)),
    byClient: sum(svc.getByClient(FROM, TO, 100)),
    byModuleTotal: sum(svc.getByModule(FROM, TO)),
  };
}

function moduleRow(key: string): ProfitByModule | undefined {
  resetProfitRepository();
  resetProfitService();
  return getProfitService()
    .getByModule(FROM, TO)
    .find((r) => r.module === key);
}

type SummaryWithWaived = ReturnType<
  ReturnType<typeof getProfitService>["getSummary"]
> & {
  waived?: { profit_usd: number; profit_lbp: number; count: number };
};

function summary(): SummaryWithWaived {
  resetProfitRepository();
  resetProfitService();
  return getProfitService().getSummary(FROM, TO) as SummaryWithWaived;
}

describe("Profits — Waived is its own line (LIRA-310 follow-up)", () => {
  it("kept $2 + waived $3: Kept Change 2, Waived −3, every total moves by exactly −1", async () => {
    const before = snapshot();
    await keptBasket();
    await waivedBasket();

    // Overview summary: the split.
    const s = summary();
    expect(s.debt_repayments.profit_usd).toBeCloseTo(2, 6);
    expect(s.waived).toBeDefined();
    expect(s.waived!.profit_usd).toBeCloseTo(-3, 6);
    expect(s.waived!.profit_lbp).toBe(0);
    expect(s.waived!.count).toBe(1);

    // By Module: two rows.
    expect(moduleRow("KEPT_CHANGE")?.profit_usd).toBeCloseTo(2, 6);
    const waived = moduleRow("WAIVED");
    expect(waived).toBeDefined();
    expect(waived!.label).toBe("Waived");
    expect(waived!.profit_usd).toBeCloseTo(-3, 6);
    expect(waived!.revenue_usd).toBe(0);
    expect(waived!.cost_usd).toBe(0);
    expect(waived!.count).toBe(1);

    // Totals unchanged by the split: −1 net everywhere.
    const after = snapshot();
    expect(after.gross.usd - before.gross.usd).toBeCloseTo(-1, 6);
    expect(after.gross.lbp - before.gross.lbp).toBeCloseTo(0, 6);
    expect(after.byDate - before.byDate).toBeCloseTo(-1, 6);
    expect(after.byUser - before.byUser).toBeCloseTo(-1, 6);
    expect(after.byClient - before.byClient).toBeCloseTo(-1, 6);
    expect(after.byModuleTotal - before.byModuleTotal).toBeCloseTo(-1, 6);
  });

  it("drill-downs: Waived lists the −3 row; Kept Change no longer lists it", async () => {
    await keptBasket();
    await waivedBasket();
    resetProfitRepository();
    resetProfitService();
    const svc = getProfitService();

    const kept = svc.getModuleDetail("KEPT_CHANGE", FROM, TO);
    expect(kept.counted_total_profit_usd).toBeCloseTo(2, 6);
    expect(kept.counted.map((r) => r.detail)).not.toContain(
      "Waived at basket checkout",
    );

    const waived = svc.getModuleDetail("WAIVED", FROM, TO);
    expect(waived.module).toBe("WAIVED");
    expect(waived.counted).toHaveLength(1);
    expect(waived.counted[0].profit_usd).toBeCloseTo(-3, 6);
    expect(waived.counted[0].counterpart).toBe("Waived Customer");
    expect(waived.counted_total_profit_usd).toBeCloseTo(-3, 6);
  });

  it("WAIVED is a profit-only row with a drill-down (shared browser-safe lists)", () => {
    expect(classifyProfitModuleRow("WAIVED")).toBe(
      PROFIT_ROW_CLASS.PROFIT_ONLY,
    );
    expect(hasModuleDetailSupport("WAIVED")).toBe(true);
  });

  it.each(["void", "refund"] as const)(
    "basket %s of the waived basket: Waived nets to 0, Kept Change stays 2",
    async (how) => {
      await keptBasket();
      const before = snapshot();
      const waivedSession = await waivedBasket();
      // Not vacuous: the waive is on its own line before the reversal.
      expect(summary().waived?.profit_usd).toBeCloseTo(-3, 6);

      const txnRepo = getTransactionRepository();
      if (how === "void") txnRepo.voidSessionBasket(waivedSession, 1);
      else txnRepo.refundSessionBasket(waivedSession, 1);

      if (how === "refund") {
        // The refund path writes a REFUND row that reverses the waive —
        // the branch of the Waived predicate that must net it to 0.
        const rev = db
          .prepare(
            `SELECT r.profit_usd FROM transactions r
               JOIN transactions w ON w.id = r.reverses_id
              WHERE r.type = 'REFUND' AND w.type = 'WAIVED_SHORTFALL'`,
          )
          .get() as { profit_usd: number } | undefined;
        expect(rev?.profit_usd).toBeCloseTo(3, 6);
      }

      const s = summary();
      expect(s.debt_repayments.profit_usd).toBeCloseTo(2, 6);
      expect(s.waived?.profit_usd ?? 0).toBeCloseTo(0, 6);
      expect(s.waived?.profit_lbp ?? 0).toBeCloseTo(0, 6);
      expect(moduleRow("WAIVED")).toBeUndefined();
      expect(moduleRow("KEPT_CHANGE")?.profit_usd).toBeCloseTo(2, 6);

      const after = snapshot();
      expect(after.gross.usd).toBeCloseTo(before.gross.usd, 6);
      expect(after.byDate).toBeCloseTo(before.byDate, 6);
      expect(after.byUser).toBeCloseTo(before.byUser, 6);
      expect(after.byClient).toBeCloseTo(before.byClient, 6);
    },
  );
});
