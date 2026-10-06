import { AlertTriangle } from "lucide-react";

/**
 * LIRA-260 — the ONE warning shown when a cashier edits a selling price away
 * from its saved catalog / preset price. Warning only: it never blocks or
 * confirms, the sale still goes through at the edited price.
 *
 * Renders nothing when either price is missing (free-text item, empty field)
 * or when the two are equal within the currency's rounding (a cent for USD,
 * one lira for LBP), so float noise never raises a false alarm.
 */
export interface PriceChangeWarningProps {
  /** The saved price the field was prefilled from; null/undefined = none. */
  catalogPrice: number | null | undefined;
  /** What the cashier is about to charge. */
  currentPrice: number | null | undefined;
  currency: "USD" | "LBP";
  className?: string;
}

const TOLERANCE: Record<PriceChangeWarningProps["currency"], number> = {
  USD: 0.005,
  LBP: 0.5,
};

function formatPrice(
  amount: number,
  currency: PriceChangeWarningProps["currency"],
): string {
  return currency === "USD"
    ? `$${amount.toFixed(2)}`
    : `${Math.round(amount).toLocaleString()} LBP`;
}

function isPriceChanged(
  catalogPrice: number | null | undefined,
  currentPrice: number | null | undefined,
  currency: PriceChangeWarningProps["currency"],
): boolean {
  if (catalogPrice == null || currentPrice == null) return false;
  if (!Number.isFinite(catalogPrice) || !Number.isFinite(currentPrice)) {
    return false;
  }
  return Math.abs(catalogPrice - currentPrice) >= TOLERANCE[currency];
}

export function PriceChangeWarning({
  catalogPrice,
  currentPrice,
  currency,
  className = "",
}: PriceChangeWarningProps) {
  if (!isPriceChanged(catalogPrice, currentPrice, currency)) return null;
  // Narrowed by isPriceChanged above.
  const catalog = catalogPrice as number;
  const current = currentPrice as number;
  return (
    <p
      role="status"
      data-testid="price-change-warning"
      className={`flex items-center gap-1 text-xs text-amber-400 ${className}`}
    >
      <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
      <span>
        Price changed: catalog {formatPrice(catalog, currency)} →{" "}
        {formatPrice(current, currency)}
      </span>
    </p>
  );
}
