/**
 * The OMT / Whish / wallet / iPick / Katsh transaction's summary line and its
 * "primary party" (the customer the row is about) — ONE definition used by
 * the create path (FinancialServiceRepository.createTransaction) AND the
 * History edit (FinancialServiceRepository.updateMetadata), so an edited
 * sender/receiver name is written back exactly as a new row would show it
 * (rules 14 and 31: the edit path is the update owner of the copies).
 *
 * Pure: every input is either the create request or the persisted
 * `financial_services` row.
 */
import { formatMoneyAmount } from "./formatMoney.js";

/**
 * Operator-facing provider label for item/bill summaries and Service Debt
 * notes — the raw "WHISH_APP"/"OMT_APP" enums read like codes next to
 * iPick/Katsh. Transfer summaries and ledger matching keep the raw enum
 * (e2e specs and existing rows match on "WHISH_APP SEND: …").
 */
export function providerDisplayLabel(provider: string): string {
  switch (provider) {
    case "WHISH_APP":
      return "Whish App";
    case "OMT_APP":
      return "OMT App";
    default:
      return provider;
  }
}

/**
 * The customer the transaction row is about: the sender on a SEND, the
 * receiver on anything else, falling back to the generic client name/phone.
 * Blank strings fall through, exactly like the `||` chain the create path
 * always used.
 */
export function financialServicePrimaryParty(input: {
  serviceType: string;
  senderName?: string | null;
  senderPhone?: string | null;
  receiverName?: string | null;
  receiverPhone?: string | null;
  clientName?: string | null;
  phoneNumber?: string | null;
}): { name: string | undefined; phone: string | undefined } {
  const isSend = input.serviceType === "SEND";
  const name =
    (isSend ? input.senderName : input.receiverName) || input.clientName;
  const phone =
    (isSend ? input.senderPhone : input.receiverPhone) || input.phoneNumber;
  return { name: name || undefined, phone: phone || undefined };
}

export interface FinancialServiceSummaryInput {
  provider: string;
  serviceType: string;
  /** The transfer-only amount (`financial_services.amount`). */
  amount: number;
  currency: string;
  /** See {@link financialServicePrimaryParty}. */
  primaryName: string | undefined;
  /** The OMT/Whish provider fee (`omt_fee` / `whish_fee`); 0 otherwise. */
  providerFee: number;
  /** A cost/price row (catalog item / bill), not a transfer. */
  useCostPriceFlow: boolean;
  note: string | null | undefined;
  commission: number;
  paidAmount: number | null | undefined;
  paidCurrency: string | null | undefined;
}

export function buildFinancialServiceSummary(
  i: FinancialServiceSummaryInput,
): string {
  // iPick/Katsh: a catalog item purchase or bill payment, not a
  // sender/receiver transfer — surface the selected item(s)
  // (category + label, via `note`) or call out a bill payment
  // explicitly, instead of the generic provider+amount line below.
  const isKatshLike = i.provider === "iPick" || i.provider === "Katsh";
  // Wallet-provider catalog items (Whish App / OMT App grid sales)
  // are cost/price rows, not transfers — they get the same item-style
  // line. Real transfers never send cost > 0 (OmtWhishAppTransferForm),
  // so useCostPriceFlow cleanly separates the two; without this a
  // Whish App item sale read "WHISH_APP SEND: 150000 LBP (+30,383 LBP
  // fee)" — a transfer line whose "fee" was actually the item margin.
  const isItemSale = i.useCostPriceFlow && !!i.note;
  // Friendly provider label for the item/bill lines only; the generic
  // transfer line below keeps the raw enum (see providerDisplayLabel).
  const providerLabel = providerDisplayLabel(i.provider);
  // D1.1 (owner: "show the cash that crossed the counter"): a plain
  // OMT/WHISH SEND's summary spells out the split the gross row amount
  // folds together — e.g. "OMT SEND: <name> — $100 (95 transfer + 5 fee)".
  // `amount` is always the transfer-only portion in both fee modes, so the
  // breakdown needs no `includingFees` branch. Gated on a fee > 0 — a
  // zero-fee transfer keeps the plain line.
  const isPlainSystemSend =
    (i.provider === "OMT" || i.provider === "WHISH") &&
    i.serviceType === "SEND" &&
    !i.useCostPriceFlow;
  const genericTransferLine = (): string => {
    const namePrefix = i.primaryName ? `${i.primaryName} — ` : "";
    if (isPlainSystemSend && i.providerFee > 0) {
      return (
        `${i.provider} ${i.serviceType}: ${namePrefix}` +
        `${formatMoneyAmount(i.amount + i.providerFee, i.currency)} ` +
        `(${i.amount.toLocaleString()} transfer + ${i.providerFee.toLocaleString()} fee)`
      );
    }
    return `${i.provider} ${i.serviceType}: ${namePrefix}${i.amount} ${i.currency}`;
  };
  let head =
    isKatshLike && i.serviceType === "BILL"
      ? `${providerLabel} Bill: ${i.amount} ${i.currency}`
      : (isKatshLike || isItemSale) && i.note
        ? `${providerLabel}: ${i.note} — ${i.amount} ${i.currency}`
        : genericTransferLine();

  // Wallet transfers (Binance / OMT App / Whish App): the fee the shop
  // charges on top is the commission — surface it, otherwise the audit row
  // reads "20 USD" while the customer was charged 22 and the fee is
  // invisible anywhere in the table. Cost/price rows are excluded: there
  // the commission is the price − cost margin already inside the amount
  // the customer paid, not a fee on top.
  const isWalletProviderTransfer =
    i.provider === "BINANCE" ||
    i.provider === "OMT_APP" ||
    i.provider === "WHISH_APP";
  if (isWalletProviderTransfer && !i.useCostPriceFlow && i.commission > 0) {
    const fmtFee =
      i.currency === "LBP"
        ? `${Math.round(i.commission).toLocaleString()} LBP`
        : `$${i.commission}`;
    head += ` (+${fmtFee} fee)`;
  }

  // When the customer paid in a currency different from the
  // service-denominated currency, surface that on the audit row.
  if (i.paidCurrency && i.paidAmount != null && i.paidCurrency !== i.currency) {
    const fmtPaid =
      i.paidCurrency === "LBP"
        ? `${Math.round(i.paidAmount).toLocaleString()} LBP`
        : `$${i.paidAmount.toFixed(2)}`;
    return `${head} (paid ${fmtPaid})`;
  }
  return head;
}
