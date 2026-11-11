import { useTranslation } from "react-i18next";
import type {
  TransactionSummaryResult,
  TransactionSummaryRow,
} from "@liratek/core";
import { formatMoney, formatNumber } from "@liratek/ui/i18n/format";
import { translateTitle } from "../typeTitleText";

/**
 * LIRA-389 — the Summary view's table: one row per group with Count, Units
 * (Product / Category only), Volume USD and Volume LBP, and a TOTAL row.
 * Never a profit, cost, margin or commission column (owner decision). A
 * zero volume shows "—". Clicking a row asks the page to open the List
 * filtered to it.
 */
export interface TransactionSummaryViewProps {
  result: TransactionSummaryResult | null;
  loading: boolean;
  error: string | null;
  onRowClick: (row: TransactionSummaryRow) => void;
}

const DASH = "—";

function usd(n: number): string {
  return n === 0
    ? DASH
    : formatMoney(n, "USD", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
}

function lbp(n: number): string {
  return n === 0 ? DASH : formatMoney(n, "LBP", { maximumFractionDigits: 0 });
}

const th = "p-2 text-xs font-semibold uppercase text-slate-400";
const num = "p-2 text-sm text-end tabular-nums";

export function TransactionSummaryView({
  result,
  loading,
  error,
  onRowClick,
}: TransactionSummaryViewProps) {
  const { t, i18n } = useTranslation("audit");

  if (error) {
    return (
      <p className="p-6 text-sm text-red-400" role="alert">
        {t("summary.error")}
      </p>
    );
  }
  if (!result) {
    return (
      <p className="p-6 text-sm text-slate-400">
        {loading ? t("table.loading") : t("summary.empty")}
      </p>
    );
  }

  const g = result.group_by;
  const withUnits = g === "product" || g === "category";

  const labelOf = (row: TransactionSummaryRow): string => {
    if (g === "type") {
      return t(`summary.modules.${row.key}`, { defaultValue: row.label });
    }
    if (g === "service") return translateTitle(row.label, t, i18n.language);
    if (g === "category" && row.category == null)
      return t("summary.noCategory");
    return row.label;
  };

  return (
    <div className={loading ? "opacity-60" : undefined}>
      {result.truncated && (
        <p className="px-3 pt-3 text-xs text-amber-300">
          {t("summary.truncated")}
        </p>
      )}
      {withUnits && (
        <p className="px-3 pt-3 text-xs text-slate-400">
          {t("summary.salesOnly")}
        </p>
      )}
      <table
        data-testid="transactions-summary-table"
        className="w-full text-start"
      >
        <thead className="bg-slate-900">
          <tr>
            <th className={`${th} text-start`}>{t(`summary.groups.${g}`)}</th>
            <th className={`${th} text-end`}>{t("summary.columns.count")}</th>
            {withUnits && (
              <th className={`${th} text-end`}>{t("summary.columns.units")}</th>
            )}
            <th className={`${th} text-end`}>
              {t("summary.columns.volumeUsd")}
            </th>
            <th className={`${th} text-end`}>
              {t("summary.columns.volumeLbp")}
            </th>
          </tr>
        </thead>
        <tbody>
          {result.rows.length === 0 ? (
            <tr>
              <td
                colSpan={withUnits ? 5 : 4}
                className="p-6 text-center text-sm text-slate-400"
              >
                {t("summary.empty")}
              </td>
            </tr>
          ) : (
            result.rows.map((row) => (
              <tr
                key={row.key}
                data-testid="transactions-summary-row"
                onClick={() => onRowClick(row)}
                title={t("summary.rowHint")}
                className="cursor-pointer border-t border-slate-700/60 hover:bg-slate-700/40"
              >
                <td className="p-2 text-sm text-white">
                  {labelOf(row)}
                  {row.deleted && (
                    <span className="ms-1 text-xs text-slate-500">
                      {t("summary.deleted")}
                    </span>
                  )}
                </td>
                <td className={`${num} text-white`}>
                  {formatNumber(row.count)}
                </td>
                {withUnits && (
                  <td className={`${num} text-white`}>
                    {formatNumber(row.units ?? 0)}
                  </td>
                )}
                <td className={`${num} text-emerald-300`}>
                  {usd(row.volume_usd)}
                </td>
                <td className={`${num} text-emerald-300`}>
                  {lbp(row.volume_lbp)}
                </td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr
            data-testid="transactions-summary-total"
            className="border-t-2 border-slate-600 bg-slate-900/60 font-semibold"
          >
            <td className="p-2 text-sm text-white">{t("summary.total")}</td>
            <td className={`${num} text-white`}>
              {formatNumber(result.total.count)}
            </td>
            {withUnits && (
              <td className={`${num} text-white`}>
                {formatNumber(result.total.units ?? 0)}
              </td>
            )}
            <td className={`${num} text-emerald-300`}>
              {usd(result.total.volume_usd)}
            </td>
            <td className={`${num} text-emerald-300`}>
              {lbp(result.total.volume_lbp)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
