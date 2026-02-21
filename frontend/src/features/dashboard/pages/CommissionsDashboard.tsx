import { useState, useEffect, lazy, Suspense, useRef } from "react";
import logger from "../../../utils/logger";
import { TrendingUp, PieChart as PieChartIcon, Activity } from "lucide-react";
import { PageHeader, useApi } from "@liratek/ui";
import { useCurrencyContext } from "../../../contexts/CurrencyContext";
import { ExportBar } from "@/shared/components/ExportBar";

const CommissionsChart = lazy(() => import("../components/CommissionsChart"));

type ProviderStats = {
  provider: string;
  commission: number;
  currency: string;
  count: number;
};

type AnalyticsData = {
  today: { commission: number; count: number };
  month: { commission: number; count: number };
  byProvider: ProviderStats[];
};

export default function CommissionsDashboard() {
  const api = useApi();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { formatAmount } = useCurrencyContext();
  const tableRef = useRef<HTMLTableElement>(null);

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        const analytics = await api.getOMTAnalytics();
        setData(analytics);
      } catch (error) {
        logger.error("Failed to fetch commissions analytics", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchAnalytics();
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-white">
        Loading Analytics...
      </div>
    );
  }

  const pieData =
    data?.byProvider.map((p) => ({
      name: p.provider,
      value: p.commission,
    })) || [];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={TrendingUp} title="Analytics" />

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700/50 shadow-lg">
          <p className="text-slate-400 text-sm font-medium uppercase mb-4">
            Total Commissions (Month)
          </p>
          <div className="flex items-end gap-3">
            <span className="text-3xl font-bold text-white">
              {formatAmount(data?.month.commission ?? 0, "USD")}
            </span>
          </div>
        </div>

        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700/50 shadow-lg">
          <p className="text-slate-400 text-sm font-medium uppercase mb-4">
            Commissions (Today)
          </p>
          <div className="flex items-end gap-3">
            <span className="text-3xl font-bold text-emerald-400">
              {formatAmount(data?.today.commission ?? 0, "USD")}
            </span>
          </div>
        </div>

        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700/50 shadow-lg">
          <p className="text-slate-400 text-sm font-medium uppercase mb-4">
            Transaction Volume
          </p>
          <div className="flex items-end gap-3">
            <span className="text-3xl font-bold text-blue-400">
              {data?.month.count}
            </span>
            <span className="text-slate-500 mb-1">services this month</span>
          </div>
          <div className="mt-2 text-blue-500/70 text-sm">
            {data?.today.count} processed today
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Market Share / Provider Breakdown */}
        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700/50 shadow-lg">
          <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
            <PieChartIcon size={18} className="text-pink-500" />
            Revenue by Provider
          </h3>
          <div className="h-80">
            <Suspense
              fallback={
                <div className="h-80 animate-pulse bg-slate-700/30 rounded-xl" />
              }
            >
              <CommissionsChart pieData={pieData} formatAmount={formatAmount} />
            </Suspense>
          </div>
        </div>

        {/* Detailed Table */}
        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700/50 shadow-lg flex flex-col">
          <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
            <Activity size={18} className="text-blue-400" />
            Provider Performance (Today)
          </h3>
          <div className="flex-1 overflow-auto">
            <ExportBar
              exportExcel
              exportPdf
              exportFilename="commissions"
              tableRef={tableRef}
              rowCount={data?.byProvider?.length ?? 0}
            />
            <table ref={tableRef} className="w-full text-left">
              <thead className="text-xs text-slate-500 uppercase tracking-wider border-b border-slate-700/50">
                <tr>
                  <th className="pb-3">Provider</th>
                  <th className="pb-3 text-right">Transactions</th>
                  <th className="pb-3 text-right">Commission (USD)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {data?.byProvider.map((p) => (
                  <tr
                    key={p.provider}
                    className="group hover:bg-slate-700/30 transition-colors"
                  >
                    <td className="py-4 font-medium text-slate-200">
                      {p.provider}
                    </td>
                    <td className="py-4 text-right text-slate-400">
                      {p.count}
                    </td>
                    <td className="py-4 text-right text-emerald-400 font-mono">
                      {formatAmount(p.commission, "USD")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
