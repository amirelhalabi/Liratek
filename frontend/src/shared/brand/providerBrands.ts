import whishIcon from "@/assets/brands/whish-icon.svg";
import whishLogoRed from "@/assets/brands/whish-logo-red.svg";
import whishLogoWhite from "@/assets/brands/whish-logo-white-3000.png";
import omtIcon from "@/assets/brands/omt-icon-2048.png";
import omtLogo from "@/assets/brands/omt-logo.svg";
import omtPayLogo from "@/assets/brands/omt-pay-logo.svg";
import ipickLogo from "@/assets/brands/ipick-logo-688.png";
import katshIcon from "@/assets/brands/katsh-icon-1024.png";
import mtcLogo from "@/assets/brands/mtc-touch-logo-300.png";
import alfaLogo from "@/assets/brands/alfa-logo-225.png";
import binanceIcon from "@/assets/brands/binance-icon.svg";
import binanceMark from "@/assets/brands/binance-mark.svg";
import katshLogo from "@/assets/brands/katsh-logo-400.png";

/**
 * Every Mobile Recharge provider's brand colours and logos, defined ONCE
 * (rule 14). Captured from their own Android apps on 2026-10-16
 * (see `frontend/src/assets/brands/README.md`).
 *
 * Every Tailwind class here is a full literal string on purpose: Tailwind
 * only generates classes it can find written out in the source, so a class
 * built at runtime (`bg-[${hex}]`) would silently have no style. Need a new
 * shade or opacity? Add the literal here and use it from here.
 *
 * `index.css` keeps white labels on `bg-[#ff0a46]` fills in both themes —
 * keep the Whish hex in sync with that selector if it ever changes.
 */

export type ProviderBrandKey =
  | "WHISH"
  | "OMT"
  | "IPICK"
  | "KATSH"
  | "MTC"
  | "ALFA"
  | "BINANCE";

export interface ProviderBrand {
  /** Display name. */
  name: string;
  /** The brand colour, for props that take a raw colour (e.g. `customColor`). */
  hex: string;
  /** Hover shade of `hex`. */
  hoverHex: string;
  /** Label colour that reads on a `hex` fill. */
  onHex: string;

  // ── Tailwind classes (literal strings, see header) ──────────────────────
  /** Solid fill + its label colour. */
  solid: string;
  /** Solid fill + label + hover + glow — the filled call-to-action button. */
  button: string;
  /** Brand-coloured text. */
  text: string;
  /** 10 % tint background. */
  tint: string;
  /** Tinted pill / badge: tint background + brand text. */
  badge: string;
  /** Focus/selection ring. */
  ring: string;
  /** Soft glow shadow. */
  glow: string;
  /** Brand-coloured border. */
  border: string;
  /** Border that turns the brand colour on hover. */
  hoverBorder: string;
  /** Input border when focused. */
  focusBorder: string;
  /** Focus ring (checkboxes, radios). */
  focusRing: string;
  /** Search box focus: soft ring + border. */
  searchFocus: string;
  /** A selected card: tinted border + thin ring. */
  selected: string;
  /** A selected card that is also expanded: stronger ring. */
  selectedStrong: string;
  /** The −/+ quantity buttons on a selected card. */
  stepper: string;

  // ── Drawer-card accent (Dashboard "Drawer Balances", Closing cards) ──────
  /** Coloured left edge of a card. `index.css` re-asserts each of these:
   *  a card's `border-slate-700/*` would otherwise flatten it to slate. */
  accentEdge: string;
  /** Card title colour: a darker shade on light cards, the brand colour on
   *  dark ones — each at least 4.5:1 against its card (#ffffff / #0c134f). */
  accentText: string;
  /** Plain brand fill, no label colour (a card's soft glow orb). */
  accentFill: string;
  /** Card hover glow. */
  accentHover: string;

  // ── Logos (URLs) ─────────────────────────────────────────────────────────
  /** Round app icon (works on light and dark backgrounds). */
  icon: string;
  /** Wordmark for light backgrounds. */
  logo: string;
  /** Wordmark that reads on the brand fill or a dark background. */
  logoOnDark: string;
  /** How the small icon is clipped: a round app icon or a rounded square. */
  shape: "circle" | "rounded";
}

export const PROVIDER_BRANDS: Readonly<
  Record<ProviderBrandKey, ProviderBrand>
