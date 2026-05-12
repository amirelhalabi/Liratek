import { useState } from "react";
import {
  History,
  RefreshCw,
  X,
  Send,
  ArrowDownToLine,
  Pencil,
  Check,
  Phone,
  AlertTriangle,
} from "lucide-react";
import { DataTable } from "@liratek/ui";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import { useDateRangeFilter } from "@/shared/hooks/useDateRangeFilter";
import { DateRangeFilter } from "@/shared/components/DateRangeFilter";
import { EditHistoryPopover } from "@/shared/components/EditHistoryPopover";
import type { FinancialTransaction, ServiceType } from "../types";
import { FINANCIAL_SERVICE_ICONS } from "../types";

const ICON_COMPONENTS = {
  Send: Send,
  ArrowDownToLine: ArrowDownToLine,
};

function getIconComponent(iconKey: string) {
  return (
    ICON_COMPONENTS[iconKey as keyof typeof ICON_COMPONENTS] ||
    ICON_COMPONENTS.Send
  );
}

interface EditForm {
  phone_number: string;
  client_name: string;
  note: string;
}

interface HistoryModalProps {
  transactions: FinancialTransaction[];
  provider: string;
  onClose: () => void;
  onRefresh: () => void;
  formatAmount?: (val: number, currency: string) => string;
  amountLabel?: string;
  /** Override the "Profit" column header (e.g. "Fees" for financial services) */
  profitLabel?: string;
  /** When true, show separate "Fee" and "Profit" columns instead of a single column.
   *  Fee = commission when cost is 0 (transfers), Profit = commission when cost > 0 (bills) */
  showFeeAndProfit?: boolean;
  /** When true, the amount (credits) column always displays in USD regardless of the transaction currency */
  amountAlwaysUsd?: boolean;
  /**
   * When provided, each row shows a pencil icon that opens inline edit mode.
   * Editable fields: phone_number, client_name, note.
   */
  onUpdateMetadata?: (
    id: number,
    data: { phone_number?: string; client_name?: string; note?: string },
  ) => Promise<{ success: boolean; error?: string }>;
  /** Margin override threshold in LBP for showing theft detection alert. Default: 100,000 */
  marginAlertThreshold?: number;
}

