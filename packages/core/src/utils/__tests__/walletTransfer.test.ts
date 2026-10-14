import { createFinancialServiceSchema } from "../../validators/financial";
import { buildWalletTransferPayload, calculateOmtWhishAppFees } from "../walletTransfer";

const fees = (provider: "WHISH_APP" | "OMT_APP", serviceType: "SEND" | "RECEIVE", fee = "") =>
  calculateOmtWhishAppFees({ activeProvider: provider, serviceType, currency: "USD", parsedAmount: 50, manualFee: fee, includingFees: false });

describe("buildWalletTransferPayload", () => {
  it("builds a SEND the schema accepts, with the provider's fee field and the customer-owed total", () => {
    const f = fees("OMT_APP", "SEND", "2");
    const body = buildWalletTransferPayload({
      provider: "OMT_APP", serviceType: "SEND", currency: "USD", fees: f, includingFees: false,
      client: { id: 3, name: "Hassan", phone: "70111222" }, paidByMethod: "CUSTOMER_ACCOUNT",
      payments: [{ method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: f.customerPays }], tenderExchangeRate: 89500,
    });
    const parsed = createFinancialServiceSchema.parse(body);
    expect(parsed).toMatchObject({ provider: "OMT_APP", serviceType: "SEND", amount: 50, omtFee: 2, clientId: 3, paidByMethod: "CUSTOMER_ACCOUNT" });
    expect(body.checkoutTotal).toEqual({ usd: 52, lbp: 0 });
    expect(body.tender_exchange_rate).toBe(89500);
    expect("whishFee" in body).toBe(false);
  });

  it("omits checkoutTotal and the rate when no payment legs were taken", () => {
    const body = buildWalletTransferPayload({
      provider: "WHISH_APP", serviceType: "SEND", currency: "USD", fees: fees("WHISH_APP", "SEND"), includingFees: false,
      client: { name: "Walk-in", phone: "" }, paidByMethod: "CASH", tenderExchangeRate: 89500,
    });
    expect("checkoutTotal" in body).toBe(false);
    expect("tender_exchange_rate" in body).toBe(false);
    expect(body.clientId).toBeUndefined();
  });

  it("sends cashoutMethod only on a RECEIVE, and kept change only when non-zero", () => {
    const send = buildWalletTransferPayload({
      provider: "WHISH_APP", serviceType: "SEND", currency: "USD", fees: fees("WHISH_APP", "SEND"), includingFees: false,
      client: { name: "A", phone: "1" }, paidByMethod: "CASH", cashoutMethod: "WHISH", keptChange: { usd: 0, lbp: 0 },
    });
    expect("cashoutMethod" in send).toBe(false);
    expect("kept_change_usd" in send).toBe(false);
    const receive = buildWalletTransferPayload({
      provider: "WHISH_APP", serviceType: "RECEIVE", currency: "USD", fees: fees("WHISH_APP", "RECEIVE"), includingFees: false,
      client: { name: "A", phone: "1" }, paidByMethod: "CASH", cashoutMethod: "WHISH", keptChange: { usd: 0.5, lbp: 0 },
    });
    expect(receive.cashoutMethod).toBe("WHISH");
    expect(receive.kept_change_usd).toBe(0.5);
  });
});

