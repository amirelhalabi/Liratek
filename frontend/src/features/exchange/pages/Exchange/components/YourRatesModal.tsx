/**
 * "Your Rates" modal — the shop's OWN configured trading rates.
 *
 * Opened from the info button beside History. Kept out of the always-visible
 * side column (which shows market reference instead) because these are
 * consulted occasionally, not read continuously — but they are the rates that
 * actually determine what gets charged and what profit gets stamped, so they
 * stay one click away rather than buried in Settings.
 *
 * Presentation lives in RatesPanel; this is only the dialog frame.
 */

import { TrendingUp, X } from "lucide-react";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import type { ExchangeRate } from "@/utils/currencyUtils";
import { RatesPanel } from "./RatesPanel";

interface YourRatesModalProps {
  rates: ExchangeRate[];
  loading?: boolean;
  onClose: () => void;
}

export function YourRatesModal({
  rates,
  loading = false,
  onClose,
}: YourRatesModalProps) {
  useModalFocusFix(true);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        data-testid="exchange-your-rates-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Your configured rates"
        className="relative w-full max-w-sm max-h-[85vh] bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl flex flex-col animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 px-5 py-4 border-b border-slate-700/60 shrink-0">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <TrendingUp className="text-violet-400" size={18} />
            Your Rates
            <span className="text-xs text-slate-500 font-normal ml-1">
              ({rates.length} configured)
            </span>
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <RatesPanel rates={rates} loading={loading} bare />
        </div>
      </div>
    </div>
  );
}

export default YourRatesModal;
