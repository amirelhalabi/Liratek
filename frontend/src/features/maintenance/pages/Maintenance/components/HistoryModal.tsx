import { Wrench, RefreshCw, X, Ban, Pencil, Printer } from "lucide-react";
import { DataTable, useApi, DateRangeFilter } from "@liratek/ui";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import { useDateRangeFilter } from "@/shared/hooks/useDateRangeFilter";
import { EditHistoryPopover } from "@/shared/components/EditHistoryPopover";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import { UsdLbpTotalChips } from "@/shared/components/UsdLbpTotalChips";
import { usdLbpTotals } from "@/shared/utils/usdLbpTotals";
import { useShopInfo } from "@/hooks/useShopName";
import { getTransactionBySource } from "@/api/backendApi";
import { printServiceReceiptByTransaction } from "@/shared/utils/serviceReceipt";
import { isReceiptableTransaction } from "@/features/audit/receiptGating";
import { getLabourAmounts } from "./jobAmounts";
import { ListVsCharged } from "./ListVsChargedAmount";
import { useTranslation } from "react-i18next";
import { useFormat } from "@/i18n/useFormat";
import { formatNumber } from "@liratek/ui/i18n/format";
import { Ltr } from "@liratek/ui/components/ui/Ltr";
import { statusLabel } from "./statusLabel";

/** Two-decimal USD amounts, as `toLocaleString(undefined, …)` printed them. */
const USD_DECIMALS: Intl.NumberFormatOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

type MaintenanceJob = {
  id: number;
  device_name: string;
  issue_description: string;
  created_at?: string;
  cost_usd?: number;
  price_usd?: number;
  cost_lbp?: number;
  price_lbp?: number;
  currency?: string;
  client_name?: string | null;
  client_phone?: string | null;
  status: string;
  paid_usd?: number;
  paid_lbp?: number;
  discount_usd?: number;
  parts_price_usd?: number;
  final_amount_usd?: number;
  final_amount_lbp?: number;
  is_refunded?: number;
  refunded_at?: string | null;
  edited_by?: string | null;
  edited_at?: string | null;
};

interface HistoryModalProps {
  jobs: MaintenanceJob[];
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onVoid: (id: number) => void;
  onEdit: (job: MaintenanceJob) => void;
}

function getStatusColor(status: string) {
  switch (status) {
    case "Received":
      return "text-blue-400 bg-blue-400/10";
    case "In_Progress":
      return "text-amber-400 bg-amber-400/10";
    case "Ready":
      return "text-emerald-400 bg-emerald-400/10";
    case "Delivered":
      return "text-slate-400 bg-slate-400/10";
    default:
      return "text-slate-400 bg-slate-400/10";
  }
}

