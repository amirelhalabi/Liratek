/**
 * LIRA-333 — print a saved sale's receipt. ONE path for the sale details
 * window's Print and the post-sale strip's Print (rule 14): the paper text
 * comes from `formatReceipt58mm` over the one receipt description, and the
 * shop's chosen receipt printer is read the same way both times.
 */
import type { ApiAdapter } from "@liratek/ui";
import { printReceipt } from "@/shared/utils/printReceipt";
import { formatReceipt58mm, type ReceiptData } from "./receiptFormatter";

export async function printSaleReceipt(
  api: Pick<ApiAdapter, "getAllSettings">,
  data: ReceiptData,
  logo: string,
): Promise<void> {
  let targetPrinter = "";
  try {
    const settings = (await api.getAllSettings()) as Array<{
      key_name?: string;
      value?: string;
    }>;
    const printerSetting = settings?.find(
      (s) => s.key_name === "receipt_printer",
    );
    if (printerSetting?.value) targetPrinter = printerSetting.value;
  } catch {
    // ignore — fall through to the print popup
  }

  await printReceipt({
    text: formatReceipt58mm(data),
    logo,
    printer: targetPrinter,
  });
}
