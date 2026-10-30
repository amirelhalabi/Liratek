/**
 * LIRA-364 — Monthly progress. The shop's month-end balances, saved
 * automatically once a month, side by side: each KPI a row, each month a
 * column (newest first). USD and LBP are never combined; each cell shows the
 * change from the month before, per currency. Admin-only, and only for shops
 * super admin switched the feature on for.
 */
import { useTranslation } from "react-i18next";
import { PageHeader } from "@liratek/ui";
import { formatMoney } from "@liratek/ui/i18n/format";
import {
  KPI_DEFINITIONS,
  type KpiDefinition,
  type KpiSnapshotView,
} from "@liratek/core";
import { useModules } from "@/contexts/ModuleContext";
import { useFormat } from "@/i18n/useFormat";
import { useKpiProgressQuery } from "../../hooks/useKpiProgress";

type Amounts = { usd: number; lbp: number };

const USD_OPTS = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
const LBP_OPTS = { maximumFractionDigits: 0 };

function money(amount: number, currency: "USD" | "LBP"): string {
  return formatMoney(
    amount,
    currency,
    currency === "USD" ? USD_OPTS : LBP_OPTS,
  );
}

/** `+$1,500.00` / `-30.00` style; null when there is nothing to compare. */
function delta(
  now: number,
  before: number | undefined,
  currency: "USD" | "LBP",
): string | null {
  if (before === undefined) return null;
  const diff = now - before;
  if (Math.abs(diff) < (currency === "USD" ? 0.005 : 0.5)) return "±0";
  return `${diff > 0 ? "+" : "-"}${money(Math.abs(diff), currency)}`;
}

function Cell({
  def,
  value,
  previous,
  notRecorded,
}: {
  def: KpiDefinition;
  value: Amounts | undefined;
  previous: Amounts | undefined;
  notRecorded: string;
}) {
  if (!value) {
    return <span className="text-xs text-slate-500">{notRecorded}</span>;
  }
  const lines: Array<{
    currency: "USD" | "LBP";
    amount: number;
    prev: number | undefined;
  }> = [{ currency: "USD", amount: value.usd, prev: previous?.usd }];
  if (!def.usdOnly) {
    lines.push({ currency: "LBP", amount: value.lbp, prev: previous?.lbp });
  }
  return (
    <div className="space-y-1">
      {lines.map((l) => {
        const change = previous ? delta(l.amount, l.prev, l.currency) : null;
        return (
          <div key={l.currency} className="leading-tight">
            <div className="text-sm font-mono text-white">
              {money(l.amount, l.currency)}
            </div>
            {change && (
              <div className="text-[11px] font-mono text-slate-400">
                {change}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function MonthlyProgress() {
  const { t } = useTranslation("reports");
  const fmt = useFormat();
  const { isModuleEnabled } = useModules();
  const { data, isLoading, isError } = useKpiProgressQuery();

  const rows = KPI_DEFINITIONS.filter(
    (d) => !d.requiresModule || isModuleEnabled(d.requiresModule),
  );
  const months: KpiSnapshotView[] = data?.snapshots ?? [];

  const monthLabel = (m: string) =>
    fmt.formatDate(`${m}-01T00:00:00Z`, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });

  let body: React.ReactNode;
  if (isLoading) {
    body = <p className="text-slate-400 text-sm">{t("kpi.loading")}</p>;
  } else if (isError) {
    body = <p className="text-red-400 text-sm">{t("kpi.loadFailed")}</p>;
  } else if (!data?.enabled) {
    body = (
      <p data-testid="kpi-disabled" className="text-slate-400 text-sm">
        {t("kpi.disabled")}
      </p>
    );
  } else if (months.length === 0) {
    body = (
      <div
        data-testid="kpi-empty"
        className="bg-slate-800 rounded-xl border border-slate-700/50 p-6 text-sm text-slate-300"
      >
        {t("kpi.empty")}
      </div>
    );
  } else {
    body = (
      <div className="bg-slate-800 rounded-xl border border-slate-700/50 overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-900">
            <tr>
              <th className="text-start text-xs text-slate-400 px-4 py-3 min-w-[200px]">
                {t("kpi.balance")}
              </th>
              {months.map((s) => (
                <th
                  key={s.month}
                  data-testid={`kpi-month-${s.month}`}
                  className="text-start text-xs text-slate-300 px-4 py-3 min-w-[150px] align-top"
                >
                  <div className="font-semibold text-white">
                    {monthLabel(s.month)}
                  </div>
                  {s.usd_lbp_sell_rate !== null && (
                    <div className="font-normal text-slate-500 mt-0.5">
                      {t("kpi.rate", {
                        rate: money(s.usd_lbp_sell_rate, "LBP"),
                      })}
                    </div>
                  )}
                  {s.is_late && (
                    <div
                      data-testid={`kpi-late-${s.month}`}
                      className="font-normal text-amber-400 mt-0.5"
                      title={t("kpi.lateHint")}
                    >
                      {t("kpi.late", {
                        date: fmt.formatDate(
                          `${s.taken_at.replace(" ", "T")}Z`,
                        ),
                      })}
                    </div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {rows.map((def) => (
              <tr key={def.key} data-testid={`kpi-row-${def.key}`}>
                <td className="px-4 py-3 text-sm text-slate-200 align-top">
                  {t(`kpi.names.${def.key}`)}
                </td>
                {months.map((s, i) => (
                  <td
                    key={s.month}
                    data-testid={`kpi-cell-${s.month}`}
                    className="px-4 py-3 align-top"
                  >
                    <Cell
                      def={def}
                      value={s.values[def.key]}
                      previous={months[i + 1]?.values[def.key]}
                      notRecorded={t("kpi.notRecorded")}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 flex flex-col gap-6 overflow-auto">
      <PageHeader title={t("kpi.title")} />
      <p className="text-sm text-slate-400 -mt-3">{t("kpi.subtitle")}</p>
      {body}
    </div>
  );
}
