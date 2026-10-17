import {
  useState,
  useCallback,
  useMemo,
  useRef,
  Fragment,
  type ReactElement,
} from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { buildPaymentDetailLines } from "../paymentDetailLines";
import {
  voidTransaction,
  refundTransaction,
  voidCheckoutGroup,
  voidSessionBasket,
  refundSessionBasket,
  getSaleItems,
  getProductUnitsForSaleItems,
  getRefundBookedRate,
  undoItemRefund,
  type ProductUnitDto,
  type BookedRateSource,
} from "@/api/backendApi";
import {
  DataTable,
  useApi,
  appEvents,
  type DataTableColumn,
} from "@liratek/ui";
import logger from "@/utils/logger";
import { useAuth } from "@/features/auth/context/AuthContext";
import {
  billsCommissionModeLine,
  billsOnlyCommissionAmount,
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
  SummaryCell,
  TimeCell,
  TypeCell,
  UserCell,
  type RowActionHandlers,
} from "../components/TransactionCells";
import { deriveRow } from "../rowDerived";
import { methodText } from "../transactionCellText";
import { transactionsExportTemplate } from "../export/transactionsExportTemplate";
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
import { ReceiptPreviewModal } from "@/shared/components/ReceiptPreviewModal";
import { RefundMethodModal } from "../components/RefundMethodModal";
import {
  WrongNumberDialog,
  type WrongNumberDialogTarget,
} from "@/features/wrongNumbers/components/WrongNumberDialog";
import {
  extraChargeText,
  isSwapTransactionType,
  REFUND_KEPT_CHANGE_TYPES,
  type RefundKeptChangeInput,
} from "@liratek/core";
import { RefundQuantityModal } from "../components/RefundQuantityModal";
import { TransactionDetailsPanel } from "../components/TransactionDetailsPanel";
import {
  SessionSaleLinePickerModal,
  type SessionSaleLineItem,
} from "../components/SessionSaleLinePickerModal";
import { useSessionItemRefund } from "../hooks/useSessionItemRefund";
import {
  refundCanKeepChange,
  type RefundLegOverride,
  type RefundUnitExtraOverride,
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
type FailureVerb =
  | "voidTransaction"
  | "undoRefund"
  | "refundTransaction"
  | "voidCheckout"
  | "voidBasket"
  | "refundBasket"
  | "loadSaleItems";

function describeActionFailure(
  raw: unknown,
  verb: FailureVerb,
  t: TFunction<"audit">,
): string {
  // "Forbidden" is compared on the RAW server reason, before any wording.
  const reason = messageFrom(raw, t("failure.unknownError"));
  if (reason === "Forbidden") {
    return t("failure.restricted", { verb: t(`failure.verbs.${verb}`) });
  }
  return t("failure.generic", { reason });
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

/**
 * The table's columns (screen header and sort keys). The export does not
 * read them: it is the Transactions export template
 * (`../export/transactionsExportTemplate`), with its own columns. Headers
 * are shown in the displayed language (`transactionColumns`).
 */
const TRANSACTION_COLUMNS = [
  {
    headerKey: "columns.time",
    sortKey: "created_at",
    width: "160px",
    className: "p-2 text-xs font-semibold uppercase text-slate-400",
  },
  {
    headerKey: "columns.summary",
    sortKey: "summary",
    className: "p-2 text-xs font-semibold uppercase text-slate-400",
  },
  {
    headerKey: "columns.type",
    sortKey: "type",
    width: "160px",
    className: "p-2 text-xs font-semibold uppercase text-slate-400",
  },
  {
    headerKey: "columns.client",
    sortKey: "client_name",
    width: "140px",
    className: "p-2 text-xs font-semibold uppercase text-slate-400",
  },
  {
    headerKey: "columns.amount",
    sortKey: "amount_usd",
    width: "160px",
    className: "p-2 text-xs font-semibold uppercase text-slate-400",
  },
  {
    headerKey: "columns.method",
    sortKey: "payment_method",
    width: "120px",
    className: "p-2 text-xs font-semibold uppercase text-slate-400",
  },
  {
    headerKey: "columns.user",
    sortKey: "username",
    width: "90px",
    className: "p-2 text-xs font-semibold uppercase text-slate-400",
  },
  {
    headerKey: "columns.actions",
    width: "80px",
    className: "p-2 text-xs font-semibold uppercase text-slate-400",
  },
] as const;

function transactionColumns(t: TFunction<"audit">): DataTableColumn[] {
  return TRANSACTION_COLUMNS.map(({ headerKey, ...rest }) => ({
    ...rest,
    header: t(headerKey),
  }));
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
    sessionsWithItemRefund,
    sessionsWithPayoutMember,
    sessionsFullyRefunded,
  } = useTransactionRows({
    limit,
    selectedFilters,
    search,
    from,
    to,
  });
  const { t } = useTranslation("audit");
  const columns = useMemo(() => transactionColumns(t), [t]);
  const shopInfo = useShopInfo();
  // LIRA-147 — gates the "Undo refund" button; the backend's own
  // `requireRole(["admin"])` on both transports remains the real
  // enforcement (this is only the UI-level convenience, same convention
  // as Partners/Suppliers write-off buttons).
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const api = useApi();
  // Read `api` through a ref (rule 25) so `handlePrintReceipt` below keeps a
  // STABLE identity across renders — same hazard/pattern as
  // FeatureFlagContext.tsx: `ApiProvider` happens to pass a module-level
  // singleton, which is an implicit contract, not a guarantee, and this
  // util is a plain function (not a hook), so it can't call `useApi()`
  // itself — the caller passes the live adapter in.
  const apiRef = useRef(api);
  apiRef.current = api;
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

  // LIRA-232 round-2 review (finding 2), round-3 review (finding 3) — every
  // session id that already has AT LEAST ONE per-item refund (a
  // `refundSessionBasketItem` REFUND row, identified by
  // `isSessionItemRefundRow`). Drives ActionsCell's `hideVoidBasket` — "Void
  // basket" hard-refuses on a session that's been touched by an item refund
  // (nothing left to cleanly void), so the button is hidden rather than
  // offered and then erroring. Now sourced from `useTransactionRows` itself
  // (a separate, always-unfiltered-by-page-state REFUND-only query) rather
  // than recomputed here from `filteredRows` — the operator's active
  // type/date filter must never un-hide "Void basket" just because it hides
  // the one REFUND row that proves the session was touched (see the hook's
  // own doc on `sessionsWithItemRefund`).

  const { methods: paymentMethods, drawerAffectingMethods } =
    usePaymentMethods();
  const methodLabelByCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of paymentMethods) map.set(m.code, m.label);
    return map;
  }, [paymentMethods]);

  // Owner decisions 2026-10-16 — the Transactions export is a designed
  // report: Excel Summary / Transactions / Payments / Details sheets and a
  // PDF grouped by day (`../export/transactionsExportTemplate`), costs for
  // admins only (the Details panel's own rules).
  const exportTemplate = useMemo(
    () =>
      transactionsExportTemplate({
        isAdmin,
        methodLabelByCode,
        shopName: shopInfo.name || undefined,
        exportedBy: user?.username ?? "",
        filters: { from, to, search, types: selectedFilters },
      }),
    [
      isAdmin,
      methodLabelByCode,
      shopInfo.name,
      user?.username,
      from,
      to,
      search,
      selectedFilters,
    ],
  );

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
      const built = await buildServiceReceiptTextByTransaction(
        apiRef.current,
        id,
        shopInfo,
      );
      if (!built.ok || !built.text) {
        appEvents.emit(
          "notification:show",
          "Could not print receipt: " + (built.error || "Unknown error"),
          "error",
        );
        return;
      }
      const printer = await getConfiguredReceiptPrinter(apiRef.current);
      setReceiptPreview({ text: built.text, printer });
    },
    [shopInfo],
  );

  const handleVoid = useCallback(
    async (id: number) => {
      if (!confirm(t("confirm.void"))) return;
      try {
        const res = await voidTransaction(id);
        if (res.success) load();
        else alert(describeActionFailure(res.error, "voidTransaction", t));
      } catch (err) {
        alert(describeActionFailure(err, "voidTransaction", t));
      }
    },
    [load, t],
  );

  const handleUndoRefund = useCallback(
    async (row: TransactionRow) => {
      if (
        !confirm(t("confirm.undoRefund"))
      )
        return;
      try {
        const res = await undoItemRefund(row.id);
        if (res.success) load();
        else alert(describeActionFailure(res.error, "undoRefund", t));
      } catch (err) {
        alert(describeActionFailure(err, "undoRefund", t));
      }
    },
    [load, t],
  );

  const doRefund = useCallback(
    async (
      id: number,
      refundLegs?: RefundLegOverride[],
      unitExtras?: RefundUnitExtraOverride[],
      exchangeRate?: number,
      keptChange?: RefundKeptChangeInput,
    ) => {
      try {
        // The kept-change argument rides only when present, so a refund
        // without it keeps the exact pre-existing call shape.
        const res =
          keptChange !== undefined
            ? await refundTransaction(
                id,
                refundLegs,
                unitExtras,
                exchangeRate,
                keptChange,
              )
            : await refundTransaction(id, refundLegs, unitExtras, exchangeRate);
        if (res.success) load();
        else alert(describeActionFailure(res.error, "refundTransaction", t));
      } catch (err) {
        alert(describeActionFailure(err, "refundTransaction", t));
      }
    },
    [load, t],
  );

  // LIRA-078: the modal that lets the operator choose the refund's return
  // method(s), open for at most one row at a time.
  // LIRA-312 — the open "Wrong number…" / "Credits…" dialog, if any.
  const [wrongNumberTarget, setWrongNumberTarget] =
    useState<WrongNumberDialogTarget | null>(null);
  // Owner request 2026-10-16 — the row whose Details panel is open.
  const [detailsRow, setDetailsRow] = useState<TransactionRow | null>(null);
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
  // LIRA-236 — the Transactions-page (non-session) refund popup's default
  // rate, fetched from the server (`TransactionService.getRefundBookedRate`)
  // when the popup opens, instead of the UI deriving its own fallback from
  // `row.exchange_rate` (a second definition of the rule — rule 14). Null
  // while loading or when the fetch fails; the render below falls back to
  // today's rate (`fallbackRate`) in that case, same as before this change.
  const [refundBookedRate, setRefundBookedRate] = useState<{
    bookedRate: number;
    bookedRateSource: BookedRateSource;
  } | null>(null);

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
          !confirm(t("confirm.refund"))
        )
          return;
        void doRefund(row.id);
        return;
      }

      // Two-sided swaps (EXCHANGE / WALLET_EXCHANGE / DRAWER_TRANSFER) net to
      // ~0, so the return-method modal can never be satisfied. Owner
      // decision: simple swap-back — plain confirm, refund with NO
      // refundLegs; the server mirrors each leg negated.
      if (isSwapTransactionType(row.type)) {
        if (
          !confirm(t("confirm.refundExchange"))
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
          !confirm(t("confirm.refund"))
        )
          return;
        void doRefund(row.id);
        return;
      }

      // LIRA-236 — fetch the popup's default rate from the server BEFORE it
      // opens (same "await, then show the modal" shape as the units lookup
      // just above and `openSessionItemPreview` below), so the modal never
      // renders with a stale/fallback rate that jumps once the request
      // resolves. A slow/failed lookup still can't block the refund form
      // forever — `getRefundBookedRate` never throws on a business-rule
      // failure (rule 19c envelope), and a rejected promise (network error)
      // is caught below and simply leaves `refundBookedRate` null, which the
      // render treats the same as "fallback".
      let bookedRate: {
        bookedRate: number;
        bookedRateSource: BookedRateSource;
      } | null = null;
      try {
        const rateRes = await getRefundBookedRate(row.id);
        if (rateRes.success) {
          bookedRate = {
            bookedRate: rateRes.bookedRate,
            bookedRateSource: rateRes.bookedRateSource,
          };
        }
      } catch (err) {
        logger.error("Failed to load the refund popup's booked rate", {
          error: err,
        });
      }

      setRefundModalUnits(linkedUnits);
      setRefundBookedRate(bookedRate);
      setRefundModalRow(row);
    },
    [doRefund],
  );

  const handleConfirmRefundOverride = useCallback(
    async (
      refundLegs: RefundLegOverride[] | undefined,
      unitExtras?: RefundUnitExtraOverride[],
      exchangeRate?: number,
      keptChange?: RefundKeptChangeInput,
    ) => {
      if (!refundModalRow) return;
      setIsRefunding(true);
      try {
        await doRefund(
          refundModalRow.id,
          refundLegs,
          unitExtras,
          exchangeRate,
          keptChange,
        );
      } finally {
        setIsRefunding(false);
        setRefundModalRow(null);
        setRefundModalUnits([]);
        setRefundBookedRate(null);
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
      const question = units
        ? t("confirm.voidCheckoutUnits", { count: units })
        : t("confirm.voidCheckoutMulti");
      if (!confirm(question)) return;
      try {
        const res = await voidCheckoutGroup(groupId);
        if (res.success) load();
        else alert(describeActionFailure(res.error, "voidCheckout", t));
      } catch (err) {
        alert(describeActionFailure(err, "voidCheckout", t));
      }
    },
    [load, t],
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
        !confirm(t("confirm.voidBasket", { id: sessionId }))
      )
        return;
      try {
        const res = await voidSessionBasket(sessionId);
        if (res.success) load();
        else alert(describeActionFailure(res.error, "voidBasket", t));
      } catch (err) {
        alert(describeActionFailure(err, "voidBasket", t));
      }
    },
    [load, t],
  );

  /** Same shape as {@link handleVoidSessionBasket} (rule 14) but keeps
   *  every original item ACTIVE and creates a REFUND row per item. */
  const handleRefundSessionBasket = useCallback(
    async (sessionId: number) => {
      if (
        !confirm(t("confirm.refundBasket", { id: sessionId }))
      )
        return;
      try {
        const res = await refundSessionBasket(sessionId);
        if (res.success) load();
        else alert(describeActionFailure(res.error, "refundBasket", t));
      } catch (err) {
        alert(describeActionFailure(err, "refundBasket", t));
      }
    },
    [load, t],
  );

  // LIRA-232 (SESSION_ITEM_REFUND_PLAN.md §4) — refund ONE sold-item session
  // member instead of the whole basket. A SALE member first asks which line
  // (or "all remaining", owner Q2) via SessionSaleLinePickerModal — a
  // CUSTOM_SERVICE/RECHARGE member has no line concept and previews
  // straight away. Both paths end at the SAME `useSessionItemRefund` hook
  // that drives the (existing) RefundMethodModal instance below.
  const [saleLinePicker, setSaleLinePicker] = useState<{
    row: TransactionRow;
    items: SessionSaleLineItem[];
  } | null>(null);
  const [saleLineQuantityTarget, setSaleLineQuantityTarget] = useState<{
    row: TransactionRow;
    item: SessionSaleLineItem;
  } | null>(null);
  const [sessionItemRefundUnits, setSessionItemRefundUnits] = useState<
    ProductUnitDto[]
  >([]);

  const sessionItemRefund = useSessionItemRefund(() => {
    setSessionItemRefundUnits([]);
    load();
  });

  // LIRA-232 round-3 review (finding 4) — "Refund All Remaining"
  // (`handleRefundAllRemainingSaleLines` below) omits `saleItemId` (owner Q2:
  // every remaining line refunds in ONE operation), so the OLD `if
  // (saleItemId != null)` gate here never loaded any unit at all for that
  // path — the POS's equivalent whole-sale refund (`SaleDetailModal.
  // openWholeSaleRefund`) always loads every item's units. `remainingSaleItemIds`
  // carries the picker's own list for exactly that case; a single-line pick
  // still uses `[saleItemId]` as before.
  const openSessionItemPreview = useCallback(
    async (
      row: TransactionRow,
      saleItemId?: number,
      quantity?: number,
      remainingSaleItemIds?: number[],
    ) => {
      let units: ProductUnitDto[] = [];
      const unitLookupIds =
        saleItemId != null ? [saleItemId] : (remainingSaleItemIds ?? []);
      if (unitLookupIds.length > 0) {
        try {
          units = await getProductUnitsForSaleItems(unitLookupIds);
        } catch (err) {
          logger.error("Failed to load linked phone units for refund", {
            error: err,
          });
        }
      }
      setSessionItemRefundUnits(units);
      await sessionItemRefund.open({
        sessionId: row.session_id as number,
        transactionId: row.id,
        ...(saleItemId != null ? { saleItemId } : {}),
        ...(quantity != null ? { quantity } : {}),
        ...(row.client_name ? { clientLabel: row.client_name } : {}),
        transactionType: row.type,
      });
    },
    [sessionItemRefund],
  );

  const handleRefundSessionItem = useCallback(
    async (row: TransactionRow) => {
      if (row.session_id == null) return;
      if (row.type === "SALE" && row.source_table === "sales") {
        try {
          const items = await getSaleItems(row.source_id);
          setSaleLinePicker({
            row,
            items: (items ?? []) as SessionSaleLineItem[],
          });
        } catch (err) {
          alert(describeActionFailure(err, "loadSaleItems", t));
        }
        return;
      }
      await openSessionItemPreview(row);
    },
    [openSessionItemPreview],
  );

  const handlePickSaleLine = (item: SessionSaleLineItem) => {
    if (!saleLinePicker) return;
    setSaleLineQuantityTarget({ row: saleLinePicker.row, item });
    setSaleLinePicker(null);
  };

  const handleRefundAllRemainingSaleLines = () => {
    if (!saleLinePicker) return;
    const { row, items } = saleLinePicker;
    // Same "has anything left to refund" predicate SessionSaleLinePickerModal
    // itself uses to decide which lines to list (rule 14) — every remaining
    // line's phone units (if any) get loaded together for the "Returned
    // phones" section, mirroring the POS's whole-sale refund.
    const remainingSaleItemIds = items
      .filter((item) => item.quantity - (item.refunded_quantity ?? 0) > 0)
      .map((item) => item.id);
    setSaleLinePicker(null);
    void openSessionItemPreview(
      row,
      undefined,
      undefined,
      remainingSaleItemIds,
    );
  };

  const handleConfirmSaleLineQuantity = (quantity: number) => {
    if (!saleLineQuantityTarget) return;
    const { row, item } = saleLineQuantityTarget;
    setSaleLineQuantityTarget(null);
    void openSessionItemPreview(row, item.id, quantity);
  };

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
      onRefundSessionItem: handleRefundSessionItem,
      onUndoRefund: handleUndoRefund,
      onWrongNumber: setWrongNumberTarget,
      onShowDetails: setDetailsRow,
    }),
    [
      handlePrintReceipt,
      handleVoid,
      handleRefund,
      handleVoidCheckoutGroup,
      handleVoidSessionBasket,
      handleRefundSessionBasket,
      handleRefundSessionItem,
      handleUndoRefund,
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
   * shown on screen when the row is in expandedLegRows (the export has its
   * own Payments sheet, owner decision 2026-10-16). Null when the row has no customer-facing legs
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
   * merged into the same list — so the detail matches
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
    // LIRA-319: the extra the customer was charged on top of the price.
    // Originals only: a void/refund never repeats the sale's extra.
    const extraText =
      row.reverses_id == null && row.type !== "REFUND"
        ? extraChargeText(row)
        : null;
    if (
      legs.length === 0 &&
      pooledLegs.length === 0 &&
      !modeLine &&
      !extraText
    ) {
      return null;
    }
    const ownLines = buildPaymentDetailLines(
      legs.map((leg) => ({
        ...leg,
        method: legMethodLabel(leg, methodLabelByCode),
      })),
      row.drawer_moves ?? [],
    );
    const pooledLines =
      pooledLegs.length > 0
        ? buildPaymentDetailLines(
            pooledLegs.map((leg) => ({
              ...leg,
              method: legMethodLabel(leg, methodLabelByCode),
            })),
          )
        : [];
    return (
      <tr
        key={`legdetail-${row.id}-${keySuffix}`}
        data-testid={`payment-legs-detail-${row.id}`}
        className="border-t border-slate-800/30 text-[11px] bg-slate-900/20"
      >
        <td className="p-2" />
        {/* 1 (indent) + 7 (remaining columns) = 8 total. */}
        <td className="p-2 ps-5 text-slate-400 font-mono" colSpan={7}>
          <div className="flex flex-col gap-0.5">
            {modeLine && (
              <div data-testid={`commission-mode-${row.id}`}>{modeLine}</div>
            )}
            {extraText && (
              <div
                data-testid={`extra-charge-${row.id}`}
                className="text-amber-400/80"
              >
                {t("cells.extraCharged", { amount: extraText })}
              </div>
            )}
            {ownLines.map((line, i) => (
              <div key={`own-${i}`}>
                {line.direction === "in" ? t("cells.legIn") : t("cells.legOut")}{" "}
                — {line.method}:{" "}
                {line.amountText}
                {line.drawersText && (
                  <span className="text-slate-500">
                    {"  {"}
                    {line.drawersText}
                    {"}"}
                  </span>
                )}
              </div>
            ))}
            {pooledLegs.length > 0 && (
              <div
                data-testid={`session-legs-detail-${row.id}`}
                className="mt-0.5 pt-0.5 border-t border-slate-800/40 text-sky-500/70"
              >
                <div className="font-semibold">
                  {t("cells.sessionPooled", { id: row.session_id })}
                </div>
                {pooledLines.map((line, i) => (
                  <div key={`pooled-${i}`}>
                    {line.direction === "in"
                      ? t("cells.legIn")
                      : t("cells.legOut")}{" "}
                    — {line.method}:{" "}
                    {line.amountText}
                    {line.drawersText && (
                      <span className="text-sky-600/70">
                        {"  {"}
                        {line.drawersText}
                        {"}"}
                      </span>
                    )}
                    {/* Production test 2026-10-07: a whole-basket void/refund's
                        legs sit in the same pooled list — mark them so the
                        (always-exported) detail doesn't read them as more
                        checkout money. */}
                    {line.reversal ? t("cells.basketReversal") : ""}
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
   * One transaction row. All eight cells are their own component (see
   * `../components/TransactionCells`) so they stay independently readable;
   * each renders exactly one
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
        <MethodCell row={row} methodLabelByCode={methodLabelByCode} />
        <UserCell row={row} />
        <ActionsCell
          row={row}
          derived={derived}
          sessionId={sessionId}
          refundLookupRowId={refundLookupRowId}
          handlers={rowActionHandlers}
          isAdmin={isAdmin}
          hideVoidBasket={
            sessionId != null && sessionsWithItemRefund.has(sessionId)
          }
          hideRefundItem={
            sessionId != null && sessionsWithPayoutMember.has(sessionId)
          }
          hideBasketActions={
            sessionId != null && sessionsFullyRefunded.has(sessionId)
          }
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
        columns={columns}
        data={filteredRows}
        loading={loading}
        emptyMessage={t("table.noTransactions")}
        defaultSortKey="created_at"
        defaultSortDirection="desc"
        showRowCount
        totalRowCount={rows.length}
        exportExcel
        exportPdf
        exportFilename="transactions"
        exportTemplate={exportTemplate}
        className="w-full text-start"
        theadClassName="bg-slate-900 text-slate-400 text-xs uppercase"
        tbodyClassName=""
        getSortValue={(row, key) => {
          if (key === "created_at")
            return row.created_at ? parseDbDate(row.created_at).getTime() : 0;
          if (key === "amount_usd") return amountSortValue(row, fallbackRate);
          if (key === "payment_method")
            // Exactly the Method column's text (`methodText` — screen,
            // export and sort share it).
            return methodText(row, methodLabelByCode);
          return String((row as Record<string, unknown>)[key] ?? "");
        }}
        renderRow={(row) => {
          // Regular row — session accent applied if it belongs to a session
          return withLegDetail(row, buildTr(row, row.session_id));
        }}
      />
      {detailsRow && (
        <TransactionDetailsPanel
          row={detailsRow}
          isAdmin={isAdmin}
          methodLabelByCode={methodLabelByCode}
          onClose={() => setDetailsRow(null)}
        />
      )}
      {wrongNumberTarget && (
        <WrongNumberDialog
          target={wrongNumberTarget}
          onClose={() => setWrongNumberTarget(null)}
          onChanged={load}
        />
      )}
      {refundModalRow && (
        <RefundMethodModal
          legs={refundModalRow.payments ?? []}
          units={refundModalUnits}
          paymentMethods={drawerAffectingMethods.map((m) => ({
            code: m.code,
            label: m.label,
          }))}
          // LIRA-236 — the server's own `getRefundBookedRate` verdict
          // (`TransactionService.getRefundBookedRate`, rule 14): the sale's/
          // transaction's own recorded rate, or the day's rate when nothing
          // was recorded. Replaces this component's own former
          // `refundModalRow.exchange_rate ?? fallbackRate` derivation — a
          // second definition of the same rule. Falls back to the client-side
          // day rate only while the fetch is in flight or if it failed
          // outright (never blocks the popup itself — see `handleRefund`).
          exchangeRate={refundBookedRate?.bookedRate ?? fallbackRate ?? 89000}
          bookedRateSource={refundBookedRate?.bookedRateSource ?? "fallback"}
          // Refund kept change (owner decision 2026-10-07) — only for the
          // types the server allows (one shared list, rule 14), and
          // (LIRA-272, now that the list covers every module) only when the
          // refund hands money OUT — never a payout original's refund.
          allowKeptChange={refundCanKeepChange(
            refundModalRow.type,
            refundModalRow.payments,
          )}
          isSubmitting={isRefunding}
          onCancel={() => {
            setRefundModalRow(null);
            setRefundModalUnits([]);
            setRefundBookedRate(null);
          }}
          onConfirm={handleConfirmRefundOverride}
        />
      )}
      {saleLinePicker && (
        <SessionSaleLinePickerModal
          items={saleLinePicker.items}
          onPickLine={handlePickSaleLine}
          onRefundAllRemaining={handleRefundAllRemainingSaleLines}
          onCancel={() => setSaleLinePicker(null)}
        />
      )}
      {saleLineQuantityTarget && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSaleLineQuantityTarget(null);
          }}
        >
          <RefundQuantityModal
            itemName={saleLineQuantityTarget.item.name}
            availableQuantity={
              saleLineQuantityTarget.item.quantity -
              (saleLineQuantityTarget.item.refunded_quantity ?? 0)
            }
            onConfirm={handleConfirmSaleLineQuantity}
            onCancel={() => setSaleLineQuantityTarget(null)}
          />
        </div>
      )}
      {/* LIRA-232 — the SAME modal used above, driven by the per-item
          session-refund flow (useSessionItemRefund) instead of the generic
          void/refund path. `accountReduction` renders the read-only
          "Reduces <client>'s account by ..." line; `legs` is the preview's
          `defaultLegs`. Round-2 review (finding 4): prefer the preview's own
          `accountClientName` (the "Session Debt" row's actual client, which
          can differ from the row's own client inside a basket) over the
          row's `target.clientLabel` fallback. */}
      {sessionItemRefund.preview && (
        <RefundMethodModal
          legs={sessionItemRefund.preview.legs}
          units={sessionItemRefundUnits}
          accountReduction={{
            usd: sessionItemRefund.preview.accountReductionUsd,
            lbp: sessionItemRefund.preview.accountReductionLbp,
            ...(sessionItemRefund.preview.accountClientName ||
            sessionItemRefund.preview.target.clientLabel
              ? {
                  clientLabel:
                    sessionItemRefund.preview.accountClientName ||
                    sessionItemRefund.preview.target.clientLabel,
                }
              : {}),
          }}
          paymentMethods={drawerAffectingMethods.map((m) => ({
            code: m.code,
            label: m.label,
          }))}
          exchangeRate={
            sessionItemRefund.preview.bookedRate ?? fallbackRate ?? 89000
          }
          bookedRateSource={
            sessionItemRefund.preview.bookedRateSource ?? "fallback"
          }
          // LIRA-236 — re-preview (account reduction + remainder) at the
          // typed rate, debounced inside the hook.
          onRateChange={sessionItemRefund.changeRate}
          // Refund kept change — same shared type list as above.
          allowKeptChange={REFUND_KEPT_CHANGE_TYPES.includes(
            sessionItemRefund.preview.target.transactionType ?? "",
          )}
          isSubmitting={sessionItemRefund.submitting}
          onCancel={() => {
            setSessionItemRefundUnits([]);
            sessionItemRefund.cancel();
          }}
          onConfirm={sessionItemRefund.confirm}
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
