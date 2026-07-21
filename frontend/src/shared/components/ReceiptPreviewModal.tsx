import { Printer, X } from "lucide-react";
import { printReceipt } from "@/shared/utils/printReceipt";

export interface ReceiptPreviewModalProps {
  /** The monospace receipt body (from formatReceipt58mm/80mm or buildServiceReceiptText). */
  text: string;
  /** Silent target printer; when set (Electron), prints without a dialog. */
  printer?: string;
  /** Optional logo data URL — printed above the text, not shown in the preview itself. */
  logo?: string;
  onClose: () => void;
}

/**
 * In-app receipt preview (RCP-0) — same UI as the POS CheckoutModal's
 * "Receipt Preview" modal, extracted so every module's reprint-from-history
 * Print button can show the receipt before committing to an actual print,
 * instead of invoking the OS print flow directly.
 */
export function ReceiptPreviewModal({
  text,
  printer,
  logo,
  onClose,
}: ReceiptPreviewModalProps) {
  const handlePrint = async () => {
    await printReceipt({
      text,
      ...(printer ? { printer } : {}),
      ...(logo ? { logo } : {}),
    });
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        role="presentation"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-slate-700 flex justify-between items-center">
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Printer size={24} className="text-blue-400" />
            Receipt Preview
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 flex justify-center bg-slate-950">
          <div className="bg-white p-8 shadow-2xl rounded-sm">
            <pre
              className="text-slate-900"
              style={{
                fontFamily: "'Courier New', monospace",
                fontSize: "13px",
                fontWeight: "bold",
                whiteSpace: "pre",
                lineHeight: "1.4",
                width: "auto",
                minWidth: "38ch",
              }}
            >
              {text}
            </pre>
          </div>
        </div>

        <div className="p-6 border-t border-slate-700 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg font-medium transition-colors"
          >
            Close
          </button>
          <button
            onClick={handlePrint}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            <Printer size={18} />
            Print
          </button>
        </div>
      </div>
    </div>
  );
}
