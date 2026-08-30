import { useState } from "react";
import {
  History,
  RefreshCw,
  X,
  Ban,
  User,
  Phone,
  Pencil,
  Check,
  Tag,
  Printer,
} from "lucide-react";
import { DataTable, useApi } from "@liratek/ui";
import {
  FULFILLMENT_STATUSES,
  TERMINAL_FULFILLMENT_STATUS,
  type FulfillmentStatus,
} from "@liratek/core";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import { useDateRangeFilter } from "@/shared/hooks/useDateRangeFilter";
import { DateRangeFilter } from "@/shared/components/DateRangeFilter";
import { EditHistoryPopover } from "@/shared/components/EditHistoryPopover";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import { useShopInfo } from "@/hooks/useShopName";
import { getTransactionBySource, refundTransaction } from "@/api/backendApi";
import { printServiceReceiptByTransaction } from "@/shared/utils/serviceReceipt";
import { isReceiptableTransaction } from "@/features/audit/receiptGating";
import logger from "@/utils/logger";
import type { CustomServiceEntry } from "../../../hooks/useCustomServices";

/** LIRA-155 — the category that is fulfilment-tracked. Matches
 *  `INSURANCE_CATEGORY` in `../index.tsx` (kept as a local literal, not an
 *  import, to avoid a circular import between the two — the same choice
 *  already made here for "hold_money"/"digital_account" below). */
const INSURANCE_CATEGORY = "insurance";

/** Display label + badge styling for a fulfilment status — mirrors
 *  Maintenance's `statusBadge` (`features/maintenance/pages/Maintenance/
 *  index.tsx`), same 4-step shape (not-yet-physical -> physical ->
 *  handed-over), one color per step. */
function fulfillmentBadge(status: FulfillmentStatus): {
  label: string;
  className: string;
} {
  switch (status) {
    case "ORDERED":
      return {
        label: "Ordered",
        className: "bg-blue-500/10 text-blue-400 border border-blue-500/30",
      };
    case "ISSUED":
      return {
        label: "Issued",
        className: "bg-amber-500/10 text-amber-400 border border-amber-500/30",
      };
    case "RECEIVED":
      return {
        label: "Received",
        className:
          "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30",
      };
    case "DELIVERED":
      return {
        label: "Delivered",
        className: "bg-slate-500/10 text-slate-300 border border-slate-500/30",
      };
  }
}

/** The single legal next step, or null when `status` is terminal. STRICT
 *  forward-only single-step (see `@liratek/core`'s `insuranceFulfillment.ts`)
 *  — there is never more than one option to offer, so "an illegal transition
 *  is offered" cannot arise here: there is no menu, only this one button. */
function nextFulfillmentStatus(
  status: FulfillmentStatus,
): FulfillmentStatus | null {
  if (status === TERMINAL_FULFILLMENT_STATUS) return null;
  const idx = FULFILLMENT_STATUSES.indexOf(status);
  return FULFILLMENT_STATUSES[idx + 1] ?? null;
}

