import { useState, useEffect } from "react";
import { useApi, DataTable } from "@liratek/ui";
import {
  Calendar,
  RefreshCw,
  X,
  FileText,
  TrendingDown,
  TrendingUp,
  Package,
} from "lucide-react";
import { format } from "date-fns";

interface LotoCheckpoint {
  id: number;
  checkpoint_date: string;
  period_start: string;
  period_end: string;
  total_sales: number;
  total_commission: number;
  total_tickets: number;
  total_prizes: number;
  total_cash_prizes: number;
  total_cash_prizes_count: number;
  is_settled: number;
  settled_at: string | null;
  settlement_id: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

interface CheckpointReportData {
  total_tickets: number;
  total_sales: number;
  total_commission: number;
  total_prizes: number;
  total_cash_prizes: number;
  outstanding_prizes: number;
  total_fees: number;
}

interface CheckpointHistoryProps {
  onClose: () => void;
}

export function CheckpointHistory({ onClose }: CheckpointHistoryProps) {
  const api = useApi();
  const [checkpoints, setCheckpoints] = useState<LotoCheckpoint[]>([]);
  const [selectedCheckpoint, setSelectedCheckpoint] =
    useState<LotoCheckpoint | null>(null);
  const [reportData, setReportData] = useState<CheckpointReportData | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);

  useEffect(() => {
    loadCheckpoints();
  }, []);

