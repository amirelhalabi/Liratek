import { useState, useEffect } from "react";
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
import { appEvents, EXCHANGE_RATE } from "@liratek/ui";
import logger from "@/utils/logger";
import {
  formatReceipt58mm,
  type ReceiptData,
} from "@/features/sales/utils/receiptFormatter";
import { useShopInfo } from "@/hooks/useShopName";
import { printReceipt } from "@/shared/utils/printReceipt";
import { ConfirmModal } from "@liratek/ui";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import { getWarrantyState } from "@/features/sales/utils/warrantyStatus";

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
  const shopInfo = useShopInfo();
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [items, setItems] = useState<SaleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refunding, setRefunding] = useState(false);
  const [showRefundConfirm, setShowRefundConfirm] = useState(false);
  const [showRefundQuantity, setShowRefundQuantity] = useState(false);
  const [selectedRefundItem, setSelectedRefundItem] = useState<SaleItem | null>(
    null,
  );
  // RCP-1 walk-in rename: edit the customer on a walk-in sale (client_id null).
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [savingCustomer, setSavingCustomer] = useState(false);

  const loadSale = async () => {
    setLoading(true);
    try {
      const [saleData, itemsData] = await Promise.all([
        window.api.sales.get(saleId),
        window.api.sales.getItems(saleId),
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
      const result = await window.api.sales.updateMetadata({
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

  const handleRefund = async () => {
    if (!sale) return;
    setRefunding(true);
    try {
      const result = await window.api.sales.refund(saleId);
      if (result.success) {
        appEvents.emit(
          "notification:show",
          "Sale refunded successfully",
          "success",
        );
        appEvents.emit("sale:completed", { refunded: true, saleId });
        onRefunded?.();
        onClose();
        // Windows focus fix
        (window as any).api?.display?.fixFocus?.();
      } else {
        appEvents.emit(
          "notification:show",
          result.error || "Refund failed",
          "error",
        );
      }
    } catch (_err) {
      appEvents.emit(
        "notification:show",
        "Refund failed unexpectedly",
        "error",
      );
    } finally {
      setRefunding(false);
      setShowRefundConfirm(false);
    }
  };

  const handleRefundItem = async (item: SaleItem, quantity: number) => {
    if (!sale) return;

    setRefunding(true);
    try {
      const result = await window.api.sales.refundItem(
        saleId,
        item.id,
        quantity,
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
        const itemsData = await window.api.sales.getItems(saleId);
        setItems(itemsData ?? []);
      } else {
        appEvents.emit(
          "notification:show",
          result.error || "Item refund failed",
          "error",
        );
      }
    } catch (_err) {
      appEvents.emit(
        "notification:show",
        "Item refund failed unexpectedly",
        "error",
      );
    } finally {
      setRefunding(false);
      setShowRefundQuantity(false);
      setSelectedRefundItem(null);
    }
  };

  const handlePrintReceipt = async () => {
    if (!sale) return;

    const receipt: ReceiptData = {
      shop_name: shopInfo.name,
      shop_phone: shopInfo.phone,
      shop_location: shopInfo.location,
      receipt_number: `RCP-${sale.id}`,
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
      const settings = await window.api?.settings?.getAll?.();
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

  const isRefunded = sale?.status === "refunded";
  // LIRA-143 phase 6a — computed once per render for the per-line warranty
  // hint below (getWarrantyState compares only the YYYY-MM-DD prefix).
  const todayIso = new Date().toISOString();

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
                          {/* LIRA-143 phase 6a — minimal warranty hint;
                              the full precedence UI (overrides, refund
                              interaction) lives in the IMEI story card. */}
                          {item.warranty_until &&
                            (() => {
                              const state = getWarrantyState(
                                item.warranty_until,
                                todayIso,
                                isFullyRefunded,
                              );
                              if (state === "NONE") return null;
                              const label =
                                state === "VOID"
                                  ? "Warranty void (refunded)"
                                  : state === "COVERED"
                                    ? `Warranty until ${item.warranty_until} (covered)`
                                    : `Warranty until ${item.warranty_until} (expired)`;
                              const colorClass =
                                state === "VOID"
                                  ? "text-slate-600"
                                  : state === "COVERED"
                                    ? "text-emerald-500"
                                    : "text-amber-500";
                              return (
                                <div
                                  className={`text-[11px] mt-0.5 ${colorClass}`}
                                >
                                  {label}
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
                  onClick={() => setShowRefundConfirm(true)}
                  disabled={refunding}
                  className="ml-auto px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium flex items-center gap-2 transition-colors disabled:opacity-50"
                >
                  <RotateCcw size={16} />
                  {refunding ? "Refunding..." : "Refund Sale"}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <ConfirmModal
        isOpen={showRefundConfirm}
        title="Refund Sale"
        message="Are you sure you want to refund this sale? This will restore stock and reverse payments. This action cannot be undone."
        onConfirm={handleRefund}
        onCancel={() => setShowRefundConfirm(false)}
        variant="danger"
      />

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
              handleRefundItem(selectedRefundItem, quantity);
            }}
            onCancel={() => {
              setShowRefundQuantity(false);
              setSelectedRefundItem(null);
            }}
          />
        </div>
      )}
    </div>
  );
}

// =============================================================================
// RefundQuantityModal Component
// =============================================================================

interface RefundQuantityModalProps {
  itemName: string;
  availableQuantity: number;
  onConfirm: (quantity: number) => void;
  onCancel: () => void;
}

function RefundQuantityModal({
  itemName,
  availableQuantity,
  onConfirm,
  onCancel,
}: RefundQuantityModalProps) {
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    setQuantity(1);
  }, [availableQuantity]);

  return (
    <div
      className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="p-6 border-b border-slate-700">
        <h3 className="text-lg font-bold text-white">Refund Item Quantity</h3>
      </div>

      <div className="p-6 space-y-4">
        <p className="text-slate-300">
          Refunding:{" "}
          <span className="font-semibold text-white">{itemName}</span>
        </p>

        <div className="space-y-2">
          <label className="text-sm text-slate-400">
            Available to refund: {availableQuantity}
          </label>
          <input
            type="number"
            min={1}
            max={availableQuantity}
            value={quantity}
            onChange={(e) =>
              setQuantity(
                Math.max(
                  1,
                  Math.min(availableQuantity, parseInt(e.target.value) || 1),
                ),
              )
            }
            className="w-full px-4 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        </div>
      </div>

      <div className="p-4 border-t border-slate-700 flex gap-3">
        <button
          onClick={onCancel}
          className="flex-1 px-4 py-2.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg font-medium transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => onConfirm(quantity)}
          className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium transition-colors"
        >
          Refund {quantity}x
        </button>
      </div>
    </div>
  );
}
