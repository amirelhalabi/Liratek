import type { TFunction } from "i18next";

/**
 * LIRA-331: maintenance status CODES ("In_Progress", "Delivered_Paid") are
 * stored and compared as-is; only their label is translated, here, at render
 * time. "All" is the jobs list's own tab, not a stored status.
 */
const STATUS_CODES = [
  "All",
  "Received",
  "In_Progress",
  "Ready",
  "Delivered",
  "Delivered_Paid",
] as const;

type StatusCode = (typeof STATUS_CODES)[number];

function isStatusCode(code: string): code is StatusCode {
  return (STATUS_CODES as readonly string[]).includes(code);
}

/** The display label of a status code; an unknown code is shown as-is. */
export function statusLabel(
  code: string,
  t: TFunction<"maintenance">,
): string {
  if (isStatusCode(code)) return t(`status.${code}`);
  return code.replace("_", " ");
}