> = {
  WHISH: {
    name: "Whish",
    hex: "#ff0a46",
    hoverHex: "#ff2d5e",
    onHex: "#ffffff",
    solid: "bg-[#ff0a46] text-white",
    button:
      "bg-[#ff0a46] hover:bg-[#ff2d5e] text-white shadow-lg shadow-[#ff0a46]/20",
    text: "text-[#ff0a46]",
    tint: "bg-[#ff0a46]/10",
    badge: "bg-[#ff0a46]/10 text-[#ff0a46]",
    ring: "ring-[#ff0a46]/30",
    glow: "shadow-[#ff0a46]/10",
    border: "border-[#ff0a46]/40",
    hoverBorder: "hover:border-[#ff0a46]",
    focusBorder: "focus:border-[#ff0a46]",
    focusRing: "focus:ring-[#ff0a46]",
    searchFocus:
      "focus:ring-2 focus:ring-[#ff0a46]/50 focus:border-[#ff0a46]/50",
    selected: "border-[#ff0a46]/40 ring-1 ring-[#ff0a46]/30",
    selectedStrong: "ring-2 ring-[#ff0a46]/50",
    stepper: "bg-[#ff0a46]/20 hover:bg-[#ff0a46]/30 text-[#ff0a46]",
    accentEdge: "border-l-[#ff0a46]",
    accentText: "text-[#d1003a] dark:text-[#ff2d5e]",
    accentFill: "bg-[#ff0a46]",
    accentHover: "hover:shadow-[#ff0a46]/20",
    icon: whishIcon,
    logo: whishLogoRed,
    logoOnDark: whishLogoWhite,
    shape: "circle",
  },
  OMT: {
    name: "OMT",
    hex: "#ffd800",
    hoverHex: "#ffe433",
    onHex: "#000000",
    solid: "bg-[#ffd800] text-black",
    button:
      "bg-[#ffd800] hover:bg-[#ffe433] text-black shadow-lg shadow-[#ffd800]/20",
    text: "text-[#ffd800]",
    tint: "bg-[#ffd800]/10",
    badge: "bg-[#ffd800]/10 text-[#ffd800]",
    ring: "ring-[#ffd800]/30",
    glow: "shadow-[#ffd800]/10",
    border: "border-[#ffd800]/40",
    hoverBorder: "hover:border-[#ffd800]",
    focusBorder: "focus:border-[#ffd800]",
    focusRing: "focus:ring-[#ffd800]",
    searchFocus:
      "focus:ring-2 focus:ring-[#ffd800]/50 focus:border-[#ffd800]/50",
    selected: "border-[#ffd800]/40 ring-1 ring-[#ffd800]/30",
    selectedStrong: "ring-2 ring-[#ffd800]/50",
    stepper: "bg-[#ffd800]/20 hover:bg-[#ffd800]/30 text-[#ffd800]",
    accentEdge: "border-l-[#ffd800]",
    accentText: "text-[#7a6000] dark:text-[#ffd800]",
    accentFill: "bg-[#ffd800]",
    accentHover: "hover:shadow-[#ffd800]/20",
    icon: omtIcon,
    logo: omtLogo,
    logoOnDark: omtPayLogo,
    shape: "circle",
  },
  /** i-Pick: its app header gradient, green to blue — written as ONE
   *  arbitrary background value on purpose: index.css flattens every
   *  `.bg-gradient-to-*` class into the page wash, so a from-/to- gradient
   *  would render as no colour at all. The logo's teal-green
   *  (#3db387) for text and tints, which reads on dark backgrounds. */
  IPICK: {
    name: "iPick",
    hex: "#569a59",
    hoverHex: "#62a865",
    onHex: "#ffffff",
    solid: "bg-[linear-gradient(to_right,#569a59,#478ebd)] text-white",
    button:
      "bg-[linear-gradient(to_right,#569a59,#478ebd)] hover:bg-[linear-gradient(to_right,#62a865,#539bcb)] text-white shadow-lg shadow-[#4f948b]/20",
    text: "text-[#3db387]",
    tint: "bg-[#3db387]/10",
    badge: "bg-[#3db387]/10 text-[#3db387]",
    ring: "ring-[#3db387]/30",
    glow: "shadow-[#3db387]/10",
    border: "border-[#3db387]/40",
    hoverBorder: "hover:border-[#3db387]",
    focusBorder: "focus:border-[#3db387]",
    focusRing: "focus:ring-[#3db387]",
    searchFocus:
      "focus:ring-2 focus:ring-[#569a59]/50 focus:border-[#569a59]/50",
    selected: "border-[#569a59]/40 ring-1 ring-[#569a59]/30",
    selectedStrong: "ring-2 ring-[#569a59]/50",
    stepper: "bg-[#569a59]/20 hover:bg-[#569a59]/30 text-[#3db387]",
    accentEdge: "border-l-[#3db387]",
    accentText: "text-[#237a58] dark:text-[#3db387]",
    accentFill: "bg-[#3db387]",
    accentHover: "hover:shadow-[#3db387]/20",
    icon: ipickLogo,
    logo: ipickLogo,
    logoOnDark: ipickLogo,
    shape: "rounded",
  },
  /** Katsh: the lime of its Login button, with Katsh blue (#0057b7) labels. */
  KATSH: {
    name: "Katsh",
    hex: "#97d700",
    hoverHex: "#a8e61a",
    onHex: "#0057b7",
    solid: "bg-[#97d700] text-[#0057b7]",
    button:
      "bg-[#97d700] hover:bg-[#a8e61a] text-[#0057b7] shadow-lg shadow-[#97d700]/20",
    text: "text-[#97d700]",
    tint: "bg-[#97d700]/10",
    badge: "bg-[#97d700]/10 text-[#97d700]",
    ring: "ring-[#97d700]/30",
    glow: "shadow-[#97d700]/10",
    border: "border-[#97d700]/40",
    hoverBorder: "hover:border-[#97d700]",
    focusBorder: "focus:border-[#97d700]",
    focusRing: "focus:ring-[#97d700]",
    searchFocus:
      "focus:ring-2 focus:ring-[#97d700]/50 focus:border-[#97d700]/50",
    selected: "border-[#97d700]/40 ring-1 ring-[#97d700]/30",
    selectedStrong: "ring-2 ring-[#97d700]/50",
    stepper: "bg-[#97d700]/20 hover:bg-[#97d700]/30 text-[#97d700]",
    accentEdge: "border-l-[#97d700]",
    accentText: "text-[#4a7500] dark:text-[#97d700]",
    accentFill: "bg-[#97d700]",
    accentHover: "hover:shadow-[#97d700]/20",
    icon: katshIcon,
    logo: katshLogo,
    logoOnDark: katshLogo,
    shape: "circle",
  },
  /** MTC: the "touch" teal (the mark i-Pick ships). */
  MTC: {
    name: "MTC",
    hex: "#009cbc",
    hoverHex: "#14b0d0",
    onHex: "#ffffff",
    solid: "bg-[#009cbc] text-white",
    button:
      "bg-[#009cbc] hover:bg-[#14b0d0] text-white shadow-lg shadow-[#009cbc]/20",
    text: "text-[#22b8d6]",
    tint: "bg-[#009cbc]/10",
    badge: "bg-[#009cbc]/10 text-[#22b8d6]",
    ring: "ring-[#009cbc]/30",
    glow: "shadow-[#009cbc]/10",
    border: "border-[#009cbc]/40",
    hoverBorder: "hover:border-[#009cbc]",
    focusBorder: "focus:border-[#009cbc]",
    focusRing: "focus:ring-[#009cbc]",
    searchFocus:
      "focus:ring-2 focus:ring-[#009cbc]/50 focus:border-[#009cbc]/50",
    selected: "border-[#009cbc]/40 ring-1 ring-[#009cbc]/30",
    selectedStrong: "ring-2 ring-[#009cbc]/50",
    stepper: "bg-[#009cbc]/20 hover:bg-[#009cbc]/30 text-[#22b8d6]",
    accentEdge: "border-l-[#009cbc]",
    accentText: "text-[#00718a] dark:text-[#22b8d6]",
    accentFill: "bg-[#009cbc]",
    accentHover: "hover:shadow-[#009cbc]/20",
    icon: mtcLogo,
    logo: mtcLogo,
    logoOnDark: mtcLogo,
    shape: "rounded",
  },
  /** Alfa: its logo red. Text uses a lighter red so it reads on dark. */
  ALFA: {
    name: "Alfa",
    hex: "#e41e2d",
    hoverHex: "#f03341",
    onHex: "#ffffff",
    solid: "bg-[#e41e2d] text-white",
    button:
      "bg-[#e41e2d] hover:bg-[#f03341] text-white shadow-lg shadow-[#e41e2d]/20",
    text: "text-[#ff4b57]",
    tint: "bg-[#e41e2d]/10",
    badge: "bg-[#e41e2d]/10 text-[#ff4b57]",
    ring: "ring-[#e41e2d]/30",
    glow: "shadow-[#e41e2d]/10",
    border: "border-[#e41e2d]/40",
    hoverBorder: "hover:border-[#e41e2d]",
    focusBorder: "focus:border-[#e41e2d]",
    focusRing: "focus:ring-[#e41e2d]",
    searchFocus:
      "focus:ring-2 focus:ring-[#e41e2d]/50 focus:border-[#e41e2d]/50",
    selected: "border-[#e41e2d]/40 ring-1 ring-[#e41e2d]/30",
    selectedStrong: "ring-2 ring-[#e41e2d]/50",
    stepper: "bg-[#e41e2d]/20 hover:bg-[#e41e2d]/30 text-[#ff4b57]",
    accentEdge: "border-l-[#e41e2d]",
    accentText: "text-[#c4111f] dark:text-[#ff4b57]",
    accentFill: "bg-[#e41e2d]",
    accentHover: "hover:shadow-[#e41e2d]/20",
    icon: alfaLogo,
    logo: alfaLogo,
    logoOnDark: alfaLogo,
    shape: "rounded",
  },
  /** Binance: its yellow with near-black labels, as on Binance's buttons. */
  BINANCE: {
    name: "Binance",
    hex: "#f0b90b",
    hoverHex: "#f8c934",
    onHex: "#0b0e11",
    solid: "bg-[#f0b90b] text-[#0b0e11]",
    button:
      "bg-[#f0b90b] hover:bg-[#f8c934] text-[#0b0e11] shadow-lg shadow-[#f0b90b]/20",
    text: "text-[#f0b90b]",
    tint: "bg-[#f0b90b]/10",
    badge: "bg-[#f0b90b]/10 text-[#f0b90b]",
    ring: "ring-[#f0b90b]/30",
    glow: "shadow-[#f0b90b]/10",
    border: "border-[#f0b90b]/40",
    hoverBorder: "hover:border-[#f0b90b]",
    focusBorder: "focus:border-[#f0b90b]",
    focusRing: "focus:ring-[#f0b90b]",
    searchFocus:
      "focus:ring-2 focus:ring-[#f0b90b]/50 focus:border-[#f0b90b]/50",
    selected: "border-[#f0b90b]/40 ring-1 ring-[#f0b90b]/30",
    selectedStrong: "ring-2 ring-[#f0b90b]/50",
    stepper: "bg-[#f0b90b]/20 hover:bg-[#f0b90b]/30 text-[#f0b90b]",
    accentEdge: "border-l-[#f0b90b]",
    accentText: "text-[#8a6600] dark:text-[#f0b90b]",
    accentFill: "bg-[#f0b90b]",
    accentHover: "hover:shadow-[#f0b90b]/20",
    icon: binanceIcon,
    logo: binanceMark,
    logoOnDark: binanceMark,
    shape: "circle",
  },
};

