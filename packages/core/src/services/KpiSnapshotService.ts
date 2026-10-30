/**
 * LIRA-364 — the monthly KPI snapshot. Once per Beirut month, saves the shop's
 * month-end balances: the six "owes" directions between the shop and its
 * customers, suppliers and partners, stock value and carrier credits, each in
 * USD and LBP, never combined. Every figure comes from the balance the app
 * already shows for it (rule 14); this service only splits and assembles
 * (rule 13). Called by the web server's hourly sweep for every shop and by the
 * desktop app at start-up; nothing else can create a snapshot.
 */
import type { KpiKey, KpiSnapshotView } from "../constants/kpiDefinitions.js";
import {
  getKpiSnapshotRepository,
  type KpiSnapshotRepository,
} from "../repositories/KpiSnapshotRepository.js";
import {
  getDebtRepository,
  type DebtRepository,
} from "../repositories/DebtRepository.js";
import {
  getSupplierRepository,
  type SupplierRepository,
} from "../repositories/SupplierRepository.js";
import {
  getPartnerRepository,
  type PartnerRepository,
} from "../repositories/PartnerRepository.js";
import {
  getProductRepository,
  type ProductRepository,
} from "../repositories/ProductRepository.js";
import {
  getCarrierLineRepository,
  type CarrierLineRepository,
} from "../repositories/CarrierLineRepository.js";
import {
  getSettingsRepository,
  type SettingsRepository,
} from "../repositories/SettingsRepository.js";
import {
  getRateRepository,
  type RateRepository,
} from "../repositories/RateRepository.js";
import { splitBySign } from "../utils/kpiSplit.js";
import {
  beirutMonth,
  beirutMonthStartUtc,
  previousMonth,
} from "../utils/kpiMonth.js";
import { toUtcSqlTimestamp } from "../utils/trialCalendar.js";
import { kpiLogger } from "../utils/logger.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import {
  getSubscriptionService,
  type SubscriptionService,
} from "./SubscriptionService.js";

/** The first month a shop may be snapshotted (`YYYY-MM`), set by its first run. */
export const KPI_SNAPSHOTS_SINCE_KEY = "kpi_snapshots_since";

export type CaptureReason =
  | "disabled"
  | "started"
  | "not_due"
  | "exists"
  | "captured";

export interface KpiSnapshotDeps {
  snapshots: KpiSnapshotRepository;
  debts: DebtRepository;
  suppliers: SupplierRepository;
  partners: PartnerRepository;
  products: ProductRepository;
  carrierLines: CarrierLineRepository;
  settings: SettingsRepository;
  rates: RateRepository;
  subscriptions: SubscriptionService;
}

export class KpiSnapshotService {
  private readonly deps: KpiSnapshotDeps;

  constructor(deps?: Partial<KpiSnapshotDeps>) {
    this.deps = {
      snapshots: deps?.snapshots ?? getKpiSnapshotRepository(),
      debts: deps?.debts ?? getDebtRepository(),
      suppliers: deps?.suppliers ?? getSupplierRepository(),
      partners: deps?.partners ?? getPartnerRepository(),
      products: deps?.products ?? getProductRepository(),
      carrierLines: deps?.carrierLines ?? getCarrierLineRepository(),
      settings: deps?.settings ?? getSettingsRepository(),
      rates: deps?.rates ?? getRateRepository(),
      subscriptions: deps?.subscriptions ?? getSubscriptionService(),
    };
  }