function formatTime(dateStr: string): string {
  const d = parseDbDate(dateStr);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return (
    d.toLocaleDateString([], { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );
}

function formatCurrency(usd: number, lbp: number): string {
  const parts: string[] = [];
  if (usd > 0) parts.push(`$${usd.toFixed(2)}`);
  if (lbp > 0) parts.push(`${lbp.toLocaleString()} LBP`);
  return parts.join(" + ") || "$0.00";
}

interface HistoryModalProps {
  history: CustomServiceEntry[];
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onVoid: (id: number) => void;
}

export function HistoryModal({
  history,
  loading,
  onClose,
  onRefresh,
  onVoid,
}: HistoryModalProps) {
  useModalFocusFix(true);
  const api = useApi();
  const { filteredData, from, to, setFrom, setTo } = useDateRangeFilter(
    history,
    "created_at",
  );
  // LIRA-155 — "a way to filter to insurance", mirroring Maintenance's
  // status-tab pill bar (just two options here, since this filters by
  // category, not by fulfilment status — the Status column below covers
  // that independently, per row).
  const [categoryTab, setCategoryTab] = useState<"All" | "Insurance">("All");
  const scopedData =
    categoryTab === "Insurance"
      ? filteredData.filter((tx) => tx.category === INSURANCE_CATEGORY)
      : filteredData;

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({
    description: "",
    client_name: "",
    phone_number: "",
    note: "",
  });
  const [editSaving, setEditSaving] = useState(false);
  // LIRA-155 — per-row in-flight guards for the two new row actions, mirrors
  // `editSaving`/`collectingId` (HoldMoneySection) above.
  const [advancingId, setAdvancingId] = useState<number | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const shopInfo = useShopInfo();

  /** LIRA-155, item 5 — advance one legal step via the fulfilment endpoint.
   *  Only ever called with the single next status `nextFulfillmentStatus`
   *  computed (see the Status column below), so there is no illegal
   *  transition to guard against here — the server enforces it anyway
   *  (`CustomServiceService.advanceFulfillmentStatus`), this is just the
   *  one legal call this UI ever makes. */
  async function handleAdvanceFulfillment(
    tx: CustomServiceEntry,
    next: FulfillmentStatus,
  ) {
    setAdvancingId(tx.id);
    try {
      const result = await api.advanceCustomServiceFulfillment({
        id: tx.id,
        fulfillment_status: next,
      });
      if (result.success) {
        onRefresh();
      } else {
        alert(result.error ?? "Failed to update status.");
      }
    } catch (error) {
      logger.error("Advance fulfilment status failed:", error);
      alert("Failed to update status.");
    } finally {
      setAdvancingId(null);
    }
  }

  /** LIRA-155, item 6 (D4.2b) — Cancel is Refund through the SAME generic
   *  path the Transactions table uses (`refundTransaction`, looked up via
   *  `getTransactionBySource` exactly like `handlePrint` above already
   *  does for this same source table) — never `deleteCustomService`, which
   *  hard-sets status='voided' and vanishes the row from `getAll` (that
   *  would contradict "Cancelled" as a visible, derived label). */
  async function handleCancel(tx: CustomServiceEntry) {
    if (
      !confirm(
        "Cancel this insurance? Any payment already collected will be refunded.",
      )
    ) {
      return;
    }
    setCancellingId(tx.id);
    try {
      const txn = await getTransactionBySource("custom_services", tx.id);
      const txnId = (txn as { id?: number } | null)?.id;
      if (!txnId) {
        alert("Could not find the transaction for this insurance.");
        return;
      }
      const result = await refundTransaction(txnId);
      if (result.success) {
        onRefresh();
      } else {
        alert(result.error ?? "Failed to cancel insurance.");
      }
    } catch (error) {
      logger.error("Cancel insurance failed:", error);
      alert("Failed to cancel insurance.");
    } finally {
      setCancellingId(null);
    }
  }

  async function handlePrint(tx: CustomServiceEntry) {
    try {
      const txn = await getTransactionBySource("custom_services", tx.id);
      const txnId = (txn as { id?: number } | null)?.id;
      if (!txnId) return; // voided rows resolve to null — nothing to print
      await printServiceReceiptByTransaction(txnId, shopInfo);
    } catch {
      // Best-effort reprint — never throw into the table's click handler.
    }
  }

  function startEdit(tx: CustomServiceEntry) {
    setEditingId(tx.id);
    setEditForm({
      description: tx.description ?? "",
      client_name: tx.client_name ?? "",
      phone_number: tx.phone_number ?? "",
      note: tx.note ?? "",
    });
  }

  async function handleSaveEdit() {
    if (editingId === null) return;
    setEditSaving(true);
    try {
      const result = await window.api.customServices.updateMetadata({
        id: editingId,
        ...(editForm.description !== undefined && {
          description: editForm.description,
        }),
        ...(editForm.client_name !== undefined && {
          client_name: editForm.client_name,
        }),
        ...(editForm.phone_number !== undefined && {
          phone_number: editForm.phone_number,
        }),
        ...(editForm.note !== undefined && { note: editForm.note }),
      });
      if (result.success) {
        setEditingId(null);
        onRefresh();
      } else {
        alert(result.error ?? "Failed to save");
      }
    } finally {
      setEditSaving(false);
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
            <History className="text-slate-400" size={18} />
            Service History
            <span className="text-xs text-slate-500 font-normal ml-1">
              ({scopedData.length} records)
            </span>
          </h2>
          <div className="flex items-center gap-2">
            {/* LIRA-155 — "a way to filter to insurance" (item 4), mirroring
                Maintenance's status-tab pill bar styling. */}
            <div className="flex items-center gap-1 bg-slate-800/60 rounded-lg border border-slate-700 p-0.5">
              {(["All", "Insurance"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  data-testid={`custom-service-history-tab-${tab.toLowerCase()}`}
                  onClick={() => setCategoryTab(tab)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    categoryTab === tab
                      ? "bg-sky-600 text-white"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
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
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-500">
              <RefreshCw size={20} className="animate-spin mr-2" />
              Loading...
            </div>
          ) : (
            <DataTable<CustomServiceEntry>
              columns={[
                {
                  header: "Time",
                  className: "px-4 py-3",
                  sortKey: "created_at",
                },
                {
                  header: "Description",
                  className: "px-4 py-3",
                  sortKey: "description",
                },
                {
                  header: "Category",
                  className: "px-4 py-3",
                  sortKey: "category",
                },
                {
                  // LIRA-155, item 4 — insurance fulfilment status, derived
                  // "Cancelled" on a refund. Blank for every non-insurance
                  // row (untracked).
                  header: "Status",
                  className: "px-4 py-3",
                },
                {
                  header: "Customer",
                  className: "px-4 py-3",
                  sortKey: "client_name",
                },
                {
                  header: "Cost",
                  className: "px-4 py-3 text-right",
                  sortKey: "cost_usd",
                },
                {
                  header: "Price",
                  className: "px-4 py-3 text-right",
                  sortKey: "price_usd",
                },
                {
                  header: "Profit",
                  className: "px-4 py-3 text-right",
                  sortKey: "profit_usd",
                },
                {
                  header: "Paid By",
                  className: "px-4 py-3",
                  sortKey: "paid_by",
                },
                { header: "", className: "px-4 py-3 w-16" },
              ]}
              data={scopedData}
              paginate
              exportExcel
              exportPdf
              exportFilename="custom-services-history"
              className="w-full"
              theadClassName="bg-slate-900/50 text-left text-xs font-medium text-slate-400 uppercase tracking-wider sticky top-0"
              tbodyClassName="divide-y divide-slate-700/50"
              emptyMessage="No services recorded yet."
              renderRow={(tx) => {
                const isRefunded = Boolean(tx.is_refunded);
                const isEditing = editingId === tx.id;
                return (
                  <>
                    <tr
                      key={tx.id}
                      className={`hover:bg-slate-700/20 transition-colors${isRefunded ? " opacity-50" : ""}`}
                    >
                      <td className="px-4 py-3 text-sm text-slate-400 whitespace-nowrap">
                        {formatTime(tx.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-white font-medium flex items-center gap-1 flex-wrap">
                          {/* Hold Money carries no sale price — skip the in/out
                              amount badge (it would read a meaningless ↑ $0.00). */}
                          {tx.category !== "hold_money" && (
                            <span className="inline-flex items-center gap-0.5 text-[11px] font-mono text-emerald-400 shrink-0">
                              ↑ {formatCurrency(tx.price_usd, tx.price_lbp)}
                            </span>
                          )}
                          {tx.description}
                          {isRefunded && (
                            <span className="ml-2 inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                              Refunded
                            </span>
                          )}
                          {tx.edited_by && (
                            <EditHistoryPopover
                              entityType="custom_service"
                              entityId={tx.id}
                              trigger={
                                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-yellow-500/10 border border-yellow-500/30 px-1.5 py-0.5 text-[10px] font-medium text-yellow-400 cursor-pointer hover:bg-yellow-500/20 transition-colors">
                                  <Pencil size={8} />
                                  Edited
                                </span>
                              }
                            />
                          )}
                        </div>
                        {tx.note && (
                          <div className="text-xs text-slate-500 mt-0.5 truncate max-w-[200px]">
                            {tx.note}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {tx.category ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-500/10 border border-purple-500/30 text-purple-400">
                            <Tag size={10} />
                            {tx.category === "digital_account"
                              ? "Digital Account"
                              : tx.category === "hold_money"
                                ? "Hold Money"
                                : tx.category.charAt(0).toUpperCase() +
                                  tx.category.slice(1)}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {tx.category !== INSURANCE_CATEGORY ? (
                          <span className="text-xs text-slate-600">—</span>
                        ) : isRefunded ? (
                          // D4.2b — derived, never a stored status: a
                          // cancelled insurance IS a refunded insurance,
                          // there is only one fact.
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/30">
                            Cancelled
                          </span>
                        ) : !tx.fulfillment_status ? (
                          <span className="text-xs text-slate-600">—</span>
                        ) : (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-medium ${fulfillmentBadge(tx.fulfillment_status).className}`}
                            >
                              {fulfillmentBadge(tx.fulfillment_status).label}
                            </span>
                            {(() => {
                              const next = nextFulfillmentStatus(
                                tx.fulfillment_status,
                              );
                              if (!next) return null;
                              const nextLabel = fulfillmentBadge(next).label;
                              return (
                                <button
                                  type="button"
                                  data-testid={`custom-service-advance-fulfillment-${tx.id}`}
                                  onClick={() =>
                                    handleAdvanceFulfillment(tx, next)
                                  }
                                  disabled={advancingId === tx.id}
                                  className="text-[10px] px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors whitespace-nowrap disabled:opacity-50"
                                  title={`Mark ${nextLabel}`}
                                >
                                  {advancingId === tx.id
                                    ? "..."
                                    : `Mark ${nextLabel}`}
                                </button>
                              );
                            })()}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {tx.client_name && (
                          <div className="text-sm text-white flex items-center gap-1">
                            <User size={12} className="text-slate-500" />
                            {tx.client_name}
                          </div>
                        )}
                        {tx.phone_number && (
                          <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                            <Phone size={10} />
                            {tx.phone_number}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-mono text-slate-400">
                        {formatCurrency(tx.cost_usd, tx.cost_lbp)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-mono text-white font-medium">
                        {formatCurrency(tx.price_usd, tx.price_lbp)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          // LIRA-130: profit_usd/profit_lbp are a GENERATED
                          // column (price - cost) — a refund can never
                          // reverse it, so the raw number still reads "$10
                          // profit" on a service whose price was refunded.
                          // The badge above already tells the truth about
                          // the row; this only stops the profit figure from
                          // presenting itself as still-live income (same
                          // struck-through/neutral treatment the Suppliers
                          // ledger uses for a refunded amount).
                          className={`text-sm font-bold font-mono ${
                            isRefunded
                              ? "text-slate-500 line-through"
                              : tx.profit_usd >= 0 && tx.profit_lbp >= 0
                                ? "text-emerald-400"
                                : "text-red-400"
                          }`}
                          title={
                            isRefunded
                              ? "Refunded — profit not realized"
                              : undefined
                          }
                        >
                          {formatCurrency(tx.profit_usd, tx.profit_lbp)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            tx.paid_by === "CUSTOMER_ACCOUNT"
                              ? "bg-orange-500/10 text-orange-400"
                              : "bg-slate-700 text-slate-300"
                          }`}
                        >
                          {tx.paid_by}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {isEditing ? (
                            <>
                              <button
                                onClick={handleSaveEdit}
                                disabled={editSaving}
                                className="p-1 text-emerald-400 hover:bg-emerald-400/10 rounded-lg transition-colors disabled:opacity-50"
                                title="Save"
                              >
                                <Check size={13} />
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                className="p-1 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors"
                                title="Cancel"
                              >
                                <X size={13} />
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => startEdit(tx)}
                              className="p-1 text-slate-500 hover:text-orange-400 hover:bg-orange-400/10 rounded-lg transition-colors"
                              title="Edit metadata"
                            >
                              <Pencil size={13} />
                            </button>
                          )}
                          {tx.category === INSURANCE_CATEGORY ? (
                            // LIRA-155, item 6 (D4.2b) — Cancel ≡ Refund via
                            // the GENERIC path, never deleteCustomService.
                            // Hidden once already refunded: cancelling is
                            // not undoable (matches the repo's
                            // additive-only reversal convention).
                            !isRefunded && (
                              <button
                                onClick={() => handleCancel(tx)}
                                disabled={cancellingId === tx.id}
                                className="text-slate-600 hover:text-red-400 transition-colors p-1 disabled:opacity-50"
                                title="Cancel insurance (refund)"
                              >
                                <Ban size={14} />
                              </button>
                            )
                          ) : (
                            <button
                              onClick={() => onVoid(tx.id)}
                              className="text-slate-600 hover:text-red-400 transition-colors p-1"
                              title="Void service"
                            >
                              <Ban size={14} />
                            </button>
                          )}
                          {isReceiptableTransaction({
                            type: "CUSTOM_SERVICE",
                          }) && (
                            <button
                              onClick={() => handlePrint(tx)}
                              className="text-slate-500 hover:text-white transition-colors p-1"
                              title="Print receipt"
                            >
                              <Printer size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isEditing && (
                      <tr className="bg-slate-800/60 border-b border-slate-700/50">
                        <td colSpan={10} className="px-4 py-3">
                          <div className="flex items-end gap-3 flex-wrap">
                            <div className="flex-1 min-w-[140px]">
                              <label className="text-xs text-slate-400 block mb-1">
                                Description
                              </label>
                              <input
                                value={editForm.description}
                                onChange={(e) =>
                                  setEditForm((f) => ({
                                    ...f,
                                    description: e.target.value,
                                  }))
                                }
                                className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-orange-500 w-full"
                                placeholder="Description"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-slate-400 block mb-1">
                                Client Name
                              </label>
                              <input
                                value={editForm.client_name}
                                onChange={(e) =>
                                  setEditForm((f) => ({
                                    ...f,
                                    client_name: e.target.value,
                                  }))
                                }
                                className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-orange-500 w-40"
                                placeholder="Client name"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-slate-400 block mb-1">
                                Phone
                              </label>
                              <input
                                value={editForm.phone_number}
                                onChange={(e) =>
                                  setEditForm((f) => ({
                                    ...f,
                                    phone_number: e.target.value,
                                  }))
                                }
                                className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-orange-500 w-36"
                                placeholder="Phone number"
                              />
                            </div>
                            <div className="flex-1 min-w-[120px]">
                              <label className="text-xs text-slate-400 block mb-1">
                                Note
                              </label>
                              <input
                                value={editForm.note}
                                onChange={(e) =>
                                  setEditForm((f) => ({
                                    ...f,
                                    note: e.target.value,
                                  }))
                                }
                                className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-orange-500 w-full"
                                placeholder="Note"
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
  );
}
