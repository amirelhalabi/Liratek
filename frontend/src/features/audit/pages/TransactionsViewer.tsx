import {
  useState,
  useCallback,
  useMemo,
  Fragment,
  type ReactElement,
} from "react";
import {
  voidTransaction,
  refundTransaction,
  voidCheckoutGroup,
  voidSessionBasket,
  refundSessionBasket,
  getSaleItems,
  getProductUnitsForSaleItems,
  type ProductUnitDto,
} from "@/api/backendApi";
import { DataTable } from "@liratek/ui";
import logger from "@/utils/logger";
import { formatLegAmount } from "../cashFlow";
import {
  billsCommissionModeLine,
  billsOnlyCommissionAmount,
  formatPaymentMethods,
  legMethodLabel,
  methodLegsFor,
  sessionPooledMethodLegsFor,
  sessionVars,
} from "../transactionDisplay";
import {
  ActionsCell,
  AmountCell,
  ClientCell,
  MethodCell,
  ReturnedCreditsCell,
  ReversesCell,
  StatusCell,
  SummaryCell,
  TimeCell,
  TypeCell,
  UserCell,
  type RowActionHandlers,
} from "../components/TransactionCells";
import { deriveRow } from "../rowDerived";
import {
  computeSessionGroupHeaders,
  isSessionGroupHeader,
} from "../sessionGroupHeaders";
import {
  useTransactionRows,
  type TransactionRow,
} from "../hooks/useTransactionRows";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { useShopInfo } from "@/hooks/useShopName";
import { useSellRate } from "@/hooks/useSellRate";
import { amountSortValue } from "../amountSort";
import {
  buildServiceReceiptTextByTransaction,
  getConfiguredReceiptPrinter,
} from "@/shared/utils/serviceReceipt";
import { appEvents } from "@liratek/ui";
import { ReceiptPreviewModal } from "@/shared/components/ReceiptPreviewModal";
import { RefundMethodModal } from "../components/RefundMethodModal";
import type {
  RefundLegOverride,
  RefundUnitExtraOverride,
} from "../refundLegOverride";
import { messageFrom } from "@/api/apiError";

// This file is now the COMPONENT only. Its former contents live in:
//   ../hooks/useTransactionRows  — the query, the client-side filters and the
//                                  window-widening loop (+ the TransactionRow shape)
//   ../transactionDisplay        — every pure row-rendering helper + CashFlowBadge
//   ../transactionPresentation   — the one per-type label/colour/direction registry
//   ../cashFlow                  — payment-leg formatting and badge direction

/**
 * LIRA-205 (owner decision 2) — Void / Refund / Void-entire-checkout stay
 * VISIBLE to every staff role; the admin-only gate lives entirely
 * server-side (`electron-app/session.ts`'s `requireRole` on desktop,
 * `requireRole(["admin"])` in `backend/src/api/transactions.ts` on web). A
 * non-admin therefore WILL click these buttons and WILL hit that gate — and
 * pre-fix, the two transports surfaced the rejection through two different
 * code paths with two different, unexplained messages:
 *   - desktop: the IPC handler still resolves `{ success: false, error }`,
 *     so it lands in the `else` branch with `res.error === "Forbidden"`.
 *   - web: `requireRole` answers with an actual HTTP 403 (not the
 *     200-envelope other routes use per rule 19c), so `requestJson` REJECTS
 *     with a plain `{ status, message, details }` object — NOT an `Error` —
 *     landing in the `catch`, not the `else`, and showing a generic
 *     "Failed to void/refund transaction" that discards the real reason.
 * Both raw reasons are the identical literal string "Forbidden" (both
 * `requireRole` implementations use it), so recognizing that one string here
 * is enough to give both transports the SAME explanatory sentence.
 * `messageFrom` (frontend/src/api/apiError.ts) safely extracts a message
 * from either shape — the envelope's `error` (a plain string) or the thrown
 * ApiError object — without an `instanceof Error` check, which would treat
 * the plain-object throw as unreadable and fall through to a fallback that
 * silently discards the real reason.
 */
