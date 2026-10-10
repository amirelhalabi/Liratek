/**
 * Colours copied from the web app's CSS variables (frontend/src/index.css,
 * :root for light and html.dark for dark). The web paints plain Tailwind
 * classes (slate-*, violet-*) from these variables, so these ARE the web
 * colours. Keep the two in step when the web palette changes.
 */
export interface Palette {
  page: string; // --s-950 (bg-slate-950)
  section: string; // --s-900
  card: string; // --s-800
  raised: string; // --s-700 (inputs)
  border: string; // --b-700
  borderStrong: string; // --b-600
  text: string; // --t-white
  textSoft: string; // --t-300
  textMuted: string; // --t-400
  placeholder: string; // --t-600
  accent: string; // --a-500
  accentFill: string; // --a-fill (filled buttons)
  accentLabel: string; // --a-label (text on a filled button)
  accentSoft: string; // --a-400
  gradientFrom: string; // header / primary button gradient start (violet-600 → accent)
  gradientTo: string; // gradient end (indigo-600 → accent deep)
  danger: string;
  dangerSoft: string;
  success: string;
  link: string; // web links use text-orange-500
}

export const dark: Palette = {
  page: "#020222",
  section: "#050938",
  card: "#0c134f",
  raised: "#1a2761",
  border: "#25336a",
  borderStrong: "#3e4d7d",
  text: "#ffffff",
  textSoft: "#bfc7dc",
  textMuted: "#99a4c2",
  placeholder: "#667398",
  accent: "#d4adfc",
  accentFill: "#d4adfc",
  accentLabel: "#0c134f",
  accentSoft: "#dfc3ff",
  gradientFrom: "#d4adfc",
  gradientTo: "#b18bd7",
  danger: "#f87171",
  dangerSoft: "rgba(239, 68, 68, 0.15)",
  success: "#34d399",
  link: "#f97316",
};

export const light: Palette = {
  page: "#f8f7f4",
  section: "#f0efeb",
  card: "#ffffff",
  raised: "#e4e2db",
  border: "#e4e2db",
  borderStrong: "#d4d1c9",
  text: "#292823",
  textSoft: "#59574f",
  textMuted: "#77746b",
  placeholder: "#a19e95",
  accent: "#0057ff",
  accentFill: "#003edd",
  accentLabel: "#ffffff",
  accentSoft: "#518cff",
  gradientFrom: "#0057ff",
  gradientTo: "#0020c4",
  danger: "#dc2626",
  dangerSoft: "rgba(220, 38, 38, 0.10)",
  success: "#059669",
  link: "#f97316",
};

/** Web radius conventions: inputs/buttons rounded-lg, cards rounded-xl, sign-in card rounded-2xl. */
export const radius = { lg: 8, xl: 12, xxl: 16 } as const;
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 32 } as const;
