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