function describeActionFailure(raw: unknown, verb: string): string {
  const reason = messageFrom(raw, "Unknown error");
  if (reason === "Forbidden") {
    return `Failed: ${verb} is restricted to admins — ask an admin to do this.`;
  }
  return `Failed: ${reason}`;
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface TransactionsViewerProps {
  limit: string;
  /** Labels of the selected Type-filter options — a UNION (OR); empty means
   *  "All types". */
  selectedFilters: string[];
  search: string;
  from: string;
  to: string;
}

export default function TransactionsViewer({
  limit,
  selectedFilters,
  search,
  from,
  to,
}: TransactionsViewerProps) {
  const {
    rows,
    filteredRows,
    loading,
    reload: load,
  } = useTransactionRows({
    limit,
    selectedFilters,
    search,
    from,
    to,
  });
  const shopInfo = useShopInfo();
  // LIRA-139: fallback rate for Amount-column sort on rows with no stamped
  // `exchange_rate` — injected into amountSortValue rather than read inside
  // it (DIP).
  const { buyRate: fallbackRate } = useSellRate();

  // LIRA-201b (owner note #11-B): which row, per session, currently carries
  // the pooled in/out + payment detail — recomputed from `filteredRows`
  // (the same set DataTable is given as `data`, for both screen AND export)
  // so the choice survives sorting/type-filters/the fetch window. See
  // sessionGroupHeaders.ts's doc for why this is safe to key off id alone.
  const sessionGroupHeaderIds = useMemo(
    () => computeSessionGroupHeaders(filteredRows),
    [filteredRows],
  );
  // m1 (fix round): delegate to the shared predicate instead of
  // re-implementing it inline — `isSessionGroupHeader` is the SAME function
  // `sessionGroupHeaders.test.ts` proves against.
  const isRowGroupHeader = useCallback(
    (row: TransactionRow) => isSessionGroupHeader(row, sessionGroupHeaderIds),
    [sessionGroupHeaderIds],
  );

  const { methods: paymentMethods, drawerAffectingMethods } =
    usePaymentMethods();
  const methodLabelByCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of paymentMethods) map.set(m.code, m.label);
    return map;
  }, [paymentMethods]);

  // The "System Transactions" sandwich fold — a ⚙ toggle that collapsed the
  // auto-generated system rows (chiefly SUPPLIER_PAYMENT siblings) sitting
  // between the first and last row of a session — was DELETED here, along
  // with the ~155 lines of renderRow/state that served it. It had already
  // been disabled by pinning its lookup map permanently empty, which made
  // every branch that read it unreachable: the rows it existed to collapse
  // are now hidden one layer earlier, either by the per-row D2 rule
  // (isSupplierPaymentVisible, in filterVisible below) or by
  // HIDDEN_TRANSACTION_TYPES' blanket exclusion, so nothing is left to fold.
  // Session ACCENT styling is unaffected and still live — see sessionVars in
  // buildTr.

  // LIRA-067: per-row expand/collapse for the structured payment-leg detail
  // (expands a SINGLE row's own leg breakdown).
  const [expandedLegRows, setExpandedLegRows] = useState<Set<number>>(
    new Set(),
  );

  // Print button opens an in-app preview first (same UX as the POS
  // CheckoutModal's "Receipt Preview") instead of invoking the OS print
  // flow directly — the modal's own Print button does that.
  const [receiptPreview, setReceiptPreview] = useState<{
    text: string;
    printer: string;
  } | null>(null);

  const handlePrintReceipt = useCallback(
    async (id: number) => {
      const built = await buildServiceReceiptTextByTransaction(id, shopInfo);
      if (!built.ok || !built.text) {
        appEvents.emit(
          "notification:show",
          "Could not print receipt: " + (built.error || "Unknown error"),
          "error",
        );
        return;
      }
      const printer = await getConfiguredReceiptPrinter();
      setReceiptPreview({ text: built.text, printer });
    },
    [shopInfo],
  );

  const handleVoid = useCallback(
    async (id: number) => {
      if (!confirm("Void this transaction? This cannot be undone.")) return;
      try {
        const res = await voidTransaction(id);
        if (res.success) load();
        else alert(describeActionFailure(res.error, "Voiding a transaction"));
      } catch (err) {
        alert(describeActionFailure(err, "Voiding a transaction"));
      }
    },
    [load],
  );

  const doRefund = useCallback(
    async (
      id: number,
      refundLegs?: RefundLegOverride[],
      unitExtras?: RefundUnitExtraOverride[],
    ) => {
      try {
        const res = await refundTransaction(id, refundLegs, unitExtras);
        if (res.success) load();
        else
          alert(describeActionFailure(res.error, "Refunding a transaction"));
      } catch (err) {
        alert(describeActionFailure(err, "Refunding a transaction"));
      }
    },
    [load],
  );

  // LIRA-078: the modal that lets the operator choose the refund's return
  // method(s), open for at most one row at a time.
  const [refundModalRow, setRefundModalRow] = useState<TransactionRow | null>(
    null,
  );
  const [isRefunding, setIsRefunding] = useState(false);
  // LIRA-143 Phase 6b: phone units linked to `refundModalRow`'s sale (empty
  // for a non-sale row, or a sale with no IMEI-tracked items).
  const [refundModalUnits, setRefundModalUnits] = useState<ProductUnitDto[]>(
    [],
  );
  // Row id currently awaiting the async sale-items/units lookup below — used
  // only to disable/label that ONE row's Refund button so a double-click
  // can't fire the lookup twice.
  const [refundLookupRowId, setRefundLookupRowId] = useState<number | null>(
    null,
  );

  const handleRefund = useCallback(
    async (row: TransactionRow) => {
      // Session-basket rows always fall back to the plain bare-reversal
      // refund (today's exact behavior, no modal) — never gated on units.
      // `row.payments` is ALWAYS this row's own legs only (LIRA-201b fix
      // round; `TransactionRepository._attachPaymentLegs` no longer makes a
      // legless member inherit the basket's pooled legs into `payments` —
      // those are exposed separately as `session_payments`/
      // `session_account_payments`, for DISPLAY only). So a session member
      // with no OWN legs has an EMPTY `payments` set, and the backend's
      // per-transaction validation (`getCustomerFacingLegs`/
      // `_validateRefundLegOverride`, keyed on transaction_id) would see the
      // same EMPTY set and reject any override with a confusing "nothing to
      // refund" error. Documented out of scope alongside split_group
      // (session-basket refund-by-method-override needing an owner decision
      // on which member "owns" the basket's legs is a follow-up, not this
      // ticket).
      if (row.session_id != null) {
        if (
          !confirm("Refund this transaction? A reversal entry will be created.")
        )
          return;
        void doRefund(row.id);
        return;
      }

      // LIRA-143 Phase 6b (owner decisions #10/#11): a sale row may have
      // phone units linked to it even when it has no drawer-affecting
      // payment legs of its own (a CUSTOMER_ACCOUNT-only sale) — look those
      // up BEFORE deciding whether the plain confirm() fallback applies, so
      // a phone refund always gets the "Returned phones" flagging UI.
      let linkedUnits: ProductUnitDto[] = [];
      if (row.source_table === "sales") {
        setRefundLookupRowId(row.id);
        try {
          const items = await getSaleItems(row.source_id);
          const itemIds = (Array.isArray(items) ? items : [])
            .map((item: { id?: number }) => item.id)
            .filter((id): id is number => typeof id === "number");
          if (itemIds.length > 0) {
            linkedUnits = await getProductUnitsForSaleItems(itemIds);
          }
        } catch (err) {
          logger.error("Failed to load linked phone units for refund", {
            error: err,
          });
          // Never block a refund on this lookup — fall through with no
          // units, same as if the sale simply had none.
        } finally {
          setRefundLookupRowId(null);
        }
      }

      const hasLegs = !!row.payments && row.payments.length > 0;
      if (!hasLegs && linkedUnits.length === 0) {
        if (
          !confirm("Refund this transaction? A reversal entry will be created.")
        )
          return;
        void doRefund(row.id);
        return;
      }

      setRefundModalUnits(linkedUnits);
      setRefundModalRow(row);
    },
    [doRefund],
  );

  const handleConfirmRefundOverride = useCallback(
    async (
      refundLegs: RefundLegOverride[] | undefined,
      unitExtras?: RefundUnitExtraOverride[],
    ) => {
      if (!refundModalRow) return;
      setIsRefunding(true);
      try {
        await doRefund(refundModalRow.id, refundLegs, unitExtras);
      } finally {
        setIsRefunding(false);
        setRefundModalRow(null);
        setRefundModalUnits([]);
      }
    },
    [refundModalRow, doRefund],
  );

  /**
   * CARRIER_LEGS_VOID_ASYMMETRY.md (design B+): void every non-voided member
   * of the multi-unit split checkout in ONE transaction. This is the ONLY
   * void action offered on a split_group row — a lone member's void/refund
   * throws the repository guard's error, so it is never wired to a button.
   */
  const handleVoidCheckoutGroup = useCallback(
    async (groupId: string, units: number | null) => {
      const label = units ? `${units}-unit` : "multi-unit";
      if (
        !confirm(
          `Void the entire ${label} checkout? Every unit's money, cost, and profit will be reversed. This cannot be undone.`,
        )
      )
        return;
      try {
        const res = await voidCheckoutGroup(groupId);
        if (res.success) load();
        else alert(describeActionFailure(res.error, "Voiding a checkout"));
      } catch (err) {
        alert(describeActionFailure(err, "Voiding a checkout"));
      }
    },
    [load],
  );

  /**
   * LIRA-201c (OWNER_NOTES_REMAINING_BUILD.md #11-C) — void the WHOLE
   * customer-session basket in one transaction. Replaces the "Basket item —
   * see admin to reverse" dead end (TransactionCells.tsx's ActionsCell).
   * Kept change goes back to the customer and the kept-change profit is
   * cancelled, a basket-member loto prize is soft-voided on the Loto side,
   * and any session-scoped CREDIT_DEPOSIT is reversed — all inside the one
   * repository transaction this call triggers.
   */
  const handleVoidSessionBasket = useCallback(
    async (sessionId: number) => {
      if (
        !confirm(
          `Void the entire session #${sessionId} basket? Every item's money, cost, and profit will be reversed, including any loto prize or account credit from this basket. This cannot be undone.`,
        )
      )
        return;
      try {
        const res = await voidSessionBasket(sessionId);
        if (res.success) load();
        else alert(describeActionFailure(res.error, "Voiding a session basket"));
      } catch (err) {
        alert(describeActionFailure(err, "Voiding a session basket"));
      }
    },
    [load],
  );

  /** Same shape as {@link handleVoidSessionBasket} (rule 14) but keeps
   *  every original item ACTIVE and creates a REFUND row per item. */
  const handleRefundSessionBasket = useCallback(
    async (sessionId: number) => {
      if (
        !confirm(
          `Refund the entire session #${sessionId} basket? Every item's money, cost, and profit will be reversed, including any loto prize or account credit from this basket. This cannot be undone.`,
        )
      )
        return;
      try {
        const res = await refundSessionBasket(sessionId);
        if (res.success) load();
        else
          alert(describeActionFailure(res.error, "Refunding a session basket"));
      } catch (err) {
        alert(describeActionFailure(err, "Refunding a session basket"));
      }
    },
    [load],
  );

  // One stable object for every row's ActionsCell — the handlers are
  // already memoised individually, so this only re-creates when one of them
  // genuinely changes.
  const rowActionHandlers: RowActionHandlers = useMemo(
    () => ({
      onPrintReceipt: handlePrintReceipt,
      onVoid: handleVoid,
      onRefund: handleRefund,
      onVoidCheckoutGroup: handleVoidCheckoutGroup,
      onVoidSessionBasket: handleVoidSessionBasket,
      onRefundSessionBasket: handleRefundSessionBasket,
    }),
    [
      handlePrintReceipt,
      handleVoid,
      handleRefund,
      handleVoidCheckoutGroup,
      handleVoidSessionBasket,
      handleRefundSessionBasket,
    ],
  );

  function toggleLegExpand(rowId: number) {
    setExpandedLegRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  /**
   * LIRA-067: the structured per-leg detail row, indented one column in
   * (blank Time cell, everything else merged under Summary via colSpan) —
   * printed on export unconditionally, and shown on screen only when the
   * row is in expandedLegRows. Null when the row has no customer-facing legs
   * AND no bills-only commission-mode line to show (methodLegsFor already
   * covers payments + account_payments, same set the Method column reads;
   * `billsCommissionModeLine` — LIRA-137 owner follow-up, "either method
   * picked, should appear in the payment detail" — is the ONE other reason
   * this row can have something to disclose, see its own doc comment).
   *
   * LIRA-201b fix round (M3): `legs` is always THIS row's own legs only,
   * including on the session's chosen group-header row. The basket's
   * pooled legs (when this row is that header) render in their own
   * labelled "Session #N pooled:" section below the own legs — never
   * merged into the same list — so the printed/exported detail matches
   * exactly what the Summary column's own line + "Session:" line show on
   * screen for that one row.
   */
  function buildLegDetailTr(row: TransactionRow, keySuffix: string) {
    const legs = methodLegsFor(row);
    const isHeader = isRowGroupHeader(row);
    const pooledLegs = isHeader ? sessionPooledMethodLegsFor(row) : [];
    const commissionAmount = billsOnlyCommissionAmount(row);
    const modeLine = commissionAmount
      ? billsCommissionModeLine(row, commissionAmount, methodLabelByCode)
      : null;
    if (legs.length === 0 && pooledLegs.length === 0 && !modeLine) {
      return null;
    }
    return (
      <tr
        key={`legdetail-${row.id}-${keySuffix}`}
        data-testid={`payment-legs-detail-${row.id}`}
        className="border-t border-slate-800/30 text-[11px] bg-slate-900/20"
      >
        <td className="p-2" />
        {/* LIRA-205: 1 (indent) + 10 (remaining columns, after ReturnedCreditsCell) = 11 total. */}
        <td className="p-2 pl-5 text-slate-400 font-mono" colSpan={10}>
          <div className="flex flex-col gap-0.5">
            {modeLine && (
              <div data-testid={`commission-mode-${row.id}`}>{modeLine}</div>
            )}
            {legs.map((leg, i) => (
              <div key={`own-${i}`}>
                {leg.direction === "in" ? "In" : "Out"} —{" "}
                {legMethodLabel(leg, methodLabelByCode)}: {formatLegAmount(leg)}
              </div>
            ))}
            {pooledLegs.length > 0 && (
              <div
                data-testid={`session-legs-detail-${row.id}`}
                className="mt-0.5 pt-0.5 border-t border-slate-800/40 text-sky-500/70"
              >
                <div className="font-semibold">
                  Session #{row.session_id} pooled:
                </div>
                {pooledLegs.map((leg, i) => (
                  <div key={`pooled-${i}`}>
                    {leg.direction === "in" ? "In" : "Out"} —{" "}
                    {legMethodLabel(leg, methodLabelByCode)}:{" "}
                    {formatLegAmount(leg)}
                  </div>
                ))}
              </div>
            )}
          </div>
        </td>
      </tr>
    );
  }

  // Renders a full data <tr> for a transaction row. Pass sessionId to apply
  // the session accent (data-session + --session-hue); pass null for plain rows.
  // isSystem=true applies muted styling for collapsed system sub-rows.
  /**
   * One transaction row. All eleven cells are their own component (see
   * `../components/TransactionCells`, including `ReturnedCreditsCell` —
   * LIRA-205) so they stay independently readable; each renders exactly one
   * `<td>` in the same declared column order. This function's only job is
   * the `<tr>` itself — the session accent, the voided/refunded row tint —
   * and passing each cell what it needs. `deriveRow` parses the row's
   * metadata ONCE for the cells that share those facts.
   */
  function buildTr(row: TransactionRow, sessionId: number | null) {
    // LIRA-201b: bundled onto `derived` (rather than a separate prop) so
    // SummaryCell/MethodCell need only the one `derived` prop they already
    // receive — see deriveRow's second-argument doc.
    const derived = deriveRow(row, isRowGroupHeader(row));
    return (
      <tr
        key={row.id}
        data-session={sessionId != null ? "" : undefined}
        style={sessionId != null ? sessionVars(sessionId) : undefined}
        className={`border-t border-slate-800 text-xs ${row.status === "VOIDED" ? "bg-red-950/20" : ""}`}
      >
        <TimeCell row={row} />
        <SummaryCell
          row={row}
          derived={derived}
          isLegDetailExpanded={expandedLegRows.has(row.id)}
          onToggleLegDetail={toggleLegExpand}
        />
        <TypeCell row={row} />
        <ClientCell row={row} />
        <AmountCell row={row} derived={derived} />
        <ReturnedCreditsCell row={row} />
        <MethodCell row={row} methodLabelByCode={methodLabelByCode} />
        <UserCell row={row} />
        <StatusCell row={row} />
        <ReversesCell row={row} />
        <ActionsCell
          row={row}
          derived={derived}
          sessionId={sessionId}
          refundLookupRowId={refundLookupRowId}
          handlers={rowActionHandlers}
        />
      </tr>
    );
  }

  /** Wrap an already-built row `<tr>` with its leg-detail sub-row (screen-only,
   *  gated on expandedLegRows) when one applies; otherwise return it as-is. */
  function withLegDetail(row: TransactionRow, mainTr: ReactElement) {
    const legDetail = expandedLegRows.has(row.id)
      ? buildLegDetailTr(row, "screen")
      : null;
    if (!legDetail) return mainTr;
    return (
      <Fragment key={row.id}>
        {mainTr}
        {legDetail}
      </Fragment>
    );
  }

  return (
    <>
      <DataTable<TransactionRow>
        columns={[
          {
            header: "Time",
            sortKey: "created_at",
            width: "160px",
            className: "p-2 text-xs font-semibold uppercase text-slate-400",
          },
          {
            header: "Summary",
            sortKey: "summary",
            className: "p-2 text-xs font-semibold uppercase text-slate-400",
          },
          {
            header: "Type",
            sortKey: "type",
            width: "160px",
            className: "p-2 text-xs font-semibold uppercase text-slate-400",
          },
          {
            header: "Client",
            sortKey: "client_name",
            width: "140px",
            className: "p-2 text-xs font-semibold uppercase text-slate-400",
          },
          {
            header: "Amount",
            sortKey: "amount_usd",
            width: "160px",
            className: "p-2 text-xs font-semibold uppercase text-slate-400",
          },
          {
            // LIRA-205: net telecom credit returned to the shop on an
            // Only-Days MTC/Alfa card sale (blank when none — ReturnedCreditsCell).
            header: "Ret. Credits",
            sortKey: "returned_credits_usd",
            width: "120px",
            className: "p-2 text-xs font-semibold uppercase text-slate-400",
          },
          {
            header: "Method",
            sortKey: "payment_method",
            width: "120px",
            className: "p-2 text-xs font-semibold uppercase text-slate-400",
          },
          {
            header: "User",
            sortKey: "username",
            width: "90px",
            className: "p-2 text-xs font-semibold uppercase text-slate-400",
          },
          {
            header: "Status",
            sortKey: "status",
            width: "80px",
            className: "p-2 text-xs font-semibold uppercase text-slate-400",
          },
          {
            header: "Reverses",
            sortKey: "reverses_id",
            width: "60px",
            className: "p-2 text-xs font-semibold uppercase text-slate-400",
          },
          {
            header: "Actions",
            width: "80px",
            className: "p-2 text-xs font-semibold uppercase text-slate-400",
          },
        ]}
        data={filteredRows}
        loading={loading}
        emptyMessage="No transactions found"
        defaultSortKey="created_at"
        defaultSortDirection="desc"
        showRowCount
        totalRowCount={rows.length}
        exportExcel
        exportPdf
        exportFilename="transactions"
        className="w-full text-left"
        theadClassName="bg-slate-900 text-slate-400 text-xs uppercase"
        tbodyClassName=""
        getSortValue={(row, key) => {
          if (key === "created_at")
            return row.created_at ? parseDbDate(row.created_at).getTime() : 0;
          if (key === "amount_usd") return amountSortValue(row, fallbackRate);
          if (key === "returned_credits_usd")
            // LIRA-205: numeric sort — the generic String(...) fallback below
            // would sort "-73" next to "-7" (lexicographic, not numeric).
            return row.returned_credits_usd ?? 0;
          if (key === "reverses_id") return row.reverses_id ?? 0;
          if (key === "payment_method")
            // LIRA-201b fix round (M3): own-only, matching MethodCell's
            // display (the pooled basket method never merges in — see
            // methodLegsFor's doc).
            return formatPaymentMethods(methodLegsFor(row), methodLabelByCode);
          return String((row as Record<string, unknown>)[key] ?? "");
        }}
        exportRow={(row) => {
          // LIRA-067: the printed/exported report always includes the leg
          // detail (unconditionally — a static export has no "expand" state),
          // indented one column in under the transaction row.
          const legDetail = buildLegDetailTr(row, "export");
          if (!legDetail) return buildTr(row, row.session_id);
          return (
            <Fragment key={row.id}>
              {buildTr(row, row.session_id)}
              {legDetail}
            </Fragment>
          );
        }}
        renderRow={(row) => {
          // Regular row — session accent applied if it belongs to a session
          return withLegDetail(row, buildTr(row, row.session_id));
        }}
      />
      {refundModalRow && (
        <RefundMethodModal
          legs={refundModalRow.payments ?? []}
          units={refundModalUnits}
          paymentMethods={drawerAffectingMethods.map((m) => ({
            code: m.code,
            label: m.label,
          }))}
          exchangeRate={refundModalRow.exchange_rate ?? 89000}
          isSubmitting={isRefunding}
          onCancel={() => {
            setRefundModalRow(null);
            setRefundModalUnits([]);
          }}
          onConfirm={handleConfirmRefundOverride}
        />
      )}
      {receiptPreview && (
        <ReceiptPreviewModal
          text={receiptPreview.text}
          printer={receiptPreview.printer}
          logo={shopInfo.logo}
          onClose={() => setReceiptPreview(null)}
        />
      )}
    </>
  );
}
