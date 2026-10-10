/**
 * LIRA-296 P3 (FR-015) — what a unit's serial is called in the UI and on
 * receipts. Browser-safe leaf (rule 29): no imports.
 *
 * The category's own `serial_label` wins. An old payload or a hand-built
 * schema without it falls back on the tracking flag: the phone categories
 * that were the only tracked ones before P3 keep saying "IMEI"; anything
 * else says "Serial".
 */
export const SERIAL_LABELS = ["IMEI", "Serial"] as const;
export type SerialLabel = (typeof SERIAL_LABELS)[number];

export const SERIAL_REQUIRED_MODES = ["BLOCK", "WARN"] as const;
export type SerialRequiredMode = (typeof SERIAL_REQUIRED_MODES)[number];

export function serialLabelFor(
  category:
    | {
        serial_label?: string | null | undefined;
        tracks_imei_units?: number | boolean | null | undefined;
      }
    | null
    | undefined,
): SerialLabel {
  const label = category?.serial_label;
  if (label === "IMEI" || label === "Serial") return label;
  return category?.tracks_imei_units ? "IMEI" : "Serial";
}
