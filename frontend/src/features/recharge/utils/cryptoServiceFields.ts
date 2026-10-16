/**
 * Binance — the fields every Binance send / cash-out carries, whether it is
 * sent on its own or added to a customer session's basket. ONE builder for
 * both (rule 22): the session basket item used to build its own copy and
 * silently left out what the walk-in send had (bug #4: the "Set custom
 * time" chosen on a session item was dropped). Each path adds only what is
 * its own (the walk-in send: the payment lines; the basket: nothing — the
 * basket owns the payment). Field names come from the shared schema
 * (rule 21).
 */
import type { CreateFinancialServicePayload } from "@liratek/core";

type CryptoServiceFields = Pick<
  CreateFinancialServicePayload,
  | "provider"
  | "serviceType"
  | "amount"
  | "currency"
  | "clientId"
  | "clientName"
  | "referenceNumber"
  | "commission"
  | "feePaidBy"
  | "typedDiscount"
  | "transaction_time"
>;

export function buildCryptoServiceFields(input: {
  cryptoType: "SEND" | "RECEIVE";
  /** The gross USDT that moves (fee toggles already folded in). */
  amount: number;
  /** The fee after any cash-out discount (no discount inside a session). */
  commission: number;
  clientId: number | null | undefined;
  clientName: string;
  reference: string;
  detailFields: Pick<
    CreateFinancialServicePayload,
    "feePaidBy" | "typedDiscount"
  >;
  /** The "Set custom time" picked on the form (ISO); absent = now. */
  transactionTime?: string | undefined;
}): CryptoServiceFields {
  return {
    provider: "BINANCE",
    serviceType: input.cryptoType,
    amount: input.amount,
    currency: "USDT",
    clientId: input.clientId || undefined,
    clientName: input.clientName,
    referenceNumber: input.reference,
    commission: input.commission,
    ...input.detailFields,
    ...(input.transactionTime
      ? { transaction_time: input.transactionTime }
      : {}),
  };
}
