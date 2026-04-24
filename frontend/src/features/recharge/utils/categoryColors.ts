/**
 * Category-based color coding for service item cards.
 *
 * Returns a Tailwind border-left color class based on the top-level category.
 * Used in KatchForm and FinancialForm card grids.
 */

const CATEGORY_COLORS: Record<string, string> = {
  alfa: "#ef4444", // red-500
  mtc: "#06b6d4", // cyan-500
  internet: "#22c55e", // green-500
  Gaming: "#a855f7", // purple-500
};

// Deterministic fallback palette for unknown categories
const FALLBACK_PALETTE = [
  "#f59e0b", // amber-500
  "#ec4899", // pink-500
  "#14b8a6", // teal-500
  "#6366f1", // indigo-500
  "#f97316", // orange-500
  "#84cc16", // lime-500
];

/**
 * Get the accent color hex for a given category.
 * Known categories get a fixed color; unknown ones get a stable fallback.
 */
export function getCategoryColor(category: string): string {
  if (CATEGORY_COLORS[category]) return CATEGORY_COLORS[category];

  // Case-insensitive match
  const lower = category.toLowerCase();
  for (const [key, color] of Object.entries(CATEGORY_COLORS)) {
    if (key.toLowerCase() === lower) return color;
  }

  // Deterministic fallback based on string hash
  let hash = 0;
  for (let i = 0; i < category.length; i++) {
    hash = (hash * 31 + category.charCodeAt(i)) | 0;
  }
  return FALLBACK_PALETTE[Math.abs(hash) % FALLBACK_PALETTE.length];
}
