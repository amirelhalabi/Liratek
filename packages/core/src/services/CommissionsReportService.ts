/**
 * Commissions Report Service — Profits page "Commissions" tab
 * (OWNER_NOTES_2026-09-21.md §6, lane LC: PA-1.1, PA-1.6, PA-2.7, PA-3.4,
 * PA-4.17, PA-4.18).
 *
 * This is a REPORTING-only composition. It writes nothing, posts nothing,
 * changes no stored profit stamp — it only reads two ALREADY-CORRECT,
 * ALREADY-GATED sources and combines them into one per-provider view:
 *
 *  - `ProfitRepository.getFinancialSettledByProvider(fromDt, toDt)` — the
 *    SAME query the Overview/By-Module tabs use for "realized commission by
 *    provider". Reused verbatim (rule 14 — never re-derive a second copy of
 *    a recognition predicate): it already applies `fsStampRecognized`
 *    (PA-0.1's `is_settled = 1 OR commission_model = 1`), `notRefunded`,
 *    `notDebtPending`/`allocationNotDebtPending`, `t.status = 'ACTIVE'`, and
 *    `partnerCoverageRatio` weighting, AND already includes settlement-time
 *    (model-1) commission via its `settlement_commission_allocations` UNION
 *    arm — so PA-2.7 ("Realized excludes every settled model-1 commission")
 *    and PA-3.4 ("Commissions applies no recognition gates at all") are both
 *    closed by REUSE, not by a new hand-rolled query. It is also genuinely
 *    date-range aware (PA-4.17), unlike `FinancialServiceRepository
 *    .getAnalytics`'s hardcoded "today"/"this month" buckets — which is why
 *    this service does not call `getAnalytics` at all for the realized
 *    figure.
 *
 *  - `FinancialServiceRepository.getUnsettledSummaryByProvider()` — the
 *    SAME query the Suppliers "Pending Settlement" banner and the Dashboard
 *    use. It already returns BOTH `pending_commission_usd` and
 *    `pending_commission_lbp` per provider (PA-1.6 is a pure UI bug: the old
 *    Commissions pie/column read only the `_usd` field despite the `_lbp`
 *    field already being there). This method is a CURRENT-STATE snapshot —
 *    "how much is unsettled right now" — not a dated flow, matching the
 *    same "pending means as of now" convention the owner already established
 *    for the Pending tab (PA-3.8: "Pending hides unpaid sales older than the
 *    date range... show all outstanding receivables regardless of range").
 *    So this service does NOT filter it by [from, to] — PA-4.17's "or label
 *    each window explicitly" branch is the one taken here; the UI names the
 *    pending figures "as of now" instead of silently mis-scoping a snapshot
 *    to a date range it was never computed against.
 *
 * Both are combined and filtered to {@link COMMISSION_REPORT_PROVIDERS} —
 * closing PA-1.1's "no provider filter... counts mobile margins as
 * commission" (iPick/Katsh/BOB are cost/price-flow providers; their
 * price-cost margin is real profit but is NOT a commission, and never
 * belonged in this tab).
 *
 * `FinancialServiceRepository.getAnalytics`/`getUnsettledSummaryByProvider`
 * are DELIBERATELY left untouched by this file: every fix above is achieved
 * by composing their EXISTING, already-correct outputs (or, for realized
 * commission, `ProfitRepository`'s already-correct output) rather than
 * editing either method's SQL — the routes that already call `getAnalytics`
 * (`omt:get-analytics`, `GET /api/services/analytics`, for the Services and
 * Recharge pages) and `getUnsettledSummaryByProvider`
 * (`suppliers:unsettled-summary`, `GET /api/suppliers/unsettled-summary`)
 * keep their exact current behaviour — this is a new, additive read path.
 *
 * Rule 14 note: `ProfitRepository`'s own `COMMISSION_PROVIDERS` constant
 * (the identical 5-provider list) is NOT exported from that file, and this
 * service's lane is expressly forbidden from editing ProfitRepository.ts —
 * even to add an `export` keyword. Round-2 review (LC-3): the canonical
 * 5-provider list now lives in `constants/commissionProviders.ts`
 * (`COMMISSION_PROVIDERS`) instead of being hand-copied here a second time —
 * see that module's own doc comment for why `ProfitRepository.ts`'s inline
 * SQL literal still can't be pointed at it directly from this lane, and for
 * the follow-up left for whichever lane next has permission to touch that
 * file.
 *
 * `COMMISSION_REPORT_PROVIDERS` below is `COMMISSION_PROVIDERS` itself —
 * BINANCE was excluded in round 2 (LC-1) and is included again since
 * LIRA-268 made its USDT rows report as USD; see the comment above the
 * constant.
 */

import {
  getProfitRepository,
  type ProfitRepository,
} from "../repositories/ProfitRepository.js";
import {
  getFinancialServiceRepository,
  type FinancialServiceRepository,
} from "../repositories/FinancialServiceRepository.js";
import { COMMISSION_PROVIDERS } from "../constants/commissionProviders.js";

