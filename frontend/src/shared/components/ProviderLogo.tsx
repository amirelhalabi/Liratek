import {
  PROVIDER_BRANDS,
  type ProviderBrandKey,
} from "@/shared/brand/providerBrands";

/**
 * A provider logo. `icon` (default) is the small round or rounded-square mark;
 * `logo` / `logoOnDark` are the wordmarks for light / dark backgrounds (for
 * providers with a single mark, all three are the same image). Decorative by
 * default (empty alt) — pass `alt` when the logo is the only thing naming the
 * provider.
 */
export function ProviderLogo({
  brand,
  variant = "icon",
  size = 16,
  className = "",
  alt = "",
}: {
  brand: ProviderBrandKey;
  variant?: "icon" | "logo" | "logoOnDark";
  /** Height in px (icons are square). */
  size?: number;
  className?: string;
  alt?: string;
}) {
  const b = PROVIDER_BRANDS[brand];
  const isIcon = variant === "icon";
  return (
    <img
      src={b[variant]}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      data-testid={`provider-logo-${brand.toLowerCase()}`}
      draggable={false}
      className={`inline-block shrink-0 select-none object-contain ${
        isIcon ? (b.shape === "circle" ? "rounded-full" : "rounded-[22%]") : ""
      } ${className}`}
      style={isIcon ? { width: size, height: size } : { height: size }}
    />
  );
}