/** Code prefix → brand, checked in order (case-insensitive). */
const BRAND_PREFIXES: ReadonlyArray<readonly [string, ProviderBrandKey]> = [
  ["WHISH", "WHISH"],
  ["OMT", "OMT"],
  ["IPICK", "IPICK"],
  ["KATSH", "KATSH"],
  ["MTC", "MTC"],
  ["ALFA", "ALFA"],
  ["BINANCE", "BINANCE"],
];

/**
 * Which brand a provider / drawer / payment-method code belongs to, if any.
 * Accepts the codes the app already uses (case-insensitive): drawers
 * `OMT_App`, `OMT_System`, `Whish_App`, `Whish_System`, `iPick`, `Katsh`,
 * `MTC`, `Alfa`, `Binance`; payment methods `OMT`, `WHISH`, `BINANCE`,
 * `OMT_WALLET`, …. `General`, `CASH`, a currency such as `USDT` and anything
 * else stay unbranded (`null`).
 */
export function brandOf(
  code: string | null | undefined,
): ProviderBrandKey | null {
  const c = (code ?? "").trim().toUpperCase();
  if (!c) return null;
  for (const [prefix, brand] of BRAND_PREFIXES) {
    if (c.startsWith(prefix)) return brand;
  }
  return null;
}

/** Kept as an alias: every provider brand has a logo. */
export type ProviderLogoKey = ProviderBrandKey;
