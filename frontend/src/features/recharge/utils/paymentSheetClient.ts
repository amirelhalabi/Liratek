import type { PaymentLine } from "@liratek/ui";
import { clientPaymentProps } from "@/shared/utils/clientPaymentProps";
import type { PaymentSheetProps } from "../components/PaymentSheet";

/** The client-related props of a recharge payment window. */
export type PaymentSheetClientProps = Pick<
  PaymentSheetProps,
  | "hasClient"
  | "autoDebtRemainder"
  | "requiresClientForDebt"
  | "unreturnedChangeTo"
  | "paymentInputKey"
  | "initialPaymentMethod"
>;

export interface PaymentSheetClientInput {
  /** A client picked from the search. */
  clientId: number | null;
  /** The typed name and phone — together they register a new client. */
  name: string;
  phone: string;
  /** True when the shop pays the customer (credit buy-back, cash-out). */
  payout: boolean;
  /** The window's current lines (a payout needs a client only for an
   *  account line). */
  paymentLines: PaymentLine[];
  /** Inside a customer session the basket checkout owns the change. */
  inSession: boolean;
  /** The caller books change legs (`onReturnChange` is wired). */
  booksChange: boolean;
  paymentInputKey: number;
  initialPaymentMethod: string;
}

/**
 * The client rules of a recharge payment window (Credit/Days, Alfa Gift,
 * Binance). The rules themselves come from the app-wide builder
 * `clientPaymentProps` (rules 14/22) — a picked client OR a typed name +
 * phone counts as a client; a sale puts a shortfall on the account and may
 * keep change there; a payout never auto-debits and needs a client only for
 * an account line. This adds only the window's remount key and the method it
 * opens on (switched to Customer Account when a client is picked).
 */
export function paymentSheetClientProps(
  i: PaymentSheetClientInput,
): PaymentSheetClientProps {
  return {
    ...clientPaymentProps({
      clientId: i.clientId,
      name: i.name,
      phone: i.phone,
      flow: i.payout ? "payout" : "sale",
      paymentLines: i.paymentLines,
      inSession: i.inSession,
      changeToAccount: i.booksChange,
    }),
    paymentInputKey: i.paymentInputKey,
    initialPaymentMethod: i.initialPaymentMethod,
  };
}
