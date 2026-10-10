import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useApi } from "@liratek/ui";
import type { DatabaseResetPreview } from "@liratek/core";
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
const TABLE_GROUPS: Array<{ label: string; tables: string[] }> = [
  {
    label: "Transactions & customer sessions",
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
    label: "Payments & drawer movements",
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
    label: "Debts & supplier/partner ledgers",
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
    label: "Clients",
    tables: ["clients"],
  },
  {
    // Products, categories and the product-supplier names are KEPT (the
    // products with stock and minimum stock set to 0 — RESET_ZERO_TABLES),
    // so only stock and its history appear here.
    label: "Stock & purchases",
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
    label: "Recharges, money transfers & vouchers",
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
    label: "Carrier line history",
    tables: ["carrier_line_movements", "carrier_line_owed_deliveries"],
  },
  {
    label: "Exchange & wallet",
    tables: [
      "exchange_transactions",
      "exchange_lots",
      "exchange_lot_settlements",
      "exchange_position_adjustments",
      "wallet_exchanges",
    ],
  },
  {
    label: "Loto",
    tables: [
      "loto_tickets",
      "loto_checkpoints",
      "loto_settlements",
      "loto_cash_prizes",
      "loto_monthly_fees",
    ],
  },
  {
    label: "Maintenance & custom services",
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
    label: "Warranty claims & supplier returns",
    tables: ["warranty_claims", "defective_items", "supplier_returns"],
  },
  {
    label: "Expenses",
    tables: ["expenses"],
  },
  {
    label: "Audit log",
    tables: ["audit_log"],
  },
];

/** Sums each group's table counts, drops zero-count groups, and folds any
 *  unrecognized table into "Other" instead of dropping it. */
function groupCounts(
  counts: Record<string, number>,
): Array<{ label: string; count: number }> {
  const named = new Set<string>();
  const rows: Array<{ label: string; count: number }> = [];

  for (const group of TABLE_GROUPS) {
    let sum = 0;
    for (const table of group.tables) {
      named.add(table);
      sum += counts[table] ?? 0;
    }
    if (sum > 0) rows.push({ label: group.label, count: sum });
  }

  let otherSum = 0;
  for (const [table, count] of Object.entries(counts)) {
    if (!named.has(table)) otherSum += count;
  }
  if (otherSum > 0) rows.push({ label: "Other", count: otherSum });

  return rows;
}

export function ResetDataPanel() {
  const api = useApi();
  const [preview, setPreview] = useState<DatabaseResetPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getDatabaseResetPreview();
      setPreview(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load reset preview",
      );
    } finally {
      setLoading(false);
    }
  }

  const groups = preview ? groupCounts(preview.counts) : [];

  return (
    <div data-testid="reset-data-panel" className="space-y-6 max-w-2xl">
      <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 flex gap-3">
        <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
        <p className="text-sm text-red-200">
          This wipes all operational data for this shop and cannot be undone.
          Use it only to hand off a fresh, empty install.
        </p>
      </div>

      <div data-testid="reset-data-keeps">
        <h3 className="text-sm font-semibold text-white mb-2">This KEEPS</h3>
        <ul className="text-sm text-slate-400 list-disc list-inside space-y-1">
          <li>The admin account, every user, and everyone stays signed in</li>
          <li>The shop name and base system configuration</li>
          <li>Enabled modules and payment methods</li>
          <li>Currencies and exchange rates</li>
          <li>Drawer configuration (which currencies each drawer holds)</li>
          <li>Your product categories</li>
          <li>
            Your products (names, barcodes, prices) — with stock and minimum
            stock set to 0
          </li>
          <li>Your Mobile Services items, including the ones you added</li>
          <li>Your service presets</li>
          <li>Your partners and suppliers — with balances set to 0</li>
          <li>
            Your MTC/Alfa carrier lines (phone numbers, labels, SIM expiry) —
            with credits set to 0
          </li>
          <li>Every other Settings-page configuration</li>
        </ul>
      </div>

      <div data-testid="reset-data-deletes">
        <h3 className="text-sm font-semibold text-white mb-2">This DELETES</h3>
        <ul className="text-sm text-slate-400 list-disc list-inside space-y-1">
          <li>All transactions, sales, payments, and drawer movements</li>
          <li>Closings, debts, and every supplier/partner ledger entry</li>
          <li>Clients</li>
          <li>
            Stock and stock history (stock batches, phone IMEIs, purchases)
          </li>
          <li>
            Recharges, money transfers, exchange, loto, maintenance jobs, custom
            services and expenses
          </li>
          <li>Customer sessions and the audit log</li>
        </ul>
        <p className="text-xs text-slate-500 mt-2">
          Drawer balances are set to zero — the app will ask for opening amounts
          again the next time it's used.
        </p>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-white mb-2">
          What will be removed
        </h3>
        {loading ? (
          <div className="text-sm text-slate-400">Loading preview...</div>
        ) : error ? (
          <div className="text-sm text-red-400">{error}</div>
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
                      Nothing to delete — the database is already empty.
                    </td>
                  </tr>
                )}
                {groups.map((g) => (
                  <tr key={g.label}>
                    <td className="px-4 py-2 text-sm text-slate-300">
                      {g.label}
                    </td>
                    <td className="px-4 py-2 text-sm text-white text-right">
                      {g.count.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
              {preview && (
                <tfoot>
                  <tr className="bg-slate-900 border-t border-slate-700">
                    <td className="px-4 py-3 text-sm font-semibold text-white">
                      Total rows
                    </td>
                    <td className="px-4 py-3 text-sm font-bold text-white text-right">
                      {preview.totalRows.toLocaleString()}
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
        Reset All Data
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
