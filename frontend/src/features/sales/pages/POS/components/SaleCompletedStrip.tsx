/**
 * LIRA-333 (FR-001) — "Sale completed — RCP-n · Send on WhatsApp · Print".
 *
 * A small strip on the POS screen after Complete Sale. Non-modal and it
 * never takes focus, so typing, scanning and starting the next sale work as
 * before (SC-007). Send and Print both use the SAVED sale, read once
 * through the shared sender, so the strip's message equals the one the sale
 * details window sends (SC-003). WhatsApp opens only on the cashier's click
 * (FR-004).
 */
import { Printer, X, CheckCircle2 } from "lucide-react";
import { useApi } from "@liratek/ui";
import { receiptNumberFor } from "@liratek/core";
import logger from "@/utils/logger";
import { useShopInfo } from "@/hooks/useShopName";
import { useSendReceiptOnWhatsApp } from "@/features/sales/hooks/useSendReceiptOnWhatsApp";
import { SendOnWhatsAppControl } from "@/features/sales/components/SendOnWhatsAppButton";
import { printSaleReceipt } from "@/features/sales/utils/printSaleReceipt";

export default function SaleCompletedStrip({
  saleId,
  onClose,
}: {
  saleId: number;
  onClose: () => void;
}) {
  const api = useApi();
  const shop = useShopInfo();
  const sender = useSendReceiptOnWhatsApp(saleId);

  const handlePrint = async () => {
    if (!sender.receipt) return;
    try {
      await printSaleReceipt(api, sender.receipt, shop.logo);
    } catch (err) {
      logger.error("Printing the completed sale's receipt failed", { err });
    }
  };

  return (
    <div
      role="status"
      aria-label="Sale completed"
      className="flex flex-wrap items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-950/40 px-4 py-2"
    >
      <span className="flex items-center gap-2 py-1.5 text-sm text-emerald-200">
        <CheckCircle2 size={16} className="text-emerald-400" />
        Sale completed —{" "}
        <span className="font-mono font-semibold">
          {receiptNumberFor(saleId)}
        </span>
      </span>
      <SendOnWhatsAppControl sender={sender} compact />
      <button
        type="button"
        onClick={handlePrint}
        disabled={sender.status !== "ready"}
        className="px-3 py-1.5 text-sm text-blue-300 hover:text-blue-100 hover:bg-blue-900/30 rounded-lg font-medium border border-blue-500/30 flex items-center gap-2 transition-colors disabled:opacity-50"
      >
        <Printer size={16} />
        Print
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="ml-auto p-1.5 text-slate-400 hover:text-white rounded-lg"
      >
        <X size={16} />
      </button>
    </div>
  );
}
