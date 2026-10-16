import { brandOf } from "@/shared/brand/providerBrands";
import { ProviderLogo } from "@/shared/components/ProviderLogo";

/**
 * A drawer / payment-method label with its provider's icon (Whish, OMT,
 * iPick, Katsh, MTC, Alfa, Binance) in front of it when `code` belongs to a
 * brand (`brandOf`), and the bare label otherwise — one rule for every place
 * a drawer or wallet is named.
 *
 * The label text is never changed and stays ONE text node, so `getByText`
 * and screen readers read exactly what they read before. The icon is
 * decorative (empty alt). Unknown codes render a bare fragment, i.e. the
 * markup is identical to the plain label.
 */
export function BrandedLabel({
  code,
  label,
  size = 14,
  className = "",
}: {
  /** Drawer name or payment-method code, e.g. `OMT_App`, `WHISH`. */
  code: string | null | undefined;
  label: string;
  /** Icon size in px. */
  size?: number;
  /** Classes for the text span (only used when an icon is shown). */
  className?: string;
}) {
  const brand = brandOf(code);
  if (!brand) return <>{label}</>;
  return (
    <span className="inline-flex items-center gap-1 min-w-0 max-w-full align-middle">
      <ProviderLogo brand={brand} variant="icon" size={size} />
      <span className={`truncate ${className}`}>{label}</span>
    </span>
  );
}