/**
 * BINANCE (LIRA-268 follow-up) — INCLUDED, valued USDT 1:1 as US dollars.
 *
 * History: round-2 review (LC-1) excluded BINANCE here because its
 * `financial_services` rows are stored with `currency = 'USDT'`, which every
 * Profits query bucketed into neither USD nor LBP, so this tab could only
 * have shown a misleading "$0.00". LIRA-268 fixed that at the source:
 * `ProfitRepository.getFinancialSettledByProvider` — the ONE query this tab
 * reads realized commission from, shared with the Overview / By Module —
 * now buckets by `fsReportingCurrency` (USDT reports as USD) and adds the
 * fee a USDT row's stamp leaves out (`unstampedUsdtCommission`). Including
 * BINANCE is therefore pure reuse (rule 14): no SQL here, and the Binance
 * figure on this tab agrees with the Overview by construction
 * (`ProfitService.binanceProfitVisible.test.ts` pins that they agree).
 *
 * `getUnsettledSummaryByProvider`'s pending figures bucket `currency !=
 * 'LBP'` into USD, which is the same USDT-as-USD reading. A Binance row is
 * born `is_settled = 1` today (`isPendingSupplierSettlement` returns false
 * for BINANCE), so it normally contributes nothing there.
 *
 * The `excludedProviders` plumbing is kept (empty map) so a future provider
 * this tab genuinely cannot value can be captioned instead of silently
 * dropped — the UI already renders that caption when the list is non-empty.
 */
const EXCLUDED_COMMISSION_PROVIDER_REASONS: Readonly<Record<string, string>> =
  {};

/**
 * Providers this report renders a realized/pending figure for — every
 * `COMMISSION_PROVIDERS` member (constants/commissionProviders.ts),
 * BINANCE included since LIRA-268 (see the comment above).
 */
export const COMMISSION_REPORT_PROVIDERS = COMMISSION_PROVIDERS;

export type CommissionReportProvider =
  (typeof COMMISSION_REPORT_PROVIDERS)[number];

function isCommissionReportProvider(
  provider: string,
): provider is CommissionReportProvider {
  return (COMMISSION_REPORT_PROVIDERS as readonly string[]).includes(
    provider,
  );
}

/** One provider excluded from `byProvider` even though it appeared in a
 *  source query — with a human-readable reason the UI captions instead of
 *  silently dropping the provider with no explanation (LC-1). */
export interface ExcludedCommissionProvider {
  provider: string;
  reason: string;
}

/** One provider's row in the Commissions tab (PA-4.18 — one row per
 *  provider, both currencies as sibling fields, never a provider+currency
 *  pair that a naive `{[provider]: row}` map could collide on). */
export interface CommissionProviderRow {
  provider: CommissionReportProvider;
  /** Realized commission (legacy embedded + at-settlement, gated —
   *  see this file's header). */
  realized_usd: number;
  realized_lbp: number;
  /** The revenue behind the realized commission — what "Revenue by
   *  Provider" should plot (PA-4.18: it used to plot `commission`). */
  revenue_usd: number;
  revenue_lbp: number;
  /** Count of financial-service rows contributing to `realized_*` in
   *  [from, to] (partner-coverage-weighted — see getFinancialSettledByProvider). */
  count: number;
  /** Unsettled commission, as of NOW (not scoped to [from, to] — see this
   *  file's header). */
  pending_usd: number;
  pending_lbp: number;
  /** Gross amount currently owed the provider (SUPPLIER_OWED_EXPR), as of
   *  now. */
  total_owed_usd: number;
  total_owed_lbp: number;
  /** Count of currently-unsettled model-1 rows whose real commission won't
   *  exist until settlement (D15). */
  awaiting_settlement_count: number;
  /** Count of currently-unsettled BILL rows for this provider. */
  bill_count: number;
}

export interface CommissionsReport {
  from: string;
  to: string;
  realized_usd: number;
  realized_lbp: number;
  revenue_usd: number;
  revenue_lbp: number;
  pending_usd: number;
  pending_lbp: number;
  total_owed_usd: number;
  total_owed_lbp: number;
  awaiting_settlement_count: number;
  bill_count: number;
  /** Sorted by provider name — stable render order, no reliance on
   *  whatever order the two underlying queries happened to return. */
  byProvider: CommissionProviderRow[];
  /** Commission providers (LC-1) that had activity in [from,to]/as-of-now
   *  but were left out of `byProvider` because this report cannot currently
   *  render a truthful figure for them — never silently dropped. Empty when
   *  no excluded provider has any activity, so a shop that never touches
   *  Binance sees no permanent caption. Optional on the TYPE only for
   *  backward-compatible test fixtures written before this field existed;
   *  `getReport()` always populates it (possibly `[]`). */
  excludedProviders?: ExcludedCommissionProvider[];
}

function emptyRow(provider: CommissionReportProvider): CommissionProviderRow {
  return {
    provider,
    realized_usd: 0,
    realized_lbp: 0,
    revenue_usd: 0,
    revenue_lbp: 0,
    count: 0,
    pending_usd: 0,
    pending_lbp: 0,
    total_owed_usd: 0,
    total_owed_lbp: 0,
    awaiting_settlement_count: 0,
    bill_count: 0,
  };
}

