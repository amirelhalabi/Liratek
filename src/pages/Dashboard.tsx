import { useState, useEffect } from 'react';
import { DollarSign, ShoppingBag, Users, AlertTriangle, TrendingUp, Package, Clock } from 'lucide-react';
import { appEvents } from '../utils/appEvents';

export default function Dashboard() {
    const [stats, setStats] = useState({
        totalSales: 0,
        ordersCount: 0,
        activeClients: 0,
        lowStockCount: 0
    });
    const [salesChart, setSalesChart] = useState<{ date: string; amount: number }[]>([]);
    const [recentActivity, setRecentActivity] = useState<any[]>([]);
    const [topProducts, setTopProducts] = useState<any[]>([]);

    const loadData = async () => {
        try {
            const [statsData, chartData, activityData, productsData] = await Promise.all([
                window.api.getDashboardStats(),
                window.api.getSalesChart(),
                window.api.getRecentActivity(),
                window.api.getTopProducts()
            ]);

            setStats(statsData);
            setSalesChart(chartData);
            setRecentActivity(activityData);
            setTopProducts(productsData);
        } catch (error) {
            // console.error('Failed to load dashboard data:', error);
        }
    };

    useEffect(() => {
        loadData();
        const interval = setInterval(loadData, 30000); // 30s refresh

        // Listen for sale completion event to refresh immediately
        const unsubscribe = appEvents.on('sale:completed', () => {
            console.log('[DASHBOARD] Sale completed, refreshing stats...');
            loadData();
        });

        return () => {
            clearInterval(interval);
            unsubscribe();
        };
    }, []);

    const maxChartValue = Math.max(...salesChart.map(d => d.amount), 100);

    const statCards = [
        { label: 'Total Sales (Today)', value: `$${stats.totalSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: DollarSign, color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
        { label: 'Orders Processed', value: stats.ordersCount.toString(), icon: ShoppingBag, color: 'text-blue-400', bg: 'bg-blue-400/10' },
        { label: 'Active Clients', value: stats.activeClients.toString(), icon: Users, color: 'text-violet-400', bg: 'bg-violet-400/10' },
        { label: 'Low Stock Items', value: stats.lowStockCount.toString(), icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-400/10' },
    ];

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                <TrendingUp className="text-violet-500" />
                Dashboard
            </h1>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {statCards.map((stat) => (
                    <div key={stat.label} className="bg-slate-800 p-5 rounded-xl border border-slate-700/50 shadow-lg hover:border-slate-600 transition-colors">
                        <div className="flex items-center justify-between mb-3">
                            <div className={`p-2 rounded-lg ${stat.bg}`}>
                                <stat.icon className={`w-5 h-5 ${stat.color}`} />
                            </div>
                        </div>
                        <h3 className="text-slate-500 text-xs font-medium uppercase tracking-wider">{stat.label}</h3>
                        <p className="text-2xl font-bold text-white mt-1">{stat.value}</p>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Sales Chart (Left - Takes 2 cols) */}
                <div className="lg:col-span-2 bg-slate-800 p-6 rounded-xl border border-slate-700/50 shadow-lg flex flex-col">
                    <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                        <DollarSign size={18} className="text-emerald-400" />
                        Revenue (Last 7 Days)
                    </h3>

                    <div className="flex-1 flex justify-between gap-4 h-64 w-full">
                        {salesChart.map((day) => {
                            const heightPercentage = Math.max((day.amount / maxChartValue) * 100, 0);
                            const dateLabel = new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

                            return (
                                <div key={day.date} className="flex-1 flex flex-col items-center gap-2 group h-full">
                                    <div className="w-full bg-slate-700/30 rounded-t-lg relative flex items-end flex-1 overflow-hidden hover:bg-slate-700/50 transition-colors cursor-pointer">
                                        <div
                                            className="w-full bg-emerald-500/80 hover:bg-emerald-400 transition-all rounded-t-lg"
                                            style={{ height: `${heightPercentage}%` }}
                                        ></div>
                                        {/* Tooltip */}
                                        <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-xs py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition-opacity border border-slate-600 whitespace-nowrap z-10 pointer-events-none">
                                            ${day.amount.toFixed(2)}
                                        </div>
                                    </div>
                                    <span className="text-xs text-slate-500 font-medium">{dateLabel}</span>
                                </div>
                            );
                        })}
                        {salesChart.length === 0 && (
                            <div className="w-full h-full flex items-center justify-center text-slate-500 text-sm">
                                No sales data for the last 7 days.
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Column: Recent & Top Products */}
                <div className="space-y-6">
                    {/* Recent Activity */}
                    <div className="bg-slate-800 p-5 rounded-xl border border-slate-700/50 shadow-lg">
                        <h3 className="text-md font-bold text-white mb-4 flex items-center gap-2">
                            <Clock size={16} className="text-blue-400" />
                            Recent Sales
                        </h3>
                        <div className="space-y-3">
                            {recentActivity.length > 0 ? (
                                recentActivity.map((sale) => (
                                    <div key={sale.id} className="flex items-center justify-between p-3 bg-slate-700/20 rounded-lg hover:bg-slate-700/40 transition-colors">
                                        <div className="flex flex-col">
                                            <span className="text-sm font-medium text-slate-200">
                                                {sale.client_name || 'Walk-in Client'}
                                            </span>
                                            <span className="text-xs text-slate-500">
                                                {new Date(sale.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>
                                        <div className="text-emerald-400 font-bold text-sm">
                                            +${sale.final_amount_usd.toFixed(2)}
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <p className="text-xs text-slate-500 text-center py-4">No recent activity.</p>
                            )}
                        </div>
                    </div>

                    {/* Top Products */}
                    <div className="bg-slate-800 p-5 rounded-xl border border-slate-700/50 shadow-lg">
                        <h3 className="text-md font-bold text-white mb-4 flex items-center gap-2">
                            <Package size={16} className="text-amber-400" />
                            Top Products
                        </h3>
                        <div className="space-y-3">
                            {topProducts.length > 0 ? (
                                topProducts.map((product, idx) => (
                                    <div key={idx} className="flex items-center justify-between p-2">
                                        <div className="flex items-center gap-3">
                                            <div className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-400">
                                                {idx + 1}
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-sm text-slate-300 line-clamp-1 max-w-[120px]" title={product.name}>
                                                    {product.name}
                                                </span>
                                                <span className="text-[10px] text-slate-500">
                                                    {product.total_quantity} sold
                                                </span>
                                            </div>
                                        </div>
                                        <span className="text-xs font-medium text-slate-400">
                                            ${product.total_revenue.toFixed(0)}
                                        </span>
                                    </div>
                                ))
                            ) : (
                                <p className="text-xs text-slate-500 text-center py-4">No top products yet.</p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