export function HistoryModal({
  transactions,
  provider,
  onClose,
  onRefresh,
  formatAmount = (val, currency) =>
    `${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`,
  amountLabel = "Amount",
  profitLabel = "Profit",
  showFeeAndProfit = false,
  amountAlwaysUsd = false,
  onUpdateMetadata,
  marginAlertThreshold = 100_000,
}: HistoryModalProps) {
  useModalFocusFix(true);
  const { filteredData, from, to, setFrom, setTo } = useDateRangeFilter(
    transactions,
    "created_at",
  );

  // ── Inline edit state ───────────────────────────────────────────────
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    phone_number: "",
    client_name: "",
    note: "",
  });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function startEdit(tx: FinancialTransaction) {
    setEditingId(tx.id);
    setEditForm({
      phone_number: tx.phone_number ?? "",
      client_name: tx.client_name ?? "",
      note: tx.note ?? "",
    });
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function saveEdit(id: number) {
    if (!onUpdateMetadata) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const result = await onUpdateMetadata(id, {
        phone_number: editForm.phone_number,
        client_name: editForm.client_name,
        note: editForm.note,
      });
      if (result.success) {
        setEditingId(null);
        onRefresh();
      } else {
        setEditError(result.error ?? "Failed to save");
      }
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setEditSaving(false);
    }
  }

  // Column count: base cols + Phone (when editable) + Edit action
  // Used for the expansion row colspan
  const baseColCount =
    7 + (showFeeAndProfit ? 1 : 0) + (onUpdateMetadata ? 2 : 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-5xl max-h-[85vh] bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl flex flex-col animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/60">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <History className="text-slate-400" size={18} />
            {provider} Transaction History
            <span className="text-xs text-slate-500 font-normal ml-1">
              ({filteredData.length} records)
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
              onClick={onRefresh}
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
        <div className="flex-1 min-h-0 overflow-auto p-4">
          <DataTable
            columns={[
              {
                header: "Type",
                className: "px-5 py-3",
                sortKey: "service_type",
              },
              {
                header: amountLabel,
                className: "px-5 py-3",
                sortKey: "amount",
              },
              {
                header: "Cost",
                className: "px-5 py-3",
                sortKey: "cost",
              },
              ...(showFeeAndProfit
                ? [
                    {
                      header: "Fee",
                      className: "px-5 py-3",
                      sortKey: "fee",
                    },
                    {
                      header: "Profit",
                      className: "px-5 py-3",
                      sortKey: "profit",
                    },
                  ]
                : [
                    {
                      header: profitLabel,
                      className: "px-5 py-3",
                      sortKey: "commission",
                    },
                  ]),
              {
                header: "Client",
                className: "px-5 py-3",
                sortKey: "client_name",
              },
              ...(onUpdateMetadata
                ? [
                    {
                      header: "Phone",
                      className: "px-5 py-3",
                      sortKey: "phone_number",
                    },
                  ]
                : []),
              {
                header: "Payment",
                className: "px-5 py-3",
                sortKey: "paid_by",
              },
              {
                header: "Time",
                className: "px-5 py-3",
                sortKey: "created_at",
              },
              ...(onUpdateMetadata
                ? [{ header: "", className: "px-3 py-3 w-10" }]
                : []),
            ]}
            data={filteredData}
            exportExcel
            exportPdf
            exportFilename={`${provider.toLowerCase()}-history`}
            className="w-full"
            theadClassName="bg-slate-900/50 text-left text-xs font-medium text-slate-400 uppercase tracking-wider sticky top-0"
            tbodyClassName="divide-y divide-slate-700/50"
            emptyMessage={`No ${provider} transactions yet.`}
            renderRow={(tx) => {
              const Icon = getIconComponent(
                FINANCIAL_SERVICE_ICONS[tx.service_type as ServiceType],
              );
              const isRefunded = Boolean(tx.is_refunded);
              const isEditing = editingId === tx.id;
              const wasEdited = Boolean(tx.edited_by);

              // Margin alert: theft detection when price was manually changed
              // price_to_client = cost + commission (reconstructed from mapped data)
              const actualPrice = (tx.cost ?? 0) + tx.commission;
              const marginOverride =
                tx.default_price_to_client != null
                  ? actualPrice - tx.default_price_to_client
                  : 0;
              const showMarginAlert =
                tx.default_price_to_client != null &&
                actualPrice !== tx.default_price_to_client &&
                marginOverride > marginAlertThreshold;

              return (
                <>
                  <tr
                    key={tx.id}
                    className={`group hover:bg-slate-700/20 transition-colors${isRefunded ? " opacity-50" : ""}${isEditing ? " bg-slate-800/60" : ""}`}
                  >
                    {/* Type */}
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2 text-slate-300">
                        <Icon width={14} height={14} />
                        <span className="text-sm">
                          {tx.service_type === "SEND" ? "Out" : "In"}
                        </span>
                        {isRefunded && (
                          <span className="ml-2 inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                            Refunded
                          </span>
                        )}
                        {showMarginAlert && (
                          <span
                            className="ml-2 inline-flex items-center gap-1 rounded-full bg-red-500/15 border border-red-500/40 px-2 py-0.5 text-[10px] font-semibold text-red-400 cursor-help"
                            title={`Price to client was modified — margin: ${marginOverride.toLocaleString()} LBP`}
                          >
                            <AlertTriangle size={10} />
                            Margin
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Amount */}
                    <td className="px-5 py-3 text-sm font-medium text-white">
                      {formatAmount(
                        tx.amount,
                        amountAlwaysUsd ? "USD" : tx.currency,
                      )}
                    </td>

                    {/* Cost */}
                    <td className="px-5 py-3 text-sm text-slate-300">
                      {formatAmount(tx.cost ?? 0, tx.currency)}
                    </td>

                    {/* Profit / Fee + Profit */}
                    {showFeeAndProfit ? (
                      <>
                        <td className="px-5 py-3 text-sm font-bold text-amber-400">
                          {(tx.cost ?? 0) === 0 && tx.commission !== 0
                            ? formatAmount(tx.commission, tx.currency)
                            : "—"}
                        </td>
                        <td className="px-5 py-3 text-sm font-bold text-emerald-400">
                          {(tx.cost ?? 0) > 0
                            ? formatAmount(tx.commission, tx.currency)
                            : "—"}
                        </td>
                      </>
                    ) : (
                      <td className="px-5 py-3 text-sm font-bold text-emerald-400">
                        {formatAmount(tx.commission, tx.currency)}
                      </td>
                    )}

                    {/* Client */}
                    <td className="px-5 py-3">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editForm.client_name}
                          onChange={(e) =>
                            setEditForm((f) => ({
                              ...f,
                              client_name: e.target.value,
                            }))
                          }
                          className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-orange-500"
                          placeholder="Client name"
                        />
                      ) : (
                        <div>
                          <span className="text-sm text-slate-300">
                            {tx.client_name || "—"}
                          </span>
                          {wasEdited && (
                            <EditHistoryPopover
                              entityType="recharge"
                              entityId={tx.id}
                              trigger={
                                <span
                                  className="ml-2 inline-flex items-center gap-1 rounded-full bg-yellow-500/10 border border-yellow-500/30 px-1.5 py-0.5 text-[10px] font-medium text-yellow-400 cursor-pointer hover:bg-yellow-500/20 transition-colors"
                                  title={`Edited by ${tx.edited_by}${tx.edited_at ? ` at ${new Date(tx.edited_at).toLocaleString()}` : ""}`}
                                >
                                  <Pencil size={8} />
                                  Edited
                                </span>
                              }
                            />
                          )}
                        </div>
                      )}
                    </td>

                    {/* Phone (only when editable) */}
                    {onUpdateMetadata && (
                      <td className="px-5 py-3">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editForm.phone_number}
                            onChange={(e) =>
                              setEditForm((f) => ({
                                ...f,
                                phone_number: e.target.value,
                              }))
                            }
                            className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-orange-500"
                            placeholder="Phone number"
                          />
                        ) : (
                          <div className="flex items-center gap-1 text-sm text-slate-400">
                            {tx.phone_number ? (
                              <>
                                <Phone size={11} className="shrink-0" />
                                {tx.phone_number}
                              </>
                            ) : (
                              "—"
                            )}
                          </div>
                        )}
                      </td>
                    )}

                    {/* Payment */}
                    <td className="px-5 py-3 text-sm text-slate-300">
                      {tx.paid_by || "—"}
                    </td>

                    {/* Time */}
                    <td className="px-5 py-3 text-sm text-slate-400">
                      {new Date(tx.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      <div className="text-xs text-slate-500">
                        {new Date(tx.created_at).toLocaleDateString()}
                      </div>
                    </td>

                    {/* Edit action */}
                    {onUpdateMetadata && (
                      <td className="px-3 py-3 text-right">
                        {isEditing ? (
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => saveEdit(tx.id)}
                              disabled={editSaving}
                              className="p-1.5 rounded bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 transition-colors disabled:opacity-50"
                              title="Save"
                            >
                              <Check size={13} />
                            </button>
                            <button
                              onClick={cancelEdit}
                              disabled={editSaving}
                              className="p-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-400 transition-colors"
                              title="Cancel"
                            >
                              <X size={13} />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => startEdit(tx)}
                            className="p-1.5 rounded hover:bg-slate-700 text-slate-500 hover:text-slate-300 transition-colors"
                            title="Edit metadata"
                          >
                            <Pencil size={13} />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>

                  {/* Note edit row — only shown in edit mode */}
                  {isEditing && (
                    <tr className="bg-slate-800/40">
                      <td
                        colSpan={baseColCount}
                        className="px-5 py-2 border-t border-slate-700/40"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-slate-500 shrink-0 w-10">
                            Note
                          </span>
                          <input
                            type="text"
                            value={editForm.note}
                            onChange={(e) =>
                              setEditForm((f) => ({
                                ...f,
                                note: e.target.value,
                              }))
                            }
                            className="flex-1 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-orange-500"
                            placeholder="Add a note (optional)"
                          />
                          {editError && (
                            <span className="text-xs text-red-400">
                              {editError}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            }}
          />
        </div>
      </div>
    </div>
  );
}
