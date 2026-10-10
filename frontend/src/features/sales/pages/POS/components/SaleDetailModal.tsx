import { useState, useEffect, useRef } from "react";
import {
  X,
  RotateCcw,
  User,
  Clock,
  Package,
  DollarSign,
  Printer,
  Pencil,
} from "lucide-react";
import { appEvents, EXCHANGE_RATE, useApi } from "@liratek/ui";
import logger from "@/utils/logger";
import {
  formatReceipt58mm,
  type ReceiptData,
} from "@/features/sales/utils/receiptFormatter";
import { useShopInfo } from "@/hooks/useShopName";
import { printReceipt } from "@/shared/utils/printReceipt";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import { localDay } from "@/shared/utils/localDay";
import {
  ClaimModal,
  type ClaimTarget,
} from "@/features/warranty/components/ClaimModal";
import { useOptionalAuth } from "@/features/auth/context/AuthContext";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import {
  RefundMethodModal,
  type RefundableUnit,
} from "@/features/audit/components/RefundMethodModal";
import { RefundQuantityModal } from "@/features/audit/components/RefundQuantityModal";
import { useSessionItemRefund } from "@/features/audit/hooks/useSessionItemRefund";
import {
  REFUND_KEPT_CHANGE_TYPES,
  receiptNumberFor,
  resolveWarranty,
  type RefundKeptChangeInput,
} from "@liratek/core";
import type { TransactionPaymentLeg } from "@/features/audit/cashFlow";
import type {
  RefundLegOverride,
  RefundUnitExtraOverride,
} from "@/features/audit/refundLegOverride";
import { getProductUnitsForSaleItems } from "@/api/backendApi";

/** LIRA-231 owner decision (2026-09-26): a sale paid through a customer
 *  session basket has its own pooled payment, invisible to a
 *  per-transaction refund (`TransactionRepository.refundBySaleId` /
 *  `SalesRepository.refundSaleItem`'s server-side guard still refuses those
 *  two DESKTOP-only entry points directly). LIRA-232 replaces the UI's old
 *  "go refund it from the session basket" block message with the real
 *  flow below: resolve the sale's {sessionId, transactionId} and refund
 *  through `refundSessionBasketItem` instead, from right here.
 *
 *  Round-2 review (finding 1): the {sessionId, transactionId} pair comes
 *  straight from `getSaleRefundPreview`'s own `sessionId`/
 *  `sessionTransactionId` fields now — NOT a `getTransactionBySource` +
 *  `getSessionForTransaction` two-hop lookup. That lookup resolved the
 *  basket member via "the newest ACTIVE unified transaction for source
 *  sales/saleId", which is correct only until the FIRST item refund: after
 *  that, the newest ACTIVE row for the same source is the ITEM REFUND, not
 *  the original SALE member, so the preview/refund calls targeted the wrong
 *  transaction id and "Refund item"/"Refund Sale" broke on a
 *  once-refunded session sale. */

interface SaleItem {
  id: number;
  sale_id: number;
  product_id: number;
  quantity: number;
  sold_price_usd: number;
  name: string;
  barcode: string;
  imei?: string;
  is_refunded?: number;
  refunded_quantity?: number;
  /** LIRA-143 phase 6a — stamped once at sale time (sale_items.warranty_until,
   *  already selected via `si.*` in SalesRepository.getSaleItems). Null for a
   *  non-IMEI-tracked line or a product with no warranty_months. */
  warranty_until?: string | null;
  /** LIRA-296 — the line's SOLD unit's override (LIRA-143), when there is
   *  one; it wins over `warranty_until` (same precedence as the search). */
  warranty_override_until?: string | null;
}

interface SaleDetail {
  id: number;
  client_id: number | null;
  client_name: string | null;
  client_phone: string | null;
  total_amount_usd: number;
  discount_usd: number;
  final_amount_usd: number;
  paid_usd: number;
  paid_lbp: number;
  change_given_usd: number;
  change_given_lbp: number;
  exchange_rate_snapshot: number;
  status: string;
  created_at: string;
}

interface SaleDetailModalProps {
  saleId: number;
  onClose: () => void;
  onRefunded?: () => void;
}

