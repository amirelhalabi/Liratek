import { useState, useEffect } from "react";
import { useApi, DataTable, DateRangeFilter } from "@liratek/ui";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import { useDateRangeFilter } from "@/shared/hooks/useDateRangeFilter";
import {
  Calendar,
  RefreshCw,
  X,
  FileText,
  TrendingDown,
  TrendingUp,
  Package,
  Trash2,
  Pencil,
  Check,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "@liratek/ui/i18n/format";
import { useFormat } from "@/i18n/useFormat";

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
  is_refunded?: number;
  refunded_at?: string | null;
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
  useModalFocusFix(true);
  const api = useApi();
  const { t } = useTranslation("loto");
  const { t: tc } = useTranslation("common");
  const { formatDate } = useFormat();
  // Same output as date-fns "MMM dd, yyyy" / "MMM dd" in English.
  const fmtDay = (d: string) =>
    formatDate(new Date(d), { month: "short", day: "2-digit", year: "numeric" });
  const fmtShort = (d: string) =>
    formatDate(new Date(d), { month: "short", day: "2-digit" });
  const [checkpoints, setCheckpoints] = useState<LotoCheckpoint[]>([]);
  const { filteredData, from, to, setFrom, setTo } = useDateRangeFilter(
    checkpoints,
    "checkpoint_date",
  );
  const [selectedCheckpoint, setSelectedCheckpoint] =
    useState<LotoCheckpoint | null>(null);
  const [reportData, setReportData] = useState<CheckpointReportData | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editNoteValue, setEditNoteValue] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  function startEdit(checkpoint: LotoCheckpoint) {
    setEditingId(checkpoint.id);
    setEditNoteValue(checkpoint.note ?? "");
  }

  async function handleSaveEdit() {
    if (editingId === null) return;
    setEditSaving(true);
    try {
      // MUST target the checkpoint channel, not `api.loto.updateMetadata`
      // (IPC `loto:update-metadata` / REST `/api/loto/update-metadata`).
      // `editingId` is a `loto_checkpoints` row id, but that channel resolves
      // ids against `loto_tickets` (`LotoService.updateLotoMetadata` calls
      // `ticketRepo.getTicketById(id)`). Both tables are
      // `INTEGER PRIMARY KEY AUTOINCREMENT` starting at 1, so ids collide
      // routinely — the old code silently wrote this note onto an unrelated
      // loto TICKET whenever a ticket happened to share the checkpoint's id,
      // or returned "Loto ticket not found" otherwise; either way the
      // checkpoint's own note never saved. `loto_checkpoints` has its own
      // `note` column, persisted via `LotoCheckpointRepository.updateCheckpoint`
      // — reach it through `api.loto.checkpoint.update`, the same
      // checkpoint-scoped namespace `loadCheckpoints` already uses above.
      // Note: `loto:checkpoint:update` is admin-only (`loto:update-metadata`
      // was admin+staff), so this fix narrows who can edit a checkpoint note.
      // That's intended — the staff path never actually worked (it either
      // failed or corrupted a ticket), so no working capability is lost, and
      // checkpoint fields like `total_sales`/`is_settled`/`settlement_id` are
      // correctly admin-gated on this channel. Do not widen it to staff.
      const result = await api.loto.checkpoint.update(editingId, {
        note: editNoteValue,
      });
      if (result.success) {
        setEditingId(null);
        await loadCheckpoints();
      } else {
        alert(result.error ?? t("history.saveFailed"));
      }
    } finally {
      setEditSaving(false);
    }
  }

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

  async function handleDeleteCheckpoint(checkpoint: LotoCheckpoint) {
    if (checkpoint.is_settled) return;
    const confirmed = window.confirm(
      t("history.deleteConfirm", {
        id: checkpoint.id,
        date: fmtDay(checkpoint.checkpoint_date),
      }),
    );
    if (!confirmed) return;
    try {
      const result = await api.loto.checkpoint.delete(checkpoint.id);
      if (result.success) {
        await loadCheckpoints();
      } else {
        alert(result.error || t("history.deleteFailed"));
      }
    } catch {
      alert(t("history.deleteFailed"));
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
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 animate-in fade-in duration-200"
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
              {t("history.title")}
              <span className="text-xs text-slate-500 font-normal ms-1">
                {t("history.records", { total: filteredData.length })}
              </span>
            </h2>
            <div className="flex items-center gap-2">
              <DateRangeFilter
                from={from}
                to={to}
                onFromChange={setFrom}
                onToChange={setTo}
              />
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                title={tc("actions.close")}
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
                    <p className="text-xs text-slate-400">{t("history.unsettledSales")}</p>
                    <p className="text-base font-bold text-red-400">
                      {formatNumber(totalUnsettledSales)} LBP
                    </p>
                  </div>
                  <TrendingDown className="w-5 h-5 text-red-400" />
                </div>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700/50">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-slate-400">
                      {t("history.unsettledCommission")}
                    </p>
                    <p className="text-base font-bold text-green-400">
                      {formatNumber(totalUnsettledCommission)} LBP
                    </p>
                  </div>
                  <TrendingUp className="w-5 h-5 text-green-400" />
                </div>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700/50">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-slate-400">
                      {t("history.unsettledCheckpoints")}
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
                <RefreshCw size={20} className="animate-spin me-2" />
                {tc("state.loading")}
              </div>
            ) : (
              <DataTable<LotoCheckpoint>
                columns={[
                  {
                    header: t("history.date"),
                    className: "px-4 py-3",
                    sortKey: "checkpoint_date",
                  },
                  { header: t("history.period"), className: "px-4 py-3" },
                  {
                    header: t("history.tickets"),
                    className: "px-4 py-3 text-end",
                    sortKey: "total_tickets",
                  },
                  {
                    header: t("history.sales"),
                    className: "px-4 py-3 text-end",
                    sortKey: "total_sales",
                  },
                  {
                    header: t("history.commission"),
                    className: "px-4 py-3 text-end",
                    sortKey: "total_commission",
                  },
                  {
                    header: t("history.cashPrizes"),
                    className: "px-4 py-3 text-end",
                    sortKey: "total_cash_prizes",
                  },
                  {
                    header: t("history.status"),
                    className: "px-4 py-3 text-center",
                  },
                  {
                    header: t("history.actions"),
                    className: "px-4 py-3 text-center",
                  },
                ]}
                data={filteredData}
                exportExcel
                exportPdf
                exportFilename="loto-checkpoint-history"
                className="w-full"
                theadClassName="bg-slate-900/50 text-start text-xs font-medium text-slate-400 uppercase tracking-wider sticky top-0"
                tbodyClassName="divide-y divide-slate-700/50"
                emptyMessage={t("history.empty")}
                renderRow={(checkpoint) => {
                  const isRefunded = Boolean(checkpoint.is_refunded);
                  const isEditing = editingId === checkpoint.id;
                  return (
                    <>
                      <tr
                        key={checkpoint.id}
                        className={`hover:bg-slate-700/20 transition-colors${isRefunded ? " opacity-50" : ""}`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 text-sm text-white font-medium">
                            <Calendar className="w-3.5 h-3.5 text-slate-400" />
                            {fmtDay(checkpoint.checkpoint_date)}
                            {isRefunded && (
                              <span className="ms-2 inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                                {t("history.refunded")}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-xs text-slate-400">
                            {fmtShort(checkpoint.period_start)}{" "}
                            -{" "}
                            {fmtDay(checkpoint.period_end)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-end text-sm font-medium text-white font-mono">
                          {checkpoint.total_tickets}
                        </td>
                        <td className="px-4 py-3 text-end text-sm font-bold text-red-400 font-mono">
                          <span className="me-1 opacity-70">↓</span>
                          {formatNumber(checkpoint.total_sales)}
                        </td>
                        <td className="px-4 py-3 text-end text-sm font-bold text-green-400 font-mono">
                          <span className="me-1 opacity-70">↑</span>
                          {formatNumber(checkpoint.total_commission)}
                        </td>
                        <td className="px-4 py-3 text-end text-sm font-bold text-white font-mono">
                          {formatNumber(checkpoint.total_cash_prizes || 0)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              checkpoint.is_settled
                                ? "bg-green-900/60 text-green-300"
                                : "bg-yellow-900/60 text-yellow-300"
                            }`}
                          >
                            {checkpoint.is_settled
                              ? t("history.settled")
                              : t("history.unsettled")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => handleViewReport(checkpoint)}
                              className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-blue-400/10 rounded-lg transition-colors"
                              title={t("history.viewReport")}
                            >
                              <FileText size={16} />
                            </button>
                            {isEditing ? (
                              <>
                                <button
                                  onClick={handleSaveEdit}
                                  disabled={editSaving}
                                  className="p-1.5 text-emerald-400 hover:bg-emerald-400/10 rounded-lg transition-colors disabled:opacity-50"
                                  title={tc("actions.save")}
                                >
                                  <Check size={15} />
                                </button>
                                <button
                                  onClick={() => setEditingId(null)}
                                  className="p-1.5 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors"
                                  title={tc("actions.cancel")}
                                >
                                  <X size={15} />
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => startEdit(checkpoint)}
                                className="p-1.5 text-slate-500 hover:text-orange-400 hover:bg-orange-400/10 rounded-lg transition-colors"
                                title={t("history.editNote")}
                              >
                                <Pencil size={14} />
                              </button>
                            )}
                            {!checkpoint.is_settled && (
                              <button
                                onClick={() =>
                                  handleDeleteCheckpoint(checkpoint)
                                }
                                className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                                title={t("history.deleteCheckpoint")}
                              >
                                <Trash2 size={16} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isEditing && (
                        <tr className="bg-slate-800/60 border-b border-slate-700/50">
                          <td colSpan={8} className="px-4 py-3">
                            <div className="flex items-end gap-3">
                              <div className="flex-1">
                                <label className="text-xs text-slate-400 block mb-1">
                                  {t("history.note")}
                                </label>
                                <input
                                  autoFocus
                                  value={editNoteValue}
                                  onChange={(e) =>
                                    setEditNoteValue(e.target.value)
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") handleSaveEdit();
                                    if (e.key === "Escape") setEditingId(null);
                                  }}
                                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-orange-500"
                                  placeholder={t("history.notePlaceholder")}
                                />
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Report Modal (nested) */}
      {selectedCheckpoint && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 animate-in fade-in duration-200"
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
                  {t("report.title")}
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
                    <p className="text-sm text-slate-400">{t("history.date")}</p>
                    <p className="text-white font-medium">
                      {fmtDay(selectedCheckpoint.checkpoint_date)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-400">{t("history.period")}</p>
                    <p className="text-white font-medium">
                      {fmtDay(selectedCheckpoint.period_start)}{" "}
                      -{" "}
                      {fmtDay(selectedCheckpoint.period_end)}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-slate-400">{t("history.status")}</p>
                    <p
                      className={`font-medium ${
                        selectedCheckpoint.is_settled
                          ? "text-green-400"
                          : "text-yellow-400"
                      }`}
                    >
                      {selectedCheckpoint.is_settled
                        ? t("history.settled")
                        : t("history.unsettled")}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-400">{t("stats.ticketsSold")}</p>
                    <p className="text-white font-medium">
                      {selectedCheckpoint.total_tickets}
                    </p>
                  </div>
                </div>
              </div>

              {reportLoading ? (
                <div className="flex items-center justify-center py-8 text-slate-400">
                  <RefreshCw size={16} className="animate-spin me-2" />
                  {t("report.loading")}
                </div>
              ) : reportData ? (
                <div className="space-y-4">
                  <div className="bg-slate-900 rounded-lg p-4">
                    <h4 className="font-medium text-white mb-3">
                      {t("report.periodSummary")}
                    </h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-slate-400">{t("stats.totalSales")}</p>
                        <p className="text-red-400 font-bold text-lg">
                          {formatNumber(reportData.total_sales)} LBP
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-slate-400">
                          {t("report.commissionEarned")}
                        </p>
                        <p className="text-green-400 font-bold text-lg">
                          {formatNumber(reportData.total_commission)} LBP
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-slate-400">{t("stats.ticketsSold")}</p>
                        <p className="text-white font-bold text-lg">
                          {reportData.total_tickets}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-slate-400">
                          {t("report.cashPrizesPaid")}
                        </p>
                        <p className="text-white font-bold text-lg">
                          {formatNumber(reportData.total_cash_prizes || 0)} LBP
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-900 rounded-lg p-4">
                    <h4 className="font-medium text-white mb-3">
                      {t("report.additional")}
                    </h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-slate-400">
                          {t("report.outstanding")}
                        </p>
                        <p className="text-white font-bold">
                          {formatNumber(reportData.outstanding_prizes)} LBP
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-slate-400">{t("report.totalFees")}</p>
                        <p className="text-white font-bold">
                          {formatNumber(reportData.total_fees)} LBP
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-slate-400">
                  {t("report.empty")}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