export class CommissionsReportService {
  private profitRepo: ProfitRepository;
  private fsRepo: FinancialServiceRepository;

  constructor(
    profitRepo: ProfitRepository = getProfitRepository(),
    fsRepo: FinancialServiceRepository = getFinancialServiceRepository(),
  ) {
    this.profitRepo = profitRepo;
    this.fsRepo = fsRepo;
  }

  /**
   * `from`/`to` are `YYYY-MM-DD` (the Profits page date picker's own
   * format) — converted to the `datetime(...)`-comparable bounds the same
   * way every other `ProfitService` method does (`${from} 00:00:00` /
   * `${to} 23:59:59`), so the realized figures genuinely respect the
   * picker (PA-4.17). The pending figures deliberately do not use these
   * bounds at all — see this file's header.
   */
  getReport(from: string, to: string): CommissionsReport {
    const fromDt = `${from} 00:00:00`;
    const toDt = `${to} 23:59:59`;

    const settledRows = this.profitRepo.getFinancialSettledByProvider(
      fromDt,
      toDt,
    );
    const unsettledRows = this.fsRepo.getUnsettledSummaryByProvider();

    const rowsByProvider = new Map<
      CommissionReportProvider,
      CommissionProviderRow
    >();
    // LC-1: a provider that is a real commission provider
    // (COMMISSION_PROVIDERS) but NOT a reportable one
    // (COMMISSION_REPORT_PROVIDERS, e.g. BINANCE) and has activity in
    // either source is surfaced here instead of silently dropped — a Set so
    // a provider appearing in BOTH sources (settled AND unsettled) is
    // captioned once, not twice.
    const excludedProviderNames = new Set<string>();

    for (const settled of settledRows) {
      if (!isCommissionReportProvider(settled.provider)) {
        if (settled.provider in EXCLUDED_COMMISSION_PROVIDER_REASONS) {
          excludedProviderNames.add(settled.provider);
        }
        continue;
      }
      const row = emptyRow(settled.provider);
      row.realized_usd = settled.profit_usd;
      row.realized_lbp = settled.profit_lbp;
      row.revenue_usd = settled.revenue_usd;
      row.revenue_lbp = settled.revenue_lbp;
      row.count = settled.count;
      rowsByProvider.set(settled.provider, row);
    }

    for (const unsettled of unsettledRows) {
      if (!isCommissionReportProvider(unsettled.provider)) {
        if (unsettled.provider in EXCLUDED_COMMISSION_PROVIDER_REASONS) {
          excludedProviderNames.add(unsettled.provider);
        }
        continue;
      }
      const row =
        rowsByProvider.get(unsettled.provider) ?? emptyRow(unsettled.provider);
      row.pending_usd = unsettled.pending_commission_usd;
      row.pending_lbp = unsettled.pending_commission_lbp;
      row.total_owed_usd = unsettled.total_owed_usd;
      row.total_owed_lbp = unsettled.total_owed_lbp;
      row.awaiting_settlement_count = unsettled.awaiting_settlement_count;
      row.bill_count = unsettled.bill_count;
      rowsByProvider.set(unsettled.provider, row);
    }

    const byProvider = Array.from(rowsByProvider.values()).sort((a, b) =>
      a.provider.localeCompare(b.provider),
    );

    const excludedProviders: ExcludedCommissionProvider[] = Array.from(
      excludedProviderNames,
    )
      .sort()
      .map((provider) => ({
        provider,
        reason: EXCLUDED_COMMISSION_PROVIDER_REASONS[provider],
      }));

    const totals = byProvider.reduce(
      (acc, row) => ({
        realized_usd: acc.realized_usd + row.realized_usd,
        realized_lbp: acc.realized_lbp + row.realized_lbp,
        revenue_usd: acc.revenue_usd + row.revenue_usd,
        revenue_lbp: acc.revenue_lbp + row.revenue_lbp,
        pending_usd: acc.pending_usd + row.pending_usd,
        pending_lbp: acc.pending_lbp + row.pending_lbp,
        total_owed_usd: acc.total_owed_usd + row.total_owed_usd,
        total_owed_lbp: acc.total_owed_lbp + row.total_owed_lbp,
        awaiting_settlement_count:
          acc.awaiting_settlement_count + row.awaiting_settlement_count,
        bill_count: acc.bill_count + row.bill_count,
      }),
      {
        realized_usd: 0,
        realized_lbp: 0,
        revenue_usd: 0,
        revenue_lbp: 0,
        pending_usd: 0,
        pending_lbp: 0,
        total_owed_usd: 0,
        total_owed_lbp: 0,
        awaiting_settlement_count: 0,
        bill_count: 0,
      },
    );

    return { from, to, ...totals, byProvider, excludedProviders };
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let commissionsReportServiceInstance: CommissionsReportService | null = null;

export function getCommissionsReportService(): CommissionsReportService {
  if (!commissionsReportServiceInstance) {
    commissionsReportServiceInstance = new CommissionsReportService();
  }
  return commissionsReportServiceInstance;
}

/** Reset the singleton (for testing) */
export function resetCommissionsReportService(): void {
  commissionsReportServiceInstance = null;
}