export function HistoryModal({
  jobs,
  loading,
  onClose,
  onRefresh,
  onVoid,
  onEdit,
}: HistoryModalProps) {
  useModalFocusFix(true);
  const { t } = useTranslation("maintenance");
  const { t: tc } = useTranslation("common");
  const { formatDate } = useFormat();
  const { filteredData, from, to, setFrom, setTo } = useDateRangeFilter(
    jobs,
    "created_at",
  );
  // Totals of the rows on screen — the Price column (labour charged, in the
  // job's currency), refunded left out.
  const totals = usdLbpTotals(filteredData, (job) => {
    const { currency, charged } = getLabourAmounts(job);
    return currency === "LBP"
      ? { usd: 0, lbp: charged }
      : { usd: charged, lbp: 0 };
  });
  const shopInfo = useShopInfo();
  const api = useApi();

  async function handlePrint(job: MaintenanceJob) {
    try {
      const txn = await getTransactionBySource("maintenance", job.id);
      const txnId = (txn as { id?: number } | null)?.id;
      if (!txnId) return; // voided rows resolve to null — nothing to print
      await printServiceReceiptByTransaction(api, txnId, shopInfo);
    } catch {
      // Best-effort reprint — never throw into the table's click handler.
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-6xl max-h-[85vh] bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl flex flex-col animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/60">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Wrench className="text-slate-400" size={18} />
            {t("history.title")}
            <span className="text-xs text-slate-500 font-normal ms-1">
              {t("history.records", { total: filteredData.length })}
            </span>
          </h2>
          <div className="flex items-center gap-2">
            <UsdLbpTotalChips usd={totals.usd} lbp={totals.lbp} />
            <DateRangeFilter
              from={from}
              to={to}
              onFromChange={setFrom}
              onToChange={setTo}
            />
            <button
              onClick={onRefresh}
              className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
              title={tc("actions.refresh")}
            >
              <RefreshCw size={14} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
              title={tc("actions.close")}
            >
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-500">
              <RefreshCw size={20} className="animate-spin me-2" />
              {tc("state.loading")}
            </div>
          ) : (
            <DataTable<MaintenanceJob>
              columns={[
                {
                  header: t("history.date"),
                  className: "px-6 py-3",
                  sortKey: "created_at",
                },
                {
                  header: t("history.client"),
                  className: "px-6 py-3",
                  sortKey: "client_name",
                },
                {
                  header: t("history.deviceIssue"),
                  className: "px-6 py-3",
                  sortKey: "device_name",
                },
                {
                  header: t("history.status"),
                  className: "px-6 py-3",
                  sortKey: "status",
                },
                {
                  header: t("history.price"),
                  className: "px-6 py-3 text-end",
                  sortKey: "price_usd",
                },
                {
                  header: t("history.paid"),
                  className: "px-6 py-3 text-end",
                },
                {
                  header: t("history.actions"),
                  className: "px-6 py-3 text-end",
                },
              ]}
              data={filteredData}
              exportExcel
              exportPdf
              exportFilename="maintenance-history"
              className="w-full"
              theadClassName="bg-slate-900/50 text-start text-xs font-medium text-slate-400 uppercase tracking-wider sticky top-0"
              tbodyClassName="divide-y divide-slate-700/50"
              emptyMessage={t("history.empty")}
              renderRow={(job) => {
                const isRefunded = Boolean(job.is_refunded);
                const labour = getLabourAmounts(job);
                return (
                  <tr
                    key={job.id}
                    className={`hover:bg-slate-700/20 transition-colors group${isRefunded ? " opacity-50" : ""}`}
                  >
                    <td className="px-6 py-4 text-sm text-slate-400 whitespace-nowrap">
                      {job.created_at
                        ? formatDate(parseDbDate(job.created_at), {
                            year: "numeric",
                            month: "numeric",
                            day: "numeric",
                          })
                        : ""}
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-white flex items-center gap-1">
                        {job.client_name || t("history.unknown")}
                        {isRefunded && (
                          <span className="ms-2 inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                            {t("history.refunded")}
                          </span>
                        )}
                        {job.edited_by && (
                          <EditHistoryPopover
                            entityType="maintenance"
                            entityId={job.id}
                            trigger={
                              <span className="ms-2 inline-flex items-center gap-1 rounded-full bg-yellow-500/10 border border-yellow-500/30 px-1.5 py-0.5 text-[10px] font-medium text-yellow-400 cursor-pointer hover:bg-yellow-500/20 transition-colors">
                                <Pencil size={8} />
                                {t("history.edited")}
                              </span>
                            }
                          />
                        )}
                      </div>
                      {job.client_phone && (
                        <div className="text-xs text-slate-500">
                          <Ltr>{job.client_phone}</Ltr>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                        <span className="inline-flex items-center gap-0.5 text-[11px] font-mono text-emerald-400 shrink-0">
                          ↑{" "}
                          {job.currency === "LBP"
                            ? `${formatNumber(job.price_lbp ?? 0)} LBP`
                            : `$${formatNumber(job.price_usd ?? 0, USD_DECIMALS)}`}
                        </span>
                        <span className="text-sm font-bold text-white">
                          {job.device_name}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 truncate max-w-[200px]">
                        {job.issue_description}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(job.status || "")}`}
                      >
                        {statusLabel(job.status || "", t)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm font-bold text-white text-end whitespace-nowrap">
                      {/* LIRA-185 D6: list price struck through next to the
                          labour amount actually charged, when they differ. */}
                      <ListVsCharged
                        {...labour}
                        format={(n) =>
                          labour.currency === "LBP"
                            ? `${formatNumber(n)} LBP`
                            : `$${formatNumber(n, USD_DECIMALS)}`
                        }
                      />
                    </td>
                    <td className="px-6 py-4 text-sm text-emerald-400 text-end">
                      {(job.paid_lbp ?? 0) > 0 && (
                        <div>{formatNumber(job.paid_lbp ?? 0)} LBP</div>
                      )}
                      {((job.paid_usd ?? 0) > 0 ||
                        (job.paid_lbp ?? 0) === 0) && (
                        <div>
                          $
                          {formatNumber(job.paid_usd ?? 0, USD_DECIMALS)}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-end">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => onEdit(job)}
                          className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded"
                        >
                          <Wrench size={16} />
                        </button>
                        <button
                          onClick={() => onVoid(job.id)}
                          className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded"
                          title={t("history.void")}
                        >
                          <Ban size={16} />
                        </button>
                        {isReceiptableTransaction({ type: "MAINTENANCE" }) && (
                          <button
                            onClick={() => handlePrint(job)}
                            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded"
                            title={t("history.print")}
                          >
                            <Printer size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
