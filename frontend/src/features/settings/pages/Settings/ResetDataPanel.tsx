import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useApi } from "@liratek/ui";
import { formatNumber } from "@liratek/ui/i18n/format";
import type { DatabaseResetPreview } from "@liratek/core";
import { getApiErrorMessage } from "@/shared/utils/apiErrorMessage";
import { ResetDataModal } from "./ResetDataModal";

/**
 * Settings › Reset Data (LIRA-165). No extra role gate here — the whole
 * `/settings` route is already admin-gated (App.tsx wraps it in an
 * admin-only ProtectedRoute), same reasoning as ProfitsPasswordPanel's own
 * comment next to this tab.
 */

/**
 * Readable groupings for the raw table names `DatabaseResetPreview.counts`
 * returns. `packages/core/src/constants/resetTables.ts` is the single
 * source of truth for WHICH tables get wiped (rule 14) — this map is
 * presentation-only, translating those names for a non-technical shop owner.
 * A table not listed here still shows up under "Other" (see `groupCounts`
 * below), so a future addition to the wipe list never silently disappears
 * from the preview just because this component wasn't updated to name it.
 */
/** Each group's id names its label in the `settings` catalog
 *  (`reset.group.<id>`); the table names are data. */
type ResetGroupId =
  | "transactions"
  | "payments"
  | "debts"
  | "clients"
  | "stock"
  | "recharges"
  | "carrierLines"
  | "exchange"
  | "loto"
  | "maintenance"
  | "warranty"
  | "expenses"
  | "audit"
  | "other";

const TABLE_GROUPS: Array<{ id: ResetGroupId; tables: string[] }> = [
  {
    id: "transactions",
    tables: [
      "transactions",
      "sale_items",
      "sales",
      "customer_sessions",
      "customer_session_transactions",
      // NOT `sessions` — that is the LOGIN session table, which a reset
      // keeps (resetTables.ts RESET_KEEP_TABLES) so nobody is signed out.
      "session_cart_items",
    ],
  },
  {
    id: "payments",
    tables: [
      "payments",
      "drawer_cashouts",
      "drawer_topups",
      "drawer_transfers",
      "daily_closings",
      "daily_closing_amounts",
      "daily_closing_carrier_lines",
    ],
  },
  {
    id: "debts",
    tables: [
      "debt_ledger",
      // Ledgers only — the partner / supplier rows themselves are KEPT
      // (resetTables.ts RESET_KEEP_TABLES); their balances read 0.
      "supplier_ledger",
      "partner_ledger",
      "hold_money",
      "hold_money_pickups",
    ],
  },
  {
    id: "clients",
    tables: ["clients"],
  },
  {
    // Products, categories and the product-supplier names are KEPT (the
    // products with stock and minimum stock set to 0 — RESET_ZERO_TABLES),
    // so only stock and its history appear here.
    id: "stock",
    tables: [
      "product_stock_batches",
      "product_units",
      "stock_adjustments",
      "stock_batch_consumptions",
      "supplier_purchases",
      "supplier_settlements",
    ],
  },
  {
    // The Mobile Services items (and their cost / picture settings) are
    // KEPT — only the sales made with them are here.
    id: "recharges",
    tables: [
      "recharges",
      "financial_services",
      "settlement_commission_allocations",
      "vouchers",
    ],
  },
  {
    // carrier_lines itself is NOT in this list (LIRA-254): the line rows
    // are kept with credits reset to 0, not deleted, so they never appear
    // in `preview.counts` — only their movement history does.
    id: "carrierLines",
    tables: ["carrier_line_movements", "carrier_line_owed_deliveries"],
  },
  {
    id: "exchange",
    tables: [
      "exchange_transactions",
      "exchange_lots",
      "exchange_lot_settlements",
      "exchange_position_adjustments",
      "wallet_exchanges",
    ],
  },
  {
    id: "loto",
    tables: [
      "loto_tickets",
      "loto_checkpoints",
      "loto_settlements",
      "loto_cash_prizes",
      "loto_monthly_fees",
    ],
  },
  {
    id: "maintenance",
    tables: [
      "maintenance",
      "maintenance_parts",
      "maintenance_status_history",
      "custom_services",
    ],
  },
  {
    // LIRA-296: warranty claims, the faulty items taken back, and the
    // returns sent to suppliers.
    id: "warranty",
    tables: ["warranty_claims", "defective_items", "supplier_returns"],
  },
  {
    id: "expenses",
    tables: ["expenses"],
  },
  {
    id: "audit",
    tables: ["audit_log"],
  },
];

/** Sums each group's table counts, drops zero-count groups, and folds any
 *  unrecognized table into "Other" instead of dropping it. */
function groupCounts(
  counts: Record<string, number>,
): Array<{ id: ResetGroupId; count: number }> {
  const named = new Set<string>();
  const rows: Array<{ id: ResetGroupId; count: number }> = [];

  for (const group of TABLE_GROUPS) {
    let sum = 0;
    for (const table of group.tables) {
      named.add(table);
      sum += counts[table] ?? 0;
    }
    if (sum > 0) rows.push({ id: group.id, count: sum });
  }

  let otherSum = 0;
  for (const [table, count] of Object.entries(counts)) {
    if (!named.has(table)) otherSum += count;
  }
  if (otherSum > 0) rows.push({ id: "other", count: otherSum });

  return rows;
}

