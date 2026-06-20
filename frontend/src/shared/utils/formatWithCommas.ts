/**
 * Thousand-separator helpers for amount text inputs.
 *
 * The canonical implementation now lives in `@liratek/ui` (utils/number.ts) and
 * backs the shared `DecimalInput` component. This module re-exports it so the
 * historical `@/shared/utils/formatWithCommas` import path keeps working for any
 * non-component caller and there is a single source of truth (CLAUDE.md rule #14).
 *
 * Prefer importing `DecimalInput` from `@liratek/ui` for new amount fields.
 */
export {
  formatWithCommas,
  isPartialDecimal,
  parseDecimal,
  sanitizeDecimal,
} from "@liratek/ui";