  async function loadCheckpoints() {
    try {
      setLoading(true);
      // Load all checkpoints (wide date range)
      const result = await api.loto.checkpoint.getByDateRange(
        "2020-01-01",
        "2099-12-31",
      );
      if (result.success) {
        setCheckpoints(result.checkpoints || []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  async function handleViewReport(checkpoint: LotoCheckpoint) {
    setSelectedCheckpoint(checkpoint);
    setReportData(null);
    setReportLoading(true);

    try {
      const result = await api.loto.report(
        checkpoint.period_start,
        checkpoint.period_end,
      );
      if (result.success) {
        setReportData(result.reportData || null);
      }
    } catch {
      // silent
    } finally {
      setReportLoading(false);
    }
  }

  const unsettledCheckpoints = checkpoints.filter((cp) => cp.is_settled === 0);
  const totalUnsettledSales = unsettledCheckpoints.reduce(
    (sum, cp) => sum + cp.total_sales,
    0,
  );
  const totalUnsettledCommission = unsettledCheckpoints.reduce(
    (sum, cp) => sum + cp.total_commission,
    0,
  );

  return (
    <>
      {/* Main History Modal */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onClose}
      >
        <div
          className="relative w-full max-w-6xl max-h-[85vh] bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl flex flex-col animate-in zoom-in-95 duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/60">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Calendar className="text-slate-400" size={18} />
              Checkpoint History
              <span className="text-xs text-slate-500 font-normal ml-1">
                ({checkpoints.length} records)
              </span>
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={loadCheckpoints}
                className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                title="Refresh"
              >
                <RefreshCw size={14} />
              </button>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="px-6 pt-4 pb-2">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700/50">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-slate-400">Unsettled Sales</p>
                    <p className="text-base font-bold text-red-400">
                      {totalUnsettledSales.toLocaleString()} LBP
                    </p>
                  </div>
                  <TrendingDown className="w-5 h-5 text-red-400" />
                </div>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700/50">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-slate-400">
                      Unsettled Commission
                    </p>
                    <p className="text-base font-bold text-green-400">
                      {totalUnsettledCommission.toLocaleString()} LBP
                    </p>
                  </div>
                  <TrendingUp className="w-5 h-5 text-green-400" />
                </div>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700/50">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-slate-400">
                      Unsettled Checkpoints
                    </p>
                    <p className="text-base font-bold text-white">
                      {unsettledCheckpoints.length}
                    </p>
                  </div>
                  <Package className="w-5 h-5 text-yellow-400" />
                </div>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 min-h-0 overflow-auto p-4">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-slate-500">
                <RefreshCw size={20} className="animate-spin mr-2" />
                Loading...
              </div>
            ) : (
              <DataTable<LotoCheckpoint>
                columns={[
                  {
                    header: "Date",
                    className: "px-4 py-3",
                    sortKey: "checkpoint_date",
                  },
                  { header: "Period", className: "px-4 py-3" },
                  {
                    header: "Tickets",
                    className: "px-4 py-3 text-right",
                    sortKey: "total_tickets",
                  },
                  {
                    header: "Sales (LBP)",
                    className: "px-4 py-3 text-right",
                    sortKey: "total_sales",
                  },
                  {
                    header: "Commission (LBP)",
                    className: "px-4 py-3 text-right",
                    sortKey: "total_commission",
                  },
                  {
                    header: "Cash Prizes (LBP)",
                    className: "px-4 py-3 text-right",
                    sortKey: "total_cash_prizes",
                  },
                  {
                    header: "Status",
                    className: "px-4 py-3 text-center",
                  },
                  {
                    header: "Actions",
                    className: "px-4 py-3 text-center",
                  },
                ]}
                data={checkpoints}
                exportExcel
                exportPdf
                exportFilename="loto-checkpoint-history"
                className="w-full"
                theadClassName="bg-slate-900/50 text-left text-xs font-medium text-slate-400 uppercase tracking-wider sticky top-0"
                tbodyClassName="divide-y divide-slate-700/50"
                emptyMessage="No checkpoints found."
                renderRow={(checkpoint) => (
                  <tr
                    key={checkpoint.id}
                    className="hover:bg-slate-700/20 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 text-sm text-white font-medium">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        {format(
                          new Date(checkpoint.checkpoint_date),
                          "MMM dd, yyyy",
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs text-slate-400">
                        {format(new Date(checkpoint.period_start), "MMM dd")} -{" "}
                        {format(
                          new Date(checkpoint.period_end),
                          "MMM dd, yyyy",
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-medium text-white font-mono">
                      {checkpoint.total_tickets}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-bold text-red-400 font-mono">
                      {checkpoint.total_sales.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-bold text-green-400 font-mono">
                      {checkpoint.total_commission.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-bold text-white font-mono">
                      {(checkpoint.total_cash_prizes || 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          checkpoint.is_settled
                            ? "bg-green-900/60 text-green-300"
                            : "bg-yellow-900/60 text-yellow-300"
                        }`}
                      >
                        {checkpoint.is_settled ? "Settled" : "Unsettled"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleViewReport(checkpoint)}
                        className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-blue-400/10 rounded-lg transition-colors"
                        title="View report"
                      >
                        <FileText size={16} />
                      </button>
                    </td>
                  </tr>
                )}
              />
            )}
          </div>
        </div>
      </div>

      {/* Report Modal (nested) */}
      {selectedCheckpoint && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setSelectedCheckpoint(null)}
        >
          <div
            className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-2xl max-h-[80vh] overflow-y-auto shadow-2xl animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <FileText className="w-5 h-5 text-blue-400" />
                  Checkpoint Report
                </h3>
                <button
                  onClick={() => setSelectedCheckpoint(null)}
                  className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="mb-6">
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <p className="text-sm text-slate-400">Date</p>
                    <p className="text-white font-medium">
                      {format(
                        new Date(selectedCheckpoint.checkpoint_date),
                        "MMM dd, yyyy",
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-400">Period</p>
                    <p className="text-white font-medium">
                      {format(
                        new Date(selectedCheckpoint.period_start),
                        "MMM dd, yyyy",
                      )}{" "}
                      -{" "}
                      {format(
                        new Date(selectedCheckpoint.period_end),
                        "MMM dd, yyyy",
                      )}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-slate-400">Status</p>
                    <p
                      className={`font-medium ${
                        selectedCheckpoint.is_settled
                          ? "text-green-400"
                          : "text-yellow-400"
                      }`}
                    >
                      {selectedCheckpoint.is_settled ? "Settled" : "Unsettled"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-400">Tickets Sold</p>
                    <p className="text-white font-medium">
                      {selectedCheckpoint.total_tickets}
                    </p>
                  </div>
                </div>
              </div>

              {reportLoading ? (
                <div className="flex items-center justify-center py-8 text-slate-400">
                  <RefreshCw size={16} className="animate-spin mr-2" />
                  Loading report...
                </div>
              ) : reportData ? (
                <div className="space-y-4">
                  <div className="bg-slate-900 rounded-lg p-4">
                    <h4 className="font-medium text-white mb-3">
                      Period Summary
                    </h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-slate-400">Total Sales</p>
                        <p className="text-red-400 font-bold text-lg">
                          {reportData.total_sales.toLocaleString()} LBP
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-slate-400">
                          Commission Earned
                        </p>
                        <p className="text-green-400 font-bold text-lg">
                          {reportData.total_commission.toLocaleString()} LBP
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-slate-400">Tickets Sold</p>
                        <p className="text-white font-bold text-lg">
                          {reportData.total_tickets}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-slate-400">
                          Cash Prizes Paid
                        </p>
                        <p className="text-white font-bold text-lg">
                          {(reportData.total_cash_prizes || 0).toLocaleString()}{" "}
                          LBP
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-900 rounded-lg p-4">
                    <h4 className="font-medium text-white mb-3">
                      Additional Info
                    </h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-slate-400">
                          Outstanding Prizes
                        </p>
                        <p className="text-white font-bold">
                          {reportData.outstanding_prizes.toLocaleString()} LBP
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-slate-400">Total Fees</p>
                        <p className="text-white font-bold">
                          {reportData.total_fees.toLocaleString()} LBP
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-slate-400">
                  No report data available
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