// LIRA-321 (T038): on a Whish App / OMT App RECEIVE the customer's side
// travels as `customerPayments` (the transfer line + the fee line when the
// fee is paid over the counter), never as `feePayments`.
describe("buildWalletTransferPayload — customerPayments (LIRA-321)", () => {
  const receiveFees = (provider: "WHISH_APP" | "OMT_APP", fee: string, separate: boolean) =>
    calculateOmtWhishAppFees({
      activeProvider: provider, serviceType: "RECEIVE", currency: "USD", parsedAmount: 100,
      manualFee: fee, includingFees: false, feeCollectedSeparately: separate,
    });

  it("Whish App, fee paid separately: sends customerPayments + feeCollectedSeparately, no feePayments, and the schema accepts it", () => {
    const f = receiveFees("WHISH_APP", "5", true);
    const body = buildWalletTransferPayload({
      provider: "WHISH_APP", serviceType: "RECEIVE", currency: "USD", fees: f, includingFees: false,
      client: { id: 7, name: "Rami", phone: "70123456" }, paidByMethod: "CASH",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }], cashoutMethod: "CASH",
      feePayments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
      customerPayments: [
        { method: "WHISH", currencyCode: "USD", amount: 90 },
        { method: "CASH", currencyCode: "USD", amount: 5 },
        { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 10 },
      ],
      feeCollectedSeparately: true,
    });
    const parsed = createFinancialServiceSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(body.customerPayments).toHaveLength(3);
    expect(body.feeCollectedSeparately).toBe(true);
    expect("feePayments" in body).toBe(false);
    expect("customer_waived_amount" in body).toBe(false);
    // The lines add up to what the server expects: transfer + fee.
    const sum = (body.customerPayments ?? []).reduce((s, l) => s + l.amount, 0);
    expect(sum).toBeCloseTo((body.amount as number) + (body.commission as number), 6);
  });

  it("OMT App: transfer only, a forgiven part rides customer_waived_amount, no feeCollectedSeparately", () => {
    const f = receiveFees("OMT_APP", "", false);
    const body = buildWalletTransferPayload({
      provider: "OMT_APP", serviceType: "RECEIVE", currency: "USD", fees: f, includingFees: false,
      client: { name: "", phone: "" }, paidByMethod: "CASH", cashoutMethod: "CASH",
      customerPayments: [{ method: "OMT", currencyCode: "USD", amount: 98 }],
      customerWaivedAmount: 2,
    });
    expect(createFinancialServiceSchema.safeParse(body).success).toBe(true);
    expect(body.customerPayments).toEqual([{ method: "OMT", currencyCode: "USD", amount: 98 }]);
    expect(body.customer_waived_amount).toBe(2);
    expect("feeCollectedSeparately" in body).toBe(false);
  });

  it("never sends customerPayments on a SEND, nor an empty list", () => {
    const send = buildWalletTransferPayload({
      provider: "WHISH_APP", serviceType: "SEND", currency: "USD", fees: fees("WHISH_APP", "SEND"), includingFees: false,
      client: { name: "A", phone: "1" }, paidByMethod: "CASH",
      customerPayments: [{ method: "WHISH", currencyCode: "USD", amount: 50 }],
    });
    expect("customerPayments" in send).toBe(false);
    const empty = buildWalletTransferPayload({
      provider: "WHISH_APP", serviceType: "RECEIVE", currency: "USD", fees: receiveFees("WHISH_APP", "", false), includingFees: false,
      client: { name: "A", phone: "1" }, paidByMethod: "CASH", customerPayments: [],
    });
    expect("customerPayments" in empty).toBe(false);
  });
});

describe("buildWalletTransferPayload — customerPayments in the other fee modes (LIRA-321)", () => {
  const base = { provider: "WHISH_APP" as const, serviceType: "RECEIVE" as const, currency: "USD" as const, client: { name: "A", phone: "1" }, paidByMethod: "CASH", cashoutMethod: "CASH" as const };

  it("fee added to the transfer (Sender): one Whish line for transfer + fee, no fee flag", () => {
    const f = calculateOmtWhishAppFees({ activeProvider: "WHISH_APP", serviceType: "RECEIVE", currency: "USD", parsedAmount: 100, manualFee: "5", includingFees: false });
    const body = buildWalletTransferPayload({ ...base, fees: f, includingFees: false,
      customerPayments: [{ method: "WHISH", currencyCode: "USD", amount: f.walletAmount }] });
    expect(createFinancialServiceSchema.safeParse(body).success).toBe(true);
    expect(body.amount).toBe(105);
    expect(body.customerPayments).toEqual([{ method: "WHISH", currencyCode: "USD", amount: 105 }]);
    expect("feeCollectedSeparately" in body).toBe(false);
  });

  it("fee deducted from the payout: one Whish line for the transfer, includingFees, no fee flag", () => {
    const f = calculateOmtWhishAppFees({ activeProvider: "WHISH_APP", serviceType: "RECEIVE", currency: "USD", parsedAmount: 100, manualFee: "5", includingFees: true });
    const body = buildWalletTransferPayload({ ...base, fees: f, includingFees: true,
      customerPayments: [{ method: "WHISH", currencyCode: "USD", amount: f.walletAmount }] });
    expect(createFinancialServiceSchema.safeParse(body).success).toBe(true);
    expect(body.amount).toBe(100);
    expect(body.includingFees).toBe(true);
    expect("feeCollectedSeparately" in body).toBe(false);
  });
});
