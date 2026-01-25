import { useState, useEffect } from "react";
import {
    TrendingUp,
    PieChart as PieChartIcon,
    Activity
} from "lucide-react";
import PageHeader from "../../../shared/components/layouts/PageHeader";
import {
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    Tooltip,
    Legend
} from "recharts";
import * as api from "../../../api/backendApi";

type ProviderStats = {
    provider: string;
    commission_usd: number;
    commission_lbp: number;
    count: number;
};

type AnalyticsData = {
    today: { commissionUSD: number; commissionLBP: number; count: number };
    month: { commissionUSD: number; commissionLBP: number; count: number };
    byProvider: ProviderStats[];
};

const COLORS = ["#8b5cf6", "#ec4899", "#3b82f6", "#10b981", "#f59e0b"];

export default function CommissionsDashboard() {
    const [data, setData] = useState<AnalyticsData | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchAnalytics = async () => {
            try {
                const analytics = await api.getOMTAnalytics();
                setData(analytics);
            } catch (error) {
                console.error("Failed to fetch commissions analytics", error);
            } finally {
                setIsLoading(false);
            }
        };
        fetchAnalytics();
    }, []);

    if (isLoading) {
        return <div className="flex items-center justify-center h-full text-white">Loading Analytics...</div>;
    }

    const pieData = data?.byProvider.map(p => ({
        name: p.provider,
        value: p.commission_usd + (p.commission_lbp / 89000)
    })) || [];

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <PageHeader icon={TrendingUp} title="Analytics" />

            {/* Overview Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-slate-800 p-6 rounded-xl border border-slate-700/50 shadow-lg">
                    <p className="text-slate-400 text-sm font-medium uppercase mb-4">Total Commissions (Month)</p>
                    <div className="flex items-end gap-3">
                        <span className="text-3xl font-bold text-white">${data?.month.commissionUSD.toFixed(2)}</span>
                        <span className="text-slate-500 mb-1">USD</span>
                    </div>
                    <div className="mt-2 text-violet-400 font-mono text-sm">
                        + {data?.month.commissionLBP.toLocaleString()} LBP
                    </div>
                </div>

                <div className="bg-slate-800 p-6 rounded-xl border border-slate-700/50 shadow-lg">
                    <p className="text-slate-400 text-sm font-medium uppercase mb-4">Commissions (Today)</p>
                    <div className="flex items-end gap-3">
                        <span className="text-3xl font-bold text-emerald-400">${data?.today.commissionUSD.toFixed(2)}</span>
                        <span className="text-slate-500 mb-1">USD</span>
                    </div>
                    <div className="mt-2 text-emerald-500/70 font-mono text-sm">
                        + {data?.today.commissionLBP.toLocaleString()} LBP
                    </div>
                </div>

                <div className="bg-slate-800 p-6 rounded-xl border border-slate-700/50 shadow-lg">
                    <p className="text-slate-400 text-sm font-medium uppercase mb-4">Transaction Volume</p>
                    <div className="flex items-end gap-3">
                        <span className="text-3xl font-bold text-blue-400">{data?.month.count}</span>
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
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={pieData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {pieData.map((_, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{ backgroundColor: "#1e293b", border: "none", borderRadius: "8px" }}
                                    itemStyle={{ color: "#fff" }}
                                    formatter={(value) => `$${Number(value || 0).toFixed(2)} (est)`}
                                />
                                <Legend verticalAlign="bottom" height={36} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Detailed Table */}
                <div className="bg-slate-800 p-6 rounded-xl border border-slate-700/50 shadow-lg flex flex-col">
                    <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                        <Activity size={18} className="text-blue-400" />
                        Provider Performance (Today)
                    </h3>
                    <div className="flex-1 overflow-auto">
                        <table className="w-full text-left">
                            <thead className="text-xs text-slate-500 uppercase tracking-wider border-b border-slate-700/50">
                                <tr>
                                    <th className="pb-3">Provider</th>
                                    <th className="pb-3 text-right">Transactions</th>
                                    <th className="pb-3 text-right">Profit (USD)</th>
                                    <th className="pb-3 text-right">Profit (LBP)</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700/30">
                                {data?.byProvider.map((p) => (
                                    <tr key={p.provider} className="group hover:bg-slate-700/30 transition-colors">
                                        <td className="py-4 font-medium text-slate-200">{p.provider}</td>
                                        <td className="py-4 text-right text-slate-400">{p.count}</td>
                                        <td className="py-4 text-right text-emerald-400 font-mono">${p.commission_usd.toFixed(2)}</td>
                                        <td className="py-4 text-right text-violet-400 font-mono">{p.commission_lbp.toLocaleString()}</td>
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
