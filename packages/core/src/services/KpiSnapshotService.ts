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
  | "marker_set"
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
      subscriptions: deps?.subscriptions ?? getSubscriptionService(),
    };
  }

  /**
   * Saves the Beirut month that ended before `now`, if it is due and the
   * shop has the feature switched on. Idempotent:
   * "nothing to do" is a normal result, never an error. The very first run for
   * a shop only records the current month as its start, so a mid-month deploy
   * never saves today's balances as last month's.
   */
  captureDue(now: Date): { captured: string | null; reason: CaptureReason } {
    const { snapshots, settings, subscriptions } = this.deps;
    // Super admin switches this on per shop (Plan window → Features). Off
    // means off: nothing saved, and the start clock does not run either.
    if (
      !subscriptions.isFeatureEnabled(getCurrentTenantId(), "kpi_snapshots")
    ) {
      return { captured: null, reason: "disabled" };
    }
    const currentMonth = beirutMonth(now);
    const since = settings.getSettingValue(KPI_SNAPSHOTS_SINCE_KEY);
    if (!since) {
      settings.upsertSetting(KPI_SNAPSHOTS_SINCE_KEY, currentMonth);
      return { captured: null, reason: "marker_set" };
    }

    const month = previousMonth(currentMonth);
    if (month < since) return { captured: null, reason: "not_due" };
    if (snapshots.exists(month)) return { captured: null, reason: "exists" };

    const rates = snapshots.getUsdLbpRates();
    const saved = snapshots.insertSnapshot({
      month,
      taken_at: toUtcSqlTimestamp(now),
      is_late: snapshots.hasTransactionsSince(
        beirutMonthStartUtc(currentMonth),
      ),
      usd_lbp_buy_rate: rates.buy,
      usd_lbp_sell_rate: rates.sell,
      values: this.measure(),
    });
    if (!saved) return { captured: null, reason: "exists" };
    kpiLogger.info({ month }, "Monthly KPI snapshot saved");
    return { captured: month, reason: "captured" };
  }

  listSnapshots(): KpiSnapshotView[] {
    return this.deps.snapshots.listSnapshots();
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
