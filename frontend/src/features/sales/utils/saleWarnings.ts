/**
 * LIRA-296 P3 (FR-022) — a sale can go through with warnings, e.g. a
 * serial-tracked item in a WARN category sold without picking its unit.
 * Tell the cashier, one warning toast per line.
 */
import { appEvents } from "@liratek/ui";

export function emitSaleWarnings(result: {
  success?: boolean;
  warnings?: string[] | undefined;
}): void {
  for (const warning of result.warnings ?? []) {
    appEvents.emit("notification:show", warning, "warning");
  }
}
