/**
 * Loto ticket-level History + reprint UI (LIRA-100).
 *
 * `CheckpointHistory.tsx` only shows aggregate checkpoint rows
 * (`total_tickets`, `settlement_id`) — there was previously no way to look up
 * or reprint an INDIVIDUAL ticket sale from inside the Loto module (the only
 * escape hatch was the general `/audit` Transactions viewer). This mirrors
 * the pattern Recharge/Maintenance/Custom Services already ship
 * (`frontend/src/features/recharge/components/HistoryModal.tsx`,
 * `frontend/src/features/maintenance/pages/Maintenance/components/HistoryModal.tsx`):
 * a date-filterable table with a per-row Print button gated by the shared
 * `isReceiptableRow` predicate (CLAUDE.md rule 14 — never hand-roll the
 * receiptability check).
 *
 * Data source: `loto_tickets` rows via `api.loto.getByDateRange` (dual-mode
 * adapter — `frontend/src/api/backendApi.ts` `lotoGetByDateRange`, IPC
 * `loto:get-by-date-range` / REST `GET /api/loto` — both already existed,
 * no new plumbing needed). Self-fetches on mount, same as the sibling
 * `CheckpointHistory.tsx` in this module — Loto/index.tsx has no
 * already-loaded superset ticket list to lift up (unlike Maintenance's
 * `jobs`/Custom Services' `history`), and ticket sales can be numerous, so
 * loading is deferred until this modal actually opens.
 *
 * Print path: resolve the unified transaction for the ticket via
 * `getTransactionBySource("loto_tickets", ticket.id)` (already dual-mode —
 * IPC `transactions:getBySource` / REST `GET /api/transactions/by-source/...`,
 * itself backed by `TransactionRepository.getBySourceId`), then hand the
 * transaction id to `printServiceReceiptByTransaction` — the same helper
 * every other service module's History modal uses.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "@liratek/ui/i18n/format";
import { useFormat } from "@/i18n/useFormat";
import { History, RefreshCw, X, Printer, Pencil } from "lucide-react";
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
import { isReceiptableRow } from "@/features/audit/receiptGating";

/** A `loto_tickets` row as returned by `api.loto.getByDateRange` (`SELECT *`). */
export interface LotoTicketRow {
  id: number;
  ticket_number: string | null;
  sale_amount: number;
  commission_amount: number;
  currency: string;
  payment_method: string | null;
  client_name: string | null;
  sale_date: string;
  created_at: string;
  is_refunded?: number | null;
  refunded_at?: string | null;
  edited_by?: string | null;
  edited_at?: string | null;
}

interface TicketHistoryModalProps {
  onClose: () => void;
}

function fmtAmount(amount: number, currency: string): string {
  return currency === "LBP"
    ? `${formatNumber(amount)} LBP`
    : `$${amount.toFixed(2)}`;
}

