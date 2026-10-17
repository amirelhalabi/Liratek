/**
 * LIRA-333 — the ONE receipt description of a saved POS sale (FR-006,
 * FR-007, research R1, data-model.md).
 *
 * Built only from the sale as saved (`getSale` + `getSaleItems`): its
 * receipt number, saved time, saved exchange rate and stamped warranty
 * dates. The paper reprint (sale details), the post-sale strip's Print, and
 * the WhatsApp message all render from this, so the same sale always gives
 * the same figures, right after the sale and later (SC-003).
 *
 * The figures come from the read fields that never change after the sale —
 * `tender_*`, `gift_card_usd`, `on_account_usd` — never from `paid_*`, which
 * a later debt repayment raises (research R2).
 */
import { EXCHANGE_RATE } from "@liratek/ui";
import { receiptNumberFor } from "@liratek/core";
import type { ShopInfo } from "@/hooks/useShopName";
import type {
  SaleDetail,
  SaleDetailItem,
} from "@/features/sales/types/saleDetail";
import type { ReceiptData } from "./receiptFormatter";

export type ReceiptShopInfo = Pick<
  ShopInfo,
  "name" | "phone" | "location" | "headerText" | "warrantyTerms"
>;

const num = (v: number | null | undefined): number => Number(v ?? 0) || 0;

export function buildSaleReceiptData(
  sale: SaleDetail,
  items: SaleDetailItem[],
  shop: ReceiptShopInfo,
): ReceiptData {
  const extra = Math.max(0, num(sale.extra_usd));
  return {
    shop_name: shop.name,
    shop_phone: shop.phone,
    shop_location: shop.location,
    // LIRA-296: the saved header (SF-3) and the warranty terms.
    header_text: shop.headerText ?? "",
    warranty_terms: shop.warrantyTerms ?? "",
    receipt_number: receiptNumberFor(sale.id),
    timestamp: sale.created_at,
    client_name: sale.client_name || "Walk-in Customer",
    client_phone: recipientPhoneFor(sale) ?? "",
    items: items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      price: item.sold_price_usd,
      subtotal: item.sold_price_usd * item.quantity,
      imei: item.imei || null,
      serial_label: item.serial_label ?? null,
      // LIRA-143 phase 6a — the EXACT value stamped at sale time.
      warranty_until: item.warranty_until || null,
    })),
    subtotal: sale.total_amount_usd,
    discount: sale.discount_usd,
    // LIRA-319: "Extra +$X"; the total includes it.
    extra,
    total: sale.final_amount_usd + extra,
    payment_usd: num(sale.tender_usd),
    payment_lbp: num(sale.tender_lbp),
    gift_card_usd: num(sale.gift_card_usd),
    // POS debt is booked in USD, so the saved receipt shows the account
    // part in USD even when it was taken in LBP at checkout (research R3).
    on_account_usd: num(sale.on_account_usd),
    on_account_lbp: 0,
    change_usd: num(sale.change_given_usd),
    change_lbp: num(sale.change_given_lbp),
    exchange_rate: sale.exchange_rate_snapshot || EXCHANGE_RATE,
  };
}

/** FR-012: the phone saved with the sale, else the linked client's phone,
 *  else null (the cashier types one for this send only). Never the display
 *  `client_phone`, and never whatever client is selected elsewhere. */
export function recipientPhoneFor(
  sale: Pick<SaleDetail, "sale_phone" | "linked_client_phone">,
): string | null {
  return sale.sale_phone?.trim() || sale.linked_client_phone?.trim() || null;
}
