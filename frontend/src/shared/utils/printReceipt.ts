/**
 * Shared receipt print path (RCP-0, docs/plans/done_plans/RECEIPTS_PLAN.md).
 *
 * ONE place every module prints through, so the logo, CSS, and
 * silent-vs-fallback logic stay identical across POS, services, recharge,
 * maintenance, custom services and loto. Extracted verbatim from the
 * POS CheckoutModal's inline printer, plus the logo <img> injection.
 *
 * The receipt body is monospace TEXT from receiptFormatter (58/80mm); the
 * logo is presentation — an <img> above the <pre>, never part of the text.
 */

import logger from "@/utils/logger";
import { appEvents } from "@liratek/ui";

const RECEIPT_PRINT_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 80mm; margin: 0 auto; }
  .receipt-logo { display: block; margin: 0 auto 6px; max-width: 70%; max-height: 120px; object-fit: contain; }
  pre { font-family: 'Courier New', monospace; font-size: 11px; font-weight: bold; white-space: pre-wrap; word-break: break-all; line-height: 1.4; }
  @media print {
    @page { size: 80mm auto; margin: 0; }
    html, body { width: 80mm; margin: 0; padding: 0; }
  }`;

export interface PrintReceiptOptions {
  /** The monospace receipt body (from formatReceipt58mm/80mm). */
  text: string;
  /** Optional logo data URL — rendered as an <img> above the text. */
  logo?: string;
  /** Silent target printer; when set (Electron), prints without a dialog. */
  printer?: string;
}

/** Build the full receipt HTML document (exported for unit testing). */
export function buildReceiptHtml(text: string, logo?: string): string {
  const logoImg =
    logo && logo.trim()
      ? `<img class="receipt-logo" src="${logo}" alt="" />`
      : "";
  return `<!DOCTYPE html>
<html>
<head><title>Receipt</title><style>${RECEIPT_PRINT_CSS}</style></head>
<body>${logoImg}<pre>${text}</pre></body>
</html>`;
}

/**
 * Print a receipt. Uses Electron silent print when a target printer is given
 * and available; otherwise opens a print-window (also the web-mode path).
 */
export async function printReceipt({
  text,
  logo,
  printer,
}: PrintReceiptOptions): Promise<void> {
  const fullHtml = buildReceiptHtml(text, logo);

  if (printer && window.api?.print?.silentPrint) {
    logger.info(`Sending receipt to silent printer: ${printer}`);
    const result = await window.api.print.silentPrint(fullHtml, printer);
    if (!result?.success) {
      logger.error(`Silent receipt print failed: ${result?.error}`);
      appEvents.emit(
        "notification:show",
        "Receipt printing failed: " + (result?.error || "Unknown error"),
        "error",
      );
    }
    return;
  }

  // E2E capture hook: when a spec installs __LIRATEK_E2E_PRINT_STUB__, hand
  // it the HTML instead of printing (lets specs assert WHAT would print).
  const w = window as unknown as {
    __LIRATEK_E2E_PRINT_STUB__?: (html: string) => void;
  };
  if (typeof w.__LIRATEK_E2E_PRINT_STUB__ === "function") {
    w.__LIRATEK_E2E_PRINT_STUB__(fullHtml);
    return;
  }

  // Under automation (Playwright/e2e), `printWindow.print()` raises the
  // NATIVE print dialog, which blocks worker teardown and poisoned whole e2e
  // workers when auto-print (LIRA-069) started firing on every module submit
  // (found 2026-07-19: "Worker teardown timeout of 90000ms exceeded" across
  // recharge/lira-095/lira-124). Same NODE_ENV=test discipline as main.ts's
  // openDevTools/auto-backup gates, detected renderer-side via
  // navigator.webdriver (set by the automation harness).
  if (navigator.webdriver) {
    logger.info("Automation detected — skipping native print dialog");
    return;
  }

  // Fallback (no silent printer configured, or web mode): print window.
  const printWindow = window.open("", "", "width=400,height=600");
  if (printWindow) {
    printWindow.document.write(fullHtml);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    printWindow.close();
    // Windows focus fix (Electron): restore focus to the app window.
    setTimeout(() => {
      (
        window as unknown as { api?: { display?: { fixFocus?: () => void } } }
      ).api?.display?.fixFocus?.();
    }, 100);
  }
}