export function TicketHistoryModal({ onClose }: TicketHistoryModalProps) {
  useModalFocusFix(true);
  const api = useApi();
  const { t } = useTranslation("loto");
  const { t: tc } = useTranslation("common");
  const { formatDate, formatTime, formatDateTime } = useFormat();
  const shopInfo = useShopInfo();
  const [tickets, setTickets] = useState<LotoTicketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { filteredData, from, to, setFrom, setTo } = useDateRangeFilter(
    tickets,
    "created_at",
  );
  // Totals of the rows on screen — the Sale Amount column (LBP tickets in
  // LBP, every other ticket in USD, as the column shows), refunded left out.
  const totals = usdLbpTotals(filteredData, (t) =>
    t.currency === "LBP"
      ? { usd: 0, lbp: t.sale_amount }
      : { usd: t.sale_amount, lbp: 0 },
  );

  useEffect(() => {
    loadTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadTickets() {
    try {
      setLoading(true);
      // Wide range — client-side DateRangeFilter narrows the visible set,
      // same as the sibling CheckpointHistory.tsx.
      const result = await api.loto.getByDateRange("2020-01-01", "2099-12-31");
      if (result.success) {
        setTickets((result.tickets as LotoTicketRow[]) ?? []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  async function handlePrint(ticket: LotoTicketRow) {
    try {
      const txn = await getTransactionBySource("loto_tickets", ticket.id);
      const txnId = (txn as { id?: number } | null)?.id;
      if (!txnId) {
        // Voided/refunded rows can resolve to null (getBySourceId filters
        // status = 'ACTIVE') — nothing to print, fail quietly.
        return;
      }
      await printServiceReceiptByTransaction(api, txnId, shopInfo);
    } catch {
      // Best-effort reprint — a failed lookup/print shouldn't throw into the
      // table's click handler.
    }
  }

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
            {t("tickets.title")}
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
              onClick={loadTickets}
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
            <DataTable<LotoTicketRow>
              columns={[
                {
                  header: t("history.date"),
                  className: "px-5 py-3",
                  sortKey: "sale_date",
                },
                {
                  header: t("tickets.ticketNo"),
                  className: "px-5 py-3",
                  sortKey: "ticket_number",
                },
                {
                  header: t("sell.client"),
                  className: "px-5 py-3",
                  sortKey: "client_name",
                },
                {
                  header: t("tickets.saleAmount"),
                  className: "px-5 py-3",
                  sortKey: "sale_amount",
                },
                {
                  header: t("stats.commission"),
                  className: "px-5 py-3",
                  sortKey: "commission_amount",
                },
                {
                  header: t("tickets.payment"),
                  className: "px-5 py-3",
                  sortKey: "payment_method",
                },
                { header: "", className: "px-3 py-3 w-10" },
              ]}
              data={filteredData}
              exportExcel
              exportPdf
              exportFilename="loto-ticket-history"
              className="w-full"
              theadClassName="bg-slate-900/50 text-start text-xs font-medium text-slate-400 uppercase tracking-wider sticky top-0"
              tbodyClassName="divide-y divide-slate-700/50"
              emptyMessage={t("tickets.empty")}
              renderRow={(ticket) => {
                const isRefunded = Boolean(ticket.is_refunded);
                const wasEdited = Boolean(ticket.edited_by);
                return (
                  <tr
                    key={ticket.id}
                    className={`group hover:bg-slate-700/20 transition-colors${isRefunded ? " opacity-50" : ""}`}
                  >
                    {/* Date */}
                    <td className="px-5 py-3 text-sm text-slate-400 whitespace-nowrap">
                      {formatDate(parseDbDate(ticket.created_at), {
                        year: "numeric",
                        month: "numeric",
                        day: "numeric",
                      })}
                      <div className="text-xs text-slate-500">
                        {formatTime(parseDbDate(ticket.created_at), {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </td>

                    {/* Ticket # */}
                    <td className="px-5 py-3 text-sm font-mono text-slate-300">
                      {ticket.ticket_number || "—"}
                    </td>

                    {/* Client */}
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1">
                        <span className="text-sm text-slate-300">
                          {ticket.client_name || "—"}
                        </span>
                        {isRefunded && (
                          <span className="ms-1 inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                            {t("history.refunded")}
                          </span>
                        )}
                        {wasEdited && (
                          <EditHistoryPopover
                            entityType="loto_ticket"
                            entityId={ticket.id}
                            trigger={
                              <span
                                className="ms-1 inline-flex items-center gap-1 rounded-full bg-yellow-500/10 border border-yellow-500/30 px-1.5 py-0.5 text-[10px] font-medium text-yellow-400 cursor-pointer hover:bg-yellow-500/20 transition-colors"
                                title={
                                  ticket.edited_at
                                    ? t("tickets.editedByAt", {
                                        user: ticket.edited_by,
                                        at: formatDateTime(
                                          parseDbDate(ticket.edited_at),
                                          {
                                            year: "numeric",
                                            month: "numeric",
                                            day: "numeric",
                                            hour: "numeric",
                                            minute: "2-digit",
                                            second: "2-digit",
                                          },
                                        ),
                                      })
                                    : t("tickets.editedBy", {
                                        user: ticket.edited_by,
                                      })
                                }
                              >
                                <Pencil size={8} />
                                {t("tickets.edited")}
                              </span>
                            }
                          />
                        )}
                      </div>
                    </td>

                    {/* Sale Amount */}
                    <td className="px-5 py-3 text-sm font-bold text-red-400">
                      {fmtAmount(ticket.sale_amount, ticket.currency)}
                    </td>

                    {/* Commission */}
                    <td className="px-5 py-3 text-sm font-bold text-emerald-400">
                      {fmtAmount(ticket.commission_amount, ticket.currency)}
                    </td>

                    {/* Payment */}
                    <td className="px-5 py-3 text-sm text-slate-300">
                      {ticket.payment_method
                        ? ticket.payment_method.replace(/_/g, " ")
                        : "—"}
                    </td>

                    {/* Print (LIRA-100 — same predicate as every other
                        module's History modal and the Transactions viewer;
                        LOTO ticket sales are an always-receiptable type, no
                        provider concept, so this always resolves true today —
                        the canonical call is kept so a future change to the
                        gate is automatically honored here too, rule 14). */}
                    <td className="px-3 py-3 text-end">
                      {isReceiptableRow({
                        type: "LOTO",
                        metadata_json: null,
                      }) && (
                        <button
                          onClick={() => handlePrint(ticket)}
                          className="p-1.5 rounded hover:bg-slate-700 text-slate-500 hover:text-slate-300 transition-colors"
                          title={t("tickets.printReceipt")}
                        >
                          <Printer size={13} />
                        </button>
                      )}
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