export default function SaleDetailModal({
  saleId,
  onClose,
  onRefunded,
}: SaleDetailModalProps) {
  useModalFocusFix(true);
  const api = useApi();
  const shopInfo = useShopInfo();
  const { drawerAffectingMethods } = usePaymentMethods();
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [items, setItems] = useState<SaleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refunding, setRefunding] = useState(false);
  const [loadingRefundPreview, setLoadingRefundPreview] = useState(false);
  const [showRefundQuantity, setShowRefundQuantity] = useState(false);
  const [selectedRefundItem, setSelectedRefundItem] = useState<SaleItem | null>(
    null,
  );
  // LIRA-231 — which refund the open RefundMethodModal (if any) is for, and
  // the payment legs it was pre-filled with (that item's proportional
  // share for an item refund, the whole sale's legs for "Refund Sale").
  const [refundTarget, setRefundTarget] = useState<
    { kind: "sale" } | { kind: "item"; item: SaleItem; quantity: number } | null
  >(null);
  const [refundModalLegs, setRefundModalLegs] = useState<
    TransactionPaymentLeg[]
  >([]);
  // 2026-09-26 owner decision — the POS refund window gets the SAME
  // "Returned phones" section the Transactions page's refund modal has
  // always had: the linked IMEI-tracked unit(s) for whichever refund
  // `refundTarget` describes (every item's units for "Refund Sale", just
  // THAT item's for "Refund item"). Empty renders no section at all, same
  // as before this change (RefundMethodModal's own `units.length > 0` gate).
  const [refundModalUnits, setRefundModalUnits] = useState<RefundableUnit[]>(
    [],
  );
  // LIRA-236 — the rate the popup opens with (the preview's own `bookedRate`,
  // falling back to `sale.exchange_rate_snapshot`/EXCHANGE_RATE) + its
  // provenance, computed once when the preview resolves so the popup and the
  // "no rate was recorded" fallback note both read the SAME values render to
  // render (rather than recomputing the fallback chain inline in JSX).
  const [refundModalBookedRate, setRefundModalBookedRate] =
    useState<number>(EXCHANGE_RATE);
  const [refundModalBookedRateSource, setRefundModalBookedRateSource] =
    useState<"sale" | "transaction" | "fallback">("fallback");
  // LIRA-232 — which kind of refund the SESSION flow (useSessionItemRefund)
  // is currently open for. A ref, not state: it's read only from inside the
  // hook's onRefunded callback below (fixed at hook-construction time, so it
  // can't close over fresh state), never rendered directly.
  const sessionRefundKindRef = useRef<
    { kind: "sale" } | { kind: "item"; item: SaleItem; quantity: number } | null
  >(null);
  const [sessionRefundUnits, setSessionRefundUnits] = useState<
    RefundableUnit[]
  >([]);
  // RCP-1 walk-in rename: edit the customer on a walk-in sale (client_id null).
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [savingCustomer, setSavingCustomer] = useState(false);

  const loadSale = async () => {
    setLoading(true);
    try {
      const [saleData, itemsData] = await Promise.all([
        api.getSale(saleId),
        api.getSaleItems(saleId),
      ]);
      setSale(saleData);
      setItems(itemsData ?? []);
    } catch {
      setSale(null);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSale();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleId]);

  const startEditCustomer = () => {
    setEditName(sale?.client_name || "");
    setEditPhone(sale?.client_phone || "");
    setEditingCustomer(true);
  };

  const handleSaveCustomer = async () => {
    if (!sale) return;
    setSavingCustomer(true);
    try {
      const result = await api.updateSaleMetadata({
        id: sale.id,
        client_name: editName.trim(),
        client_phone: editPhone.trim(),
      });
      if (result?.success === false) {
        appEvents.emit(
          "notification:show",
          "Failed to update customer: " + (result.error || "Unknown error"),
          "error",
        );
        return;
      }
      setEditingCustomer(false);
      await loadSale();
      appEvents.emit("notification:show", "Customer updated", "success");
    } catch (e) {
      logger.error("Failed to update sale customer", { error: e });
      appEvents.emit("notification:show", "Failed to update customer", "error");
    } finally {
      setSavingCustomer(false);
    }
  };

  // 2026-09-26 — every linked IMEI-tracked unit for the CURRENTLY LOADED
  // `items` (whole-sale refund) or just ONE item (per-item refund), for the
  // "Returned phones" section. Mirrors TransactionsViewer.handleRefund's
  // identical lookup (`getProductUnitsForSaleItems`) — never blocks the
  // refund on failure, same as there: a lookup error just means no units to
  // flag, not a refund-blocking error.
  const loadRefundUnits = async (
    saleItemIds: number[],
  ): Promise<RefundableUnit[]> => {
    if (saleItemIds.length === 0) return [];
    try {
      const units = await getProductUnitsForSaleItems(saleItemIds);
      return (units ?? []).map((u) => ({ id: u.id, imei: u.imei }));
    } catch (err) {
      logger.error("Failed to load linked phone units for refund", {
        error: err,
      });
      return [];
    }
  };

  // LIRA-232 — the session-flow's own onRefunded: fires once
  // refundSessionBasketItem succeeds. sessionRefundKindRef (set right before
  // sessionRefund.open() below) says whether this was "Refund Sale" or
  // "Refund item", so the success notification/reload matches
  // handleConfirmRefund's non-session equivalents below exactly.
  const sessionRefund = useSessionItemRefund(() => {
    const kind = sessionRefundKindRef.current;
    sessionRefundKindRef.current = null;
    setSessionRefundUnits([]);
    if (kind?.kind === "sale") {
      appEvents.emit(
        "notification:show",
        "Sale refunded successfully",
        "success",
      );
      appEvents.emit("sale:completed", { refunded: true, saleId });
      onRefunded?.();
      onClose();
      window.api?.display?.fixFocus?.();
    } else if (kind?.kind === "item") {
      appEvents.emit(
        "notification:show",
        `Refunded ${kind.quantity}x ${kind.item.name}`,
        "success",
      );
      appEvents.emit("sale:completed", { refunded: true, saleId });
      onRefunded?.();
      void (async () => {
        const itemsData = await api.getSaleItems(saleId);
        setItems(itemsData ?? []);
      })();
    }
  });

  // LIRA-231 — "Refund Sale": load the sale's own payment legs (and whether
  // it's session-linked) BEFORE opening RefundMethodModal, so the modal can
  // pre-fill with exactly what a no-override refund would do.
  //
  // LIRA-232 (2026-09-26 owner decision) — a session-linked sale no longer
  // shows the old block message: it opens the SAME RefundMethodModal
  // through `useSessionItemRefund`, using the preview's own `sessionId`/
  // `sessionTransactionId` (finding 1 — never a separate lookup, see the
  // file-header note), refunding EVERY remaining line of the sale in one
  // operation (owner answer Q2 — no `saleItemId`).
  //
  // 2026-09-26: also loads every linked phone unit across ALL of this sale's
  // items, so the "Returned phones" section covers the whole sale.
  //
  // LIRA-236 (REFUND_EXCHANGE_RATE_PLAN.md §2 owner decision 3) — the
  // popup's default rate: ONLY the server's own `bookedRate`/
  // `bookedRateSource` (`SalesRepository.getSaleRefundPreview`/
  // `getItemRefundPreview`, which already resolve "the sale's own recorded
  // rate, else the day's fallback" — the exact same rule this used to
  // RE-DERIVE from `sale.exchange_rate_snapshot`, a second definition of the
  // server's own business rule, rule 14). `getSaleRefundPreview`'s return
  // type still marks these optional defensively (a non-success response
  // carries neither), so `EXCHANGE_RATE`/`"fallback"` below is a pure
  // type-safety guard, never a business-rule fallback — round-2/final review
  // finding F15.
  const resolveBookedRate = (preview: {
    bookedRate?: number;
    bookedRateSource?: "sale" | "transaction" | "fallback";
  }): { rate: number; source: "sale" | "transaction" | "fallback" } => ({
    rate: preview.bookedRate ?? EXCHANGE_RATE,
    source: preview.bookedRateSource ?? "fallback",
  });

  const openWholeSaleRefund = async () => {
    if (!sale) return;
    setLoadingRefundPreview(true);
    try {
      const [preview, units] = await Promise.all([
        api.getSaleRefundPreview(saleId),
        loadRefundUnits(items.map((i) => i.id)),
      ]);
      if (!preview.success) {
        appEvents.emit(
          "notification:show",
          preview.error || "Failed to load refund details",
          "error",
        );
        return;
      }
      if (preview.sessionLinked) {
        if (preview.sessionId == null || preview.sessionTransactionId == null) {
          appEvents.emit(
            "notification:show",
            "Could not resolve this sale's session — try refunding it from the Transactions page.",
            "error",
          );
          return;
        }
        sessionRefundKindRef.current = { kind: "sale" };
        setSessionRefundUnits(units);
        await sessionRefund.open({
          sessionId: preview.sessionId,
          transactionId: preview.sessionTransactionId,
          ...(sale.client_name ? { clientLabel: sale.client_name } : {}),
          transactionType: "SALE",
        });
        return;
      }
      const booked = resolveBookedRate(preview);
      setRefundModalBookedRate(booked.rate);
      setRefundModalBookedRateSource(booked.source);
      setRefundModalLegs(preview.legs ?? []);
      setRefundModalUnits(units);
      setRefundTarget({ kind: "sale" });
    } catch (_err) {
      appEvents.emit(
        "notification:show",
        "Failed to load refund details",
        "error",
      );
    } finally {
      setLoadingRefundPreview(false);
    }
  };

  // LIRA-231 — "Refund item": same preview-then-modal flow, scoped to this
  // item's proportional share of the sale's legs. LIRA-232: same
  // session-resolution branch as openWholeSaleRefund above, but this item's
  // own `saleItemId`/`quantity`.
  //
  // 2026-09-26: also loads ONLY this item's own linked phone unit(s) — never
  // a sibling line's — for the "Returned phones" section.
  const openItemRefund = async (item: SaleItem, quantity: number) => {
    setLoadingRefundPreview(true);
    try {
      const [preview, units] = await Promise.all([
        api.getSaleRefundPreview(saleId, {
          saleItemId: item.id,
          refundQuantity: quantity,
        }),
        loadRefundUnits([item.id]),
      ]);
      if (!preview.success) {
        appEvents.emit(
          "notification:show",
          preview.error || "Failed to load refund details",
          "error",
        );
        return;
      }
      if (preview.sessionLinked) {
        if (preview.sessionId == null || preview.sessionTransactionId == null) {
          appEvents.emit(
            "notification:show",
            "Could not resolve this sale's session — try refunding it from the Transactions page.",
            "error",
          );
          return;
        }
        sessionRefundKindRef.current = { kind: "item", item, quantity };
        setSessionRefundUnits(units);
        await sessionRefund.open({
          sessionId: preview.sessionId,
          transactionId: preview.sessionTransactionId,
          saleItemId: item.id,
          quantity,
          ...(sale?.client_name ? { clientLabel: sale.client_name } : {}),
          transactionType: "SALE",
        });
        return;
      }
      const booked = resolveBookedRate(preview);
      setRefundModalBookedRate(booked.rate);
      setRefundModalBookedRateSource(booked.source);
      setRefundModalLegs(preview.legs ?? []);
      setRefundModalUnits(units);
      setRefundTarget({ kind: "item", item, quantity });
    } catch (_err) {
      appEvents.emit(
        "notification:show",
        "Failed to load refund details",
        "error",
      );
    } finally {
      setLoadingRefundPreview(false);
      setShowRefundQuantity(false);
      setSelectedRefundItem(null);
    }
  };

  // Typing follow-up (rule 21/24) — RefundMethodModal's own `RefundLegOverride`
  // (frontend/src/features/audit/refundLegOverride.ts) is now a type alias
  // for the core schema's `RefundLegInput`, the SAME type the adapter's
  // `refundSale`/`refundSaleItem` derive their `refundLegs` param off of
  // (rule 21) — so `refundLegsInput` below is already the exact shape those
  // calls expect. No conversion needed; a hand-rolled narrow here would just
  // be a second, driftable copy of `toRefundLegs` (refundLegOverride.ts),
  // which already did the ONE real narrow (loose `PaymentLine.currencyCode`
  // -> `"USD" | "LBP"`) before RefundMethodModal ever calls `onConfirm`.

  // LIRA-231 — RefundMethodModal's Confirm: posts the operator's chosen (or
  // untouched-default, `refundLegs === undefined`) return legs for whichever
  // refund `refundTarget` describes.
  //
  // 2026-09-26: `unitExtras` — RefundMethodModal's own `RefundUnitExtraOverride`
  // shape already matches the adapter's schema-derived `unitExtras` param
  // structurally (unit_id/is_defective?/warranty_override_until?), so unlike
  // `refundLegs` this needs no narrowing conversion — forwarded as-is.
  //
  // LIRA-236: `exchangeRate` — the rate RefundMethodModal was showing at
  // confirm time (its own onConfirm contract: present only alongside a real
  // `refundLegs` override), forwarded to `api.refundSale`/`refundSaleItem`
  // as-is — no conversion needed, it's already a plain number.
  const handleConfirmRefund = async (
    refundLegsInput: RefundLegOverride[] | undefined,
    unitExtras?: RefundUnitExtraOverride[],
    exchangeRate?: number,
    // Owner decision 2026-10-07 — refund kept change. Both POS refunds
    // offer it (`allowKeptChange` below); it rides only when present, so a
    // refund without it makes exactly the call it made before.
    keptChange?: RefundKeptChangeInput,
  ) => {
    if (!refundTarget) return;
    const refundLegs = refundLegsInput;
    setRefunding(true);
    try {
      if (refundTarget.kind === "sale") {
        const result =
          keptChange !== undefined
            ? await api.refundSale(
                saleId,
                refundLegs,
                unitExtras,
                exchangeRate,
                keptChange,
              )
            : await api.refundSale(
                saleId,
                refundLegs,
                unitExtras,
                exchangeRate,
              );
        if (result.success) {
          appEvents.emit(
            "notification:show",
            "Sale refunded successfully",
            "success",
          );
          appEvents.emit("sale:completed", { refunded: true, saleId });
          onRefunded?.();
          onClose();
          // Windows focus fix — Electron-only workaround for a focus bug
          // after a modal closes; a no-op in the browser (window.api is
          // undefined there), so no REST/web equivalent exists or is needed.
          window.api?.display?.fixFocus?.();
        } else {
          appEvents.emit(
            "notification:show",
            result.error || "Refund failed",
            "error",
          );
        }
      } else {
        const { item, quantity } = refundTarget;
        const result =
          keptChange !== undefined
            ? await api.refundSaleItem(
                saleId,
                item.id,
                quantity,
                refundLegs,
                unitExtras,
                exchangeRate,
                keptChange,
              )
            : await api.refundSaleItem(
                saleId,
                item.id,
                quantity,
                refundLegs,
                unitExtras,
                exchangeRate,
              );
        if (result.success) {
          appEvents.emit(
            "notification:show",
            `Refunded ${quantity}x ${item.name}`,
            "success",
          );
          appEvents.emit("sale:completed", { refunded: true, saleId });
          onRefunded?.();
          // Reload items to show updated refunded_quantity
          const itemsData = await api.getSaleItems(saleId);
          setItems(itemsData ?? []);
        } else {
          appEvents.emit(
            "notification:show",
            result.error || "Item refund failed",
            "error",
          );
        }
      }
    } catch (_err) {
      appEvents.emit(
        "notification:show",
        "Refund failed unexpectedly",
        "error",
      );
    } finally {
      setRefunding(false);
      setRefundTarget(null);
      setRefundModalLegs([]);
      setRefundModalUnits([]);
    }
  };

  const handlePrintReceipt = async () => {
    if (!sale) return;

    const receipt: ReceiptData = {
      shop_name: shopInfo.name,
      shop_phone: shopInfo.phone,
      shop_location: shopInfo.location,
      // LIRA-296: the saved header (SF-3) and the warranty terms.
      header_text: shopInfo.headerText ?? "",
      warranty_terms: shopInfo.warrantyTerms ?? "",
      receipt_number: receiptNumberFor(sale.id),
      client_name: sale.client_name || "Walk-in Customer",
      client_phone: sale.client_phone || "",
      items: items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        price: item.sold_price_usd,
        subtotal: item.sold_price_usd * item.quantity,
        imei: item.imei || null,
        // LIRA-143 phase 6a — the sale row already exists here, so use the
        // EXACT stamped value rather than recomputing it.
        warranty_until: item.warranty_until || null,
      })),
      subtotal: sale.total_amount_usd,
      discount: sale.discount_usd,
      total: sale.final_amount_usd,
      payment_usd: sale.paid_usd,
      payment_lbp: sale.paid_lbp,
      change_usd: sale.change_given_usd ?? 0,
      change_lbp: sale.change_given_lbp ?? 0,
      exchange_rate: sale.exchange_rate_snapshot || EXCHANGE_RATE,
      timestamp: sale.created_at,
    };

    const formatted = formatReceipt58mm(receipt);

    let targetPrinter = "";
    try {
      const settings = await api.getAllSettings();
      if (settings) {
        const printerSetting = settings.find(
          (s: any) => s.key_name === "receipt_printer",
        );
        if (printerSetting?.value) {
          targetPrinter = printerSetting.value;
        }
      }
    } catch {
      // ignore — fall through to popup
    }

    await printReceipt({
      text: formatted,
      logo: shopInfo.logo,
      printer: targetPrinter,
    });
  };

  const formatTime = (dateStr: string) => {
    const d = parseDbDate(dateStr);
    return d.toLocaleString();
  };

  // LIRA-232 round-2 review (finding 3) — `sale.status` is the PRIMARY
  // signal, but a session basket's WHOLE-BASKET reversal (a different code
  // path than this modal's own "Refund Sale"/"Refund item") reverses a
  // partly item-refunded sale's remaining lines through the session-item
  // reversal helper, not through `SalesRepository.refundSale` itself — so a
  // stale open modal must not rely on `sale.status` alone to decide whether
  // "Refund Sale" is still safe to click. Falling back to "every loaded line
  // is already fully refunded" catches that case defensively: it hides the
  // (now guaranteed to error) whole-sale refund button using the SAME
  // `refunded_quantity`/`quantity` state each line's own "Refund item" icon
  // already keys off (see `isFullyRefunded` below), so the two can never
  // disagree with each other.
  const allItemsFullyRefunded =
    items.length > 0 &&
    items.every((i) => (i.refunded_quantity ?? 0) >= i.quantity);
  const isRefunded = sale?.status === "refunded" || allItemsFullyRefunded;
  // LIRA-232 round-2 review (finding 4) — the session-refund modal's account
  // line prefers the preview's own `accountClientName` (the "Session Debt"
  // row's actual client) over the sale's own name; computed once so the JSX
  // below can spread a single optional prop without an `undefined` literal
  // reaching `AccountReductionInfo.clientLabel` (exactOptionalPropertyTypes).
  const sessionAccountClientLabel: string | undefined =
    sessionRefund.preview?.accountClientName || sale?.client_name || undefined;
  // LIRA-296 P2 — start a warranty claim from a covered line.
  const [claimTarget, setClaimTarget] = useState<ClaimTarget | null>(null);
  const isAdmin = useOptionalAuth()?.user?.role === "admin";
  // LIRA-296 — the per-line warranty state uses the shop's own day (the
  // browser's local day, rule 27), never the UTC day toISOString() gives.
  const today = localDay();

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
        role="presentation"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-700 flex justify-between items-center bg-slate-800/50">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              Sale #{saleId}
              {isRefunded && (
                <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400 font-medium flex items-center gap-1">
                  <RotateCcw size={12} />
                  Refunded
                </span>
              )}
            </h2>
            {sale && (
              <div className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                <Clock size={12} />
                {formatTime(sale.created_at)}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48 text-slate-500">
            Loading...
          </div>
        ) : !sale ? (
          <div className="flex items-center justify-center h-48 text-slate-500">
            Sale not found
          </div>
        ) : (
          <>
            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Customer */}
              <div className="flex items-center gap-3">
                <div className="p-2 bg-slate-800 rounded-lg">
                  <User size={16} className="text-slate-400" />
                </div>
                {editingCustomer ? (
                  <div className="flex-1 flex flex-col gap-2">
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Customer name"
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-orange-500"
                    />
                    <input
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      placeholder="Phone (optional)"
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-orange-500"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleSaveCustomer}
                        disabled={savingCustomer}
                        className="px-3 py-1 rounded-lg text-xs font-semibold bg-orange-600 hover:bg-orange-500 disabled:bg-slate-700 text-white"
                      >
                        {savingCustomer ? "Saving..." : "Save"}
                      </button>
                      <button
                        onClick={() => setEditingCustomer(false)}
                        className="px-3 py-1 rounded-lg text-xs font-semibold text-slate-400 hover:text-white"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div>
                      <div className="text-sm text-slate-200">
                        {sale.client_name || "Walk-in Customer"}
                      </div>
                      {sale.client_phone && (
                        <div className="text-xs text-slate-500">
                          {sale.client_phone}
                        </div>
                      )}
                    </div>
                    {/* Rename is a walk-in-only affordance (client_id null): a
                        client-linked sale takes its name from the client record. */}
                    {sale.client_id == null && !isRefunded && (
                      <button
                        onClick={startEditCustomer}
                        title="Edit customer"
                        className="p-1 text-slate-500 hover:text-orange-400"
                      >
                        <Pencil size={13} />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Items */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Package size={14} className="text-slate-400" />
                  <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
                    Items ({items.length})
                  </h3>
                </div>
                <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 divide-y divide-slate-700/50">
                  {items.map((item) => {
                    const alreadyRefunded = item.refunded_quantity ?? 0;
                    const isFullyRefunded = alreadyRefunded >= item.quantity;

                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between px-4 py-3"
                      >
                        <div className="flex-1 min-w-0 mr-3">
                          <p
                            className={`text-sm truncate ${isFullyRefunded ? "text-red-400 line-through" : "text-slate-200"}`}
                          >
                            {item.name}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <span>
                              Qty: {item.quantity}
                              {alreadyRefunded > 0 && (
                                <span className="text-red-400 ml-1">
                                  ({alreadyRefunded} refunded)
                                </span>
                              )}
                            </span>
                            <span>× ${item.sold_price_usd.toFixed(2)}</span>
                            {item.barcode && (
                              <span className="font-mono">{item.barcode}</span>
                            )}
                            {item.imei && (
                              <span className="font-mono text-slate-600">
                                IMEI: {item.imei}
                              </span>
                            )}
                          </div>
                          {/* LIRA-296 — every warranty line shows its
                              state (override > refund > stamped date), and a
                              partly refunded line says how many units were
                              refunded. A line without a warranty shows
                              nothing. */}
                          {(item.warranty_until ||
                            item.warranty_override_until) &&
                            (() => {
                              const w = resolveWarranty(
                                item.warranty_until,
                                today,
                                {
                                  overrideUntil: item.warranty_override_until,
                                  fullyRefunded: isFullyRefunded,
                                },
                              );
                              if (w.state === "NONE") return null;
                              const base =
                                w.state === "VOID"
                                  ? "Void"
                                  : w.state === "COVERED"
                                    ? `Covered until ${w.until}`
                                    : `Expired on ${w.until}`;
                              const partly =
                                w.state !== "VOID" &&
                                alreadyRefunded > 0 &&
                                alreadyRefunded < item.quantity
                                  ? ` · ${alreadyRefunded} of ${item.quantity} refunded`
                                  : "";
                              const colorClass =
                                w.state === "VOID"
                                  ? "text-slate-500"
                                  : w.state === "COVERED"
                                    ? "text-emerald-500"
                                    : "text-amber-500";
                              return (
                                <div
                                  data-testid="sale-line-warranty"
                                  className={`text-[11px] mt-0.5 ${colorClass}`}
                                >
                                  {base + partly}
                                  {w.state !== "VOID" && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setClaimTarget({
                                          saleItemId: item.id,
                                          productId: item.product_id,
                                          productName: item.name,
                                          state: w.state,
                                          units: [],
                                        })
                                      }
                                      className="ml-2 underline text-violet-300 hover:text-violet-100"
                                    >
                                      Warranty claim
                                    </button>
                                  )}
                                </div>
                              );
                            })()}
                        </div>

                        <div className="flex items-center gap-2">
                          <span
                            className={`text-sm font-mono shrink-0 ${isFullyRefunded ? "text-red-400 line-through" : "text-slate-300"}`}
                          >
                            ${(item.quantity * item.sold_price_usd).toFixed(2)}
                          </span>

                          {!isFullyRefunded && !isRefunded && (
                            <button
                              onClick={() => {
                                setSelectedRefundItem(item);
                                setShowRefundQuantity(true);
                              }}
                              disabled={refunding}
                              className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded transition-colors disabled:opacity-50"
                              title="Refund item"
                            >
                              <RotateCcw size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Totals */}
              <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4 space-y-2">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign size={14} className="text-slate-400" />
                  <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
                    Payment
                  </h3>
                </div>
                <div className="flex justify-between text-sm text-slate-400">
                  <span>Subtotal</span>
                  <span>${sale.total_amount_usd.toFixed(2)}</span>
                </div>
                {sale.discount_usd > 0 && (
                  <div className="flex justify-between text-sm text-slate-400">
                    <span>Discount</span>
                    <span>-${sale.discount_usd.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold pt-2 border-t border-slate-700">
                  <span className="text-white">Total</span>
                  <span
                    className={
                      isRefunded
                        ? "text-red-400 line-through"
                        : "text-violet-400"
                    }
                  >
                    ${sale.final_amount_usd.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Paid USD</span>
                  <span>${sale.paid_usd.toFixed(2)}</span>
                </div>
                {sale.paid_lbp > 0 && (
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>Paid LBP</span>
                    <span>{sale.paid_lbp.toLocaleString()}</span>
                  </div>
                )}
                {(sale.change_given_usd > 0 || sale.change_given_lbp > 0) && (
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>Change</span>
                    <span>
                      {sale.change_given_usd > 0 &&
                        `$${sale.change_given_usd.toFixed(2)}`}
                      {sale.change_given_usd > 0 &&
                        sale.change_given_lbp > 0 &&
                        " + "}
                      {sale.change_given_lbp > 0 &&
                        `${sale.change_given_lbp.toLocaleString()} LBP`}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-700 flex gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg font-medium transition-colors"
              >
                Close
              </button>
              <button
                onClick={handlePrintReceipt}
                className="px-4 py-2.5 text-blue-300 hover:text-blue-100 hover:bg-blue-900/30 rounded-lg font-medium border border-blue-500/30 flex items-center gap-2 transition-colors"
              >
                <Printer size={16} />
                Print
              </button>
              {!isRefunded && (
                <button
                  onClick={openWholeSaleRefund}
                  disabled={refunding || loadingRefundPreview}
                  className="ml-auto px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium flex items-center gap-2 transition-colors disabled:opacity-50"
                >
                  <RotateCcw size={16} />
                  {loadingRefundPreview
                    ? "Loading..."
                    : refunding
                      ? "Refunding..."
                      : "Refund Sale"}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {showRefundQuantity && selectedRefundItem && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setShowRefundQuantity(false);
              setSelectedRefundItem(null);
            }
          }}
        >
          <RefundQuantityModal
            itemName={selectedRefundItem.name}
            availableQuantity={
              selectedRefundItem.quantity -
              (selectedRefundItem.refunded_quantity ?? 0)
            }
            onConfirm={(quantity) => {
              openItemRefund(selectedRefundItem, quantity);
            }}
            onCancel={() => {
              setShowRefundQuantity(false);
              setSelectedRefundItem(null);
            }}
          />
        </div>
      )}

      {/* LIRA-231 — reuses the SAME refund-tender-selection modal the
          Transactions page uses (rule 14), pre-filled with either the whole
          sale's or one item's proportional share of the customer-facing
          payment legs. 2026-09-26 owner decision: `units` is now passed too
          — the SAME "Returned phones" per-unit defective/warranty-override
          flagging section the Transactions page's refund modal has always
          had, no longer Transactions-page-only. Empty renders no section at
          all (RefundMethodModal's own gate), same as before this change. */}
      {refundTarget && (
        <RefundMethodModal
          legs={refundModalLegs}
          units={refundModalUnits}
          paymentMethods={drawerAffectingMethods.map((m) => ({
            code: m.code,
            label: m.label,
          }))}
          exchangeRate={refundModalBookedRate}
          bookedRateSource={refundModalBookedRateSource}
          entityLabel="sale"
          // Refund kept change (owner decision 2026-10-07): both the
          // whole-sale and the per-item refund take it (a POS sale is always
          // a `REFUND_KEPT_CHANGE_TYPES` type). The server re-checks it.
          allowKeptChange
          isSubmitting={refunding}
          onCancel={() => {
            setRefundTarget(null);
            setRefundModalLegs([]);
            setRefundModalUnits([]);
          }}
          onConfirm={handleConfirmRefund}
        />
      )}

      {/* LIRA-232 — the SAME modal, driven by the session-item-refund flow
          instead (a session-linked sale). `accountReduction` renders the
          read-only "Reduces <client>'s account by ..." line; `legs` is the
          preview's `defaultLegs`, whose own per-currency total IS the
          remainder still owed back through a drawer (see the hook's doc).
          Round-2 review (finding 4): the account actually credited is
          `accountClientName` (the "Session Debt" row's own client — can
          differ from the item's buyer inside a basket) — `sale.client_name`
          is only the fallback for when the core omits it. */}
      {sessionRefund.preview && (
        <RefundMethodModal
          legs={sessionRefund.preview.legs}
          units={sessionRefundUnits}
          accountReduction={{
            usd: sessionRefund.preview.accountReductionUsd,
            lbp: sessionRefund.preview.accountReductionLbp,
            ...(sessionAccountClientLabel
              ? { clientLabel: sessionAccountClientLabel }
              : {}),
          }}
          paymentMethods={drawerAffectingMethods.map((m) => ({
            code: m.code,
            label: m.label,
          }))}
          // LIRA-236 F15 — ONLY the server's own bookedRate/bookedRateSource
          // (`SessionItemRefundPreview.bookedRate`, always present on a
          // successful preview) — no `sale.exchange_rate_snapshot`
          // re-derivation (rule 14, same fix as `resolveBookedRate` above).
          exchangeRate={sessionRefund.preview.bookedRate ?? EXCHANGE_RATE}
          bookedRateSource={
            sessionRefund.preview.bookedRateSource ?? "fallback"
          }
          entityLabel="sale"
          // LIRA-236 — re-preview (account reduction + remainder) at the
          // typed rate, debounced inside the hook.
          onRateChange={sessionRefund.changeRate}
          // Refund kept change — same shared type list as the server.
          allowKeptChange={REFUND_KEPT_CHANGE_TYPES.includes(
            sessionRefund.preview.target.transactionType ?? "",
          )}
          isSubmitting={sessionRefund.submitting}
          onCancel={() => {
            sessionRefundKindRef.current = null;
            setSessionRefundUnits([]);
            sessionRefund.cancel();
          }}
          onConfirm={sessionRefund.confirm}
        />
      )}
      {claimTarget && (
        <ClaimModal
          target={claimTarget}
          isAdmin={isAdmin}
          onClose={() => setClaimTarget(null)}
          onDone={() => {
            setClaimTarget(null);
            appEvents.emit(
              "notification:show",
              "Warranty claim started",
              "success",
            );
            loadSale();
          }}
        />
      )}
    </div>
  );
}