/** After this long without a preview the panel offers Retry (seed run
 *  2026-10-16: a stalled request left the button disabled with no way out). */
const RESET_PREVIEW_SLOW_MS = 10_000;

export function ResetDataPanel() {
  const api = useApi();
  const { t } = useTranslation("settings");
  // rule 25: read through a ref so `load` keeps one identity.
  const apiRef = useRef(api);
  apiRef.current = api;
  const [preview, setPreview] = useState<DatabaseResetPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  // Only the newest request may update the panel (Retry can overlap a
  // stalled one).
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setSlow(false);
    setError(null);
    try {
      const data = await apiRef.current.getDatabaseResetPreview();
      if (requestRef.current !== requestId) return;
      setPreview(data);
    } catch (err) {
      if (requestRef.current !== requestId) return;
      // The web transport throws a plain { status, message } object, not an
      // Error — getApiErrorMessage reads both.
      setError(getApiErrorMessage(err, t("reset.loadFailedShort")));
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!loading) return;
    const timer = window.setTimeout(() => setSlow(true), RESET_PREVIEW_SLOW_MS);
    return () => window.clearTimeout(timer);
  }, [loading]);

  const groups = preview ? groupCounts(preview.counts) : [];

  return (
    <div data-testid="reset-data-panel" className="space-y-6 max-w-2xl">
      <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 flex gap-3">
        <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
        <p className="text-sm text-red-200">
          {t("reset.warning")}
        </p>
      </div>

      <div data-testid="reset-data-keeps">
        <h3 className="text-sm font-semibold text-white mb-2">
          {t("reset.keepsTitle")}
        </h3>
        <ul className="text-sm text-slate-400 list-disc list-inside space-y-1">
          <li>{t("reset.keeps.users")}</li>
          <li>{t("reset.keeps.shop")}</li>
          <li>{t("reset.keeps.modules")}</li>
          <li>{t("reset.keeps.currencies")}</li>
          <li>{t("reset.keeps.drawers")}</li>
          <li>{t("reset.keeps.categories")}</li>
          <li>{t("reset.keeps.products")}</li>
          <li>{t("reset.keeps.mobileServices")}</li>
          <li>{t("reset.keeps.presets")}</li>
          <li>{t("reset.keeps.partners")}</li>
          <li>{t("reset.keeps.carrierLines")}</li>
          <li>{t("reset.keeps.settings")}</li>
        </ul>
      </div>

      <div data-testid="reset-data-deletes">
        <h3 className="text-sm font-semibold text-white mb-2">
          {t("reset.deletesTitle")}
        </h3>
        <ul className="text-sm text-slate-400 list-disc list-inside space-y-1">
          <li>{t("reset.deletes.transactions")}</li>
          <li>{t("reset.deletes.closings")}</li>
          <li>{t("reset.deletes.clients")}</li>
          <li>{t("reset.deletes.stock")}</li>
          <li>{t("reset.deletes.services")}</li>
          <li>{t("reset.deletes.sessions")}</li>
        </ul>
        <p className="text-xs text-slate-500 mt-2">
          {t("reset.drawersZero")}
        </p>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-white mb-2">
          {t("reset.previewTitle")}
        </h3>
        {loading ? (
          <div className="text-sm text-slate-400">
            {t("reset.loadingPreview")}
            {slow && (
              <span
                data-testid="reset-data-slow"
                className="ms-2 inline-flex items-center gap-2"
              >
                {t("reset.slow")}
                <button
                  type="button"
                  onClick={() => void load()}
                  className="px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs"
                >
                  {t("reset.retry")}
                </button>
              </span>
            )}
          </div>
        ) : error ? (
          <div
            data-testid="reset-data-error"
            className="flex items-center gap-3 text-sm text-red-400"
          >
            <span>{t("reset.loadFailed", { error })}</span>
            <button
              type="button"
              onClick={() => void load()}
              className="px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs"
            >
              {t("reset.retry")}
            </button>
          </div>
        ) : (
          <div
            data-testid="reset-data-preview"
            className="bg-slate-800 rounded-xl border border-slate-700/50 overflow-hidden"
          >
            <table className="w-full">
              <tbody className="divide-y divide-slate-700">
                {groups.length === 0 && (
                  <tr>
                    <td className="px-4 py-3 text-sm text-slate-400">
                      {t("reset.empty")}
                    </td>
                  </tr>
                )}
                {groups.map((g) => (
                  <tr key={g.id}>
                    <td className="px-4 py-2 text-sm text-slate-300">
                      {t(`reset.group.${g.id}`)}
                    </td>
                    <td className="px-4 py-2 text-sm text-white text-end">
                      {formatNumber(g.count)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {preview && (
                <tfoot>
                  <tr className="bg-slate-900 border-t border-slate-700">
                    <td className="px-4 py-3 text-sm font-semibold text-white">
                      {t("reset.totalRows")}
                    </td>
                    <td className="px-4 py-3 text-sm font-bold text-white text-end">
                      {formatNumber(preview.totalRows)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      <button
        data-testid="reset-data-open-modal-btn"
        onClick={() => setModalOpen(true)}
        disabled={loading || !!error}
        className="px-4 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold transition-colors"
      >
        {t("reset.resetAll")}
      </button>

      {modalOpen && (
        <ResetDataModal
          totalRows={preview?.totalRows ?? 0}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}

export default ResetDataPanel;