  /**
   * Saves the Beirut month that ended before `now`, if it is due and the
   * shop has the feature switched on. Idempotent: "nothing to do" is a normal
   * result, never an error.
   *
   * The shop's first month (the month it was switched on) is saved straight
   * away with today's balances, so the page is never empty for a month; when
   * that month ends, its month-end balances replace them in the same column.
   * Every later month is saved once, at its month end.
   */
  captureDue(now: Date): { captured: string | null; reason: CaptureReason } {
    const { snapshots, settings } = this.deps;
    // Super admin switches this on per shop (Plan window → Features). Off
    // means off: nothing saved, and the start clock does not run either.
    if (!this.isEnabled()) {
      return { captured: null, reason: "disabled" };
    }
    const currentMonth = beirutMonth(now);
    const currentMonthStart = beirutMonthStartUtc(currentMonth);
    let since = settings.getSettingValue(KPI_SNAPSHOTS_SINCE_KEY);
    if (!since) {
      since = currentMonth;
      settings.upsertSetting(KPI_SNAPSHOTS_SINCE_KEY, since);
    }

    const month = previousMonth(currentMonth);
    if (month >= since) {
      // A save taken before this month began is the early first save of the
      // start month: the month-end balances replace it. One taken after is
      // already the month end.
      const takenAt = snapshots.getTakenAt(month);
      if (takenAt !== null && takenAt >= currentMonthStart) {
        return { captured: null, reason: "exists" };
      }
      this.save(month, now, {
        isLate: snapshots.hasTransactionsSince(currentMonthStart),
        replace: takenAt !== null,
      });
      kpiLogger.info({ month }, "Monthly KPI snapshot saved");
      return { captured: month, reason: "captured" };
    }

    if (currentMonth !== since) return { captured: null, reason: "not_due" };
    if (snapshots.getTakenAt(currentMonth) !== null) {
      return { captured: null, reason: "exists" };
    }
    this.save(currentMonth, now, { isLate: false, replace: false });
    kpiLogger.info({ month: currentMonth }, "First monthly KPI snapshot saved");
    return { captured: currentMonth, reason: "started" };
  }

  private save(
    month: string,
    now: Date,
    opts: { isLate: boolean; replace: boolean },
  ): void {
    // The one owner of exchange_rates reads (FR-021a guard); nulls when unset.
    const lbp = this.deps.rates.findByCode("LBP");
    this.deps.snapshots.saveSnapshot(
      {
        month,
        taken_at: toUtcSqlTimestamp(now),
        is_late: opts.isLate,
        usd_lbp_buy_rate: lbp?.buy_rate ?? null,
        usd_lbp_sell_rate: lbp?.sell_rate ?? null,
        values: this.measure(),
      },
      opts.replace,
    );
  }

  listSnapshots(): KpiSnapshotView[] {
    return this.deps.snapshots.listSnapshots();
  }

  /**
   * What the Monthly progress page reads, on both transports. The ONE place
   * the per-shop switch gates the read: while off, the page and its menu
   * item hide and no month is returned, even ones saved earlier.
   */
  getProgress(): { enabled: boolean; snapshots: KpiSnapshotView[] } {
    if (!this.isEnabled()) return { enabled: false, snapshots: [] };
    return { enabled: true, snapshots: this.listSnapshots() };
  }

  private isEnabled(): boolean {
    return this.deps.subscriptions.isFeatureEnabled(
      getCurrentTenantId(),
      "kpi_snapshots",
    );
  }

  /** The eight KPIs as they stand right now. */
  private measure(): Record<KpiKey, { usd: number; lbp: number }> {
    const { debts, suppliers, partners, products, carrierLines } = this.deps;

    // Customers and partners: positive = they owe the shop.
    const customers = splitBySign(debts.getClientBalances());
    const partnerSplit = splitBySign(
      partners
        .getAllBalances(true)
        .map((p) => ({ usd: Number(p.usd), lbp: Number(p.lbp) })),
    );
    // Suppliers: positive = the shop owes them.
    const supplierSplit = splitBySign(suppliers.getCounterpartyBalances());

    const stockUsd = products.getStockStats().stock_budget_usd;
    const creditsUsd =
      carrierLines.getCarrierCreditsSum("mtc") +
      carrierLines.getCarrierCreditsSum("alfa");

    return {
      customers_owe_shop: customers.positive,
      shop_owes_customers: customers.negative,
      partners_owe_shop: partnerSplit.positive,
      shop_owes_partners: partnerSplit.negative,
      shop_owes_suppliers: supplierSplit.positive,
      suppliers_owe_shop: supplierSplit.negative,
      stock_value: { usd: roundUsd(stockUsd), lbp: 0 },
      carrier_credits: { usd: roundUsd(creditsUsd), lbp: 0 },
    };
  }
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

let instance: KpiSnapshotService | null = null;
export function getKpiSnapshotService(): KpiSnapshotService {
  if (!instance) instance = new KpiSnapshotService();
  return instance;
}
export function resetKpiSnapshotService(): void {
  instance = null;
}
