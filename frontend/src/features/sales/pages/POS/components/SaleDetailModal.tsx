import { useState, useEffect } from "react";
import {
  X,
  RotateCcw,
  User,
  Clock,
  Package,
  DollarSign,
  Printer,
} from "lucide-react";
import { appEvents } from "@liratek/ui";
import {
  formatReceipt58mm,
  type ReceiptData,
} from "@/features/sales/utils/receiptFormatter";
import { useShopInfo } from "@/hooks/useShopName";
import { ConfirmModal } from "@/shared/components/ConfirmModal";

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
}

interface SaleDetail {
  id: number;
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
  const shopInfo = useShopInfo();
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [items, setItems] = useState<SaleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refunding, setRefunding] = useState(false);
  const [showRefundConfirm, setShowRefundConfirm] = useState(false);

  useEffect(() => {
    const load = async () => {
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
    load();
  }, [saleId]);

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
      })),
      subtotal: sale.total_amount_usd,
      discount: sale.discount_usd,
      total: sale.final_amount_usd,
      payment_usd: sale.paid_usd,
      payment_lbp: sale.paid_lbp,
      change_usd: sale.change_given_usd ?? 0,
      change_lbp: sale.change_given_lbp ?? 0,
      exchange_rate: sale.exchange_rate_snapshot || 90000,
      timestamp: sale.created_at,
    };

    const receiptCSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 80mm; margin: 0 auto; }
  pre { font-family: 'Courier New', monospace; font-size: 11px; font-weight: bold; white-space: pre-wrap; word-break: break-all; line-height: 1.4; }
  @media print {
    @page { size: 80mm auto; margin: 0; }
    html, body { width: 80mm; margin: 0; padding: 0; }
  }`;

    const formatted = formatReceipt58mm(receipt);
    const fullHtml = `<!DOCTYPE html>
<html>
<head><title>Receipt</title><style>${receiptCSS}</style></head>
<body><pre>${formatted}</pre></body>
</html>`;

    // Try silent print to configured receipt printer
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

    if (targetPrinter && window.api?.print?.silentPrint) {
      const result = await window.api.print.silentPrint(fullHtml, targetPrinter);
      if (!result?.success) {
        appEvents.emit(
          "notification:show",
          "Receipt printing failed: " + (result?.error || "Unknown error"),
          "error",
        );
      }
    } else {
      const printWindow = window.open("", "", "width=400,height=600");
      if (printWindow) {
        printWindow.document.write(fullHtml);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
        printWindow.close();
        setTimeout(() => {
          (window as any).api?.display?.fixFocus?.();
        }, 100);
      }
    }
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleString();
  };

  const isRefunded = sale?.status === "refunded";

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-200"
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
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between px-4 py-3"
                    >
                      <div className="flex-1 min-w-0 mr-3">
                        <p
                          className={`text-sm truncate ${item.is_refunded ? "text-red-400 line-through" : "text-slate-200"}`}
                        >
                          {item.name}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span>
                            {item.quantity} x ${item.sold_price_usd.toFixed(2)}
                          </span>
                          {item.barcode && (
                            <span className="font-mono">{item.barcode}</span>
                          )}
                          {item.imei && (
                            <span className="font-mono text-slate-600">
                              IMEI: {item.imei}
                            </span>
                          )}
                        </div>
                      </div>
                      <span
                        className={`text-sm font-mono shrink-0 ${item.is_refunded ? "text-red-400 line-through" : "text-slate-300"}`}
                      >
                        ${(item.quantity * item.sold_price_usd).toFixed(2)}
                      </span>
                    </div>
                  ))}
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
    </div>
  );
}
