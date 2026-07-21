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

  // Electron (no printer configured, or silent print unavailable): delegate
  // to the main process, same recipe as silentPrint but with the native
  // dialog shown. A renderer-side `window.open("data:...")` popup can't do
  // this reliably in Electron — Chromium blocks script-initiated top-frame
  // navigation to data: URLs (anti-phishing restriction since Chrome 61),
  // and `window.open("") + document.write()` into the resulting about:blank
  // hits a separate Electron bug (electron/electron#24356) where the
  // paint/`ready-to-show` step never fires for a small amount of injected
  // content — either way the popup stays blank. The main process's own
  // loadURL() is a privileged navigation exempt from both.
  if (window.api?.print?.printWithDialog) {
    const result = await window.api.print.printWithDialog(fullHtml);
    if (!result?.success && result?.error) {
      logger.error(`Receipt print-with-dialog failed: ${result.error}`);
      appEvents.emit(
        "notification:show",
        "Receipt printing failed: " + result.error,
        "error",
      );
    }
    // Windows focus fix: closing the (now main-process-owned) print window
    // can leave focus on the wrong window.
    setTimeout(() => window.api?.display?.fixFocus?.(), 100);
    return;
  }

  // Web-mode fallback (no Electron bridge): plain print window. Unlike
  // Electron, `window.print()` blocks here until the browser's own print
  // preview/dialog is dismissed, so the immediate close afterward is safe.
  const printWindow = window.open("", "", "width=400,height=600");
  if (printWindow) {
    printWindow.document.write(fullHtml);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    printWindow.close();
  }
}
