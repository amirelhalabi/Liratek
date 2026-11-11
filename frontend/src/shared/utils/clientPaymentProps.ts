import type { MultiPaymentInputProps, PaymentLine } from "@liratek/ui";
// Deep import on purpose: page tests mock the "@liratek/ui" barrel with a
// hand-picked export list, and this rule must stay real under every mock.
import { canChargeToCustomerAccount } from "@liratek/ui/utils/customerAccount";

/**
 * LIRA-387 (owner 2026-11-11: "keep it consistent in all the payment rows")
 * — the client rules of a payment box, derived ONCE for every money window
 * (rules 14 / 22). Each window used to write its own `hasClient` /
 * `autoDebtRemainder` / `requiresClientForDebt` / `unreturnedChangeTo`, and
 * they drifted: a red "Client is required" with a client picked (vouchers),
 * no warning and then a refusal for a new client (custom services), a
 * payout to a new receiver's account refused (OMT/Whish receive).
 *
 * The rule, everywhere: a customer can be charged (or credited) on account
 * when a client was PICKED, or when a name AND a phone are typed (the page or
 * the server registers that new client on Confirm).
 *
 * Mirrors the recharge windows' `paymentSheetClientProps`
 * (features/recharge/utils/paymentSheetClient.ts). TODO(LIRA-387 follow-up):
 * once the recharge work settles, make that one a thin call to this builder.
 */

/** "sale": the customer pays the shop. "payout": the shop pays the customer. */
export type ClientPaymentFlow = "sale" | "payout";

export interface ClientPaymentInput {
  /** A client picked from the search (null when typed or none). */
  clientId: number | null;
  /** The typed / picked name and phone. */
  name: string;
  phone: string;
  flow: ClientPaymentFlow;
  /** The box's current lines. A payout needs a client only for an account
   *  line (the shop credits the customer's account). */
  paymentLines: readonly PaymentLine[];
  /** Inside a customer session the basket checkout owns the change. */
  inSession: boolean;
  /** The server books change left with the customer as account credit (an
   *  OUT CUSTOMER_ACCOUNT leg). False where the server refuses it — a voucher
   *  sale (VoucherRepository.sellVoucher). */
  changeToAccount: boolean;
}

/** The client-related props of a `MultiPaymentInput`. */
export type ClientPaymentProps = Pick<
  MultiPaymentInputProps,
  "hasClient" | "requiresClientForDebt" | "autoDebtRemainder"
> &
  Partial<Pick<MultiPaymentInputProps, "unreturnedChangeTo">>;

/** A picked client, or a typed name + phone that can register one. */
export function hasResolvableClient(
  i: Pick<ClientPaymentInput, "clientId" | "name" | "phone">,
): boolean {
  return (
    !!i.clientId || canChargeToCustomerAccount({ name: i.name, phone: i.phone })
  );
}

const isAccountLine = (l: Pick<PaymentLine, "method">) =>
  l.method === "CUSTOMER_ACCOUNT";

/**
 * - `hasClient`: a picked client OR a typed name + phone.
 * - sale: a client is always needed for an account line, a shortfall goes on
 *   the account (`autoDebtRemainder`), and change not handed back can go to
 *   the account (outside a session, where the server books it).
 * - payout: never an automatic debt (it would flip the sign of the unpaid
 *   remainder), no change legs, and a client is needed only once an account
 *   line exists.
 */
export function clientPaymentProps(i: ClientPaymentInput): ClientPaymentProps {
  const hasClient = hasResolvableClient(i);
  const payout = i.flow === "payout";
  return {
    hasClient,
    requiresClientForDebt: payout ? i.paymentLines.some(isAccountLine) : true,
    autoDebtRemainder: payout ? false : hasClient,
    ...(!payout && i.changeToAccount && !i.inSession && hasClient
      ? { unreturnedChangeTo: "CUSTOMER_ACCOUNT" as const }
      : {}),
  };
}

/**
 * The method the payment box switches to when a client is picked: Customer
 * Account, when the shop offers it and the picked client can be charged
 * (name + phone). Undefined = leave the operator's method alone. ONE rule for
 * every window's "pick a client" handler.
 */
export function accountMethodOnPick(p: {
  methods: readonly { code: string }[];
  name: string | null | undefined;
  phone: string | null | undefined;
}): "CUSTOMER_ACCOUNT" | undefined {
  const offered = p.methods.some((m) => m.code === "CUSTOMER_ACCOUNT");
  return offered &&
    canChargeToCustomerAccount({ name: p.name, phone: p.phone })
    ? "CUSTOMER_ACCOUNT"
    : undefined;
}
