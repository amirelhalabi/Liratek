import { TrendingUp } from "lucide-react";

interface UsdLbpTotalChipsProps {
  usd: number;
  lbp: number;
  /** Word before the currency, e.g. "Total" or "Net". */
  label?: string;
}

function signed(text: string, n: number): string {
  return n < 0 ? `-${text}` : text;
}

/** Two chips for a History window header: "<label> USD" and "<label> LBP". */
export function UsdLbpTotalChips({
  usd,
  lbp,
  label = "Total",
}: UsdLbpTotalChipsProps) {
  const chip =
    "px-4 py-2 rounded-lg font-medium text-sm flex items-center gap-2 bg-slate-800 text-slate-400 border border-slate-700";
  return (
    <div className="flex flex-wrap gap-2">
      <div className={chip} data-testid="history-total-usd">
        <TrendingUp className="w-4 h-4 shrink-0" />
        <span className="font-medium whitespace-nowrap">{label} USD</span>
        <span className="font-bold text-white">
          {signed(`$${Math.abs(usd).toFixed(2)}`, usd)}
        </span>
      </div>
      <div className={chip} data-testid="history-total-lbp">
        <TrendingUp className="w-4 h-4 shrink-0" />
        <span className="font-medium whitespace-nowrap">{label} LBP</span>
        <span className="font-bold text-white">
          {signed(Math.abs(lbp).toLocaleString(), lbp)}
        </span>
      </div>
    </div>
  );
}
