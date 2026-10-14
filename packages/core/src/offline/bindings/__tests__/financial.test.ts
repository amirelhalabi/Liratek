/**
 * LIRA-306 T082 — financial services family: `omt:add-transaction` (lifted:
 * the desktop's hand-written `FinancialServiceSchema` → core
 * `createFinancialServiceSchema`), `financial:update-metadata`,
 * `financial:self-charge-telecom-item`, `wallet-exchange:create`. Replayed
 * through the ReplayEngine each books what the REST route's service call
 * books online (drawers, payment lines, transactions, line credits per
 * currency — SC-001), at the event's own time (FR-021), with the route's
 * schema object.
 *
 * Three-way key diff for the `omt:add-transaction` lift (rule 23), taken
 * from the source on 2026-10-11 before the lift:
 *   (a) core `createFinancialServiceSchema` — 46 keys;
 *   (b) preload `omt.addTransaction(data)` type — the same 46 keys;
 *   (c) the handler forwards `...v.data` + `userId` from the session;
 *   the hand-written desktop schema had 47 keys: the 46 plus `userId`, which
 *   the handler always overwrote from `requireRole` — so no key the handler
 *   uses disappears. Field constraints differ (core is stricter: e.g.
 *   `payments[].amount` positive, `cashoutMethod` enum default "CASH",
 *   `currency` default "USD"): after the lift the desktop validates exactly
 *   like the web route, which the same frontend forms already satisfy.
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../../db/tenantContext";
import {
  createFinancialServiceSchema,
  financialUpdateMetadataSchema,
  selfChargeTelecomItemSchema,
} from "../../../validators/financial";
import { createWalletExchangeSchema } from "../../../validators/walletExchange";
import { recordedSchema, PENDING_LIFT } from "../../channelPolicy";
import { getFinancialService, resetFinancialService } from "../../../services/FinancialService";
import { getWalletExchangeService, resetWalletExchangeService } from "../../../services/WalletExchangeService";
import { resetFinancialServiceRepository } from "../../../repositories/FinancialServiceRepository";
import { resetTransactionRepository } from "../../../repositories/TransactionRepository";
import { resetCarrierLineRepository } from "../../../repositories/CarrierLineRepository";
import { resetCarrierLineMovementRepository } from "../../../repositories/CarrierLineMovementRepository";
import { FINANCIAL_BINDINGS } from "../financial";
import { bindingLookup, runParity, tableState, type ParityCase } from "../../testHelpers/familyHarness";

const bindings = bindingLookup(FINANCIAL_BINDINGS);

function reset(): void {
  resetFinancialService();
  resetWalletExchangeService();
  resetFinancialServiceRepository();
  resetTransactionRepository();
  resetCarrierLineRepository();
  resetCarrierLineMovementRepository();
}

const SEED_SEND = { provider: "OMT", serviceType: "SEND", amount: 50, currency: "USD", commission: 1, payments: [{ method: "CASH", currencyCode: "USD", amount: 50 }] };

function seed(db: Database.Database): void {
  db.exec(`
    UPDATE exchange_rates SET market_rate = 89750, buy_rate = 89500, sell_rate = 90000 WHERE tenant_id = 1 AND to_code = 'LBP';
    INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES
      (1, 'General', 'USD', 1000), (1, 'General', 'LBP', 90000000),
      (1, 'OMT_System', 'USD', 1000), (1, 'OMT_System', 'LBP', 90000000),
      (1, 'OMT_App', 'USD', 1000), (1, 'OMT_App', 'LBP', 90000000),
      (1, 'Whish_App', 'USD', 1000),
      (1, 'MTC', 'USD', 500), (1, 'iPick', 'LBP', 50000000);
    INSERT INTO carrier_lines (id, tenant_id, carrier, phone_number, label, credits, validity_expires_at, is_active, is_primary)
      VALUES (1, 1, 'mtc', '03123456', 'Shop MTC', 500, '2099-01-01', 1, 1);
    INSERT INTO mobile_service_items (id, tenant_id, provider, category, subcategory, label, cost_lbp, sell_lbp, credits, validity_days)
      VALUES (11, 1, 'iPick', 'mtc', 'Prepaid', 'MTC $4.5 card', 400000, 450000, 4.5, 30);
    INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (7, 1, 'Rami', '70123456');
  `);
  runWithTenant(1, () => {
    const r = getFinancialService().addTransaction({ ...createFinancialServiceSchema.parse(SEED_SEND), userId: 1 } as never);
    if (!r.success) throw new Error(r.error);
  });
}

const state = (db: Database.Database) =>
  tableState(db, ["financial_services", "wallet_exchanges", "carrier_lines", "carrier_line_movements", "debt_ledger"], ["due_date"]);

function c(over: Partial<ParityCase> & Pick<ParityCase, "channel" | "payload" | "online">): ParityCase {
  return { seed, reset, bindings, state, ...over };
}

const omt = (p: Record<string, unknown>) =>
  c({
    channel: "omt:add-transaction",
    payload: p,
    online: () => getFinancialService().addTransaction({ ...createFinancialServiceSchema.parse(p), userId: 1 } as never),
  });

const CASES: Array<[string, ParityCase]> = [
  ["omt:add-transaction OMT SEND, USD cash", omt({ ...SEED_SEND, amount: 100, commission: 2, payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }], senderName: "Rami", receiverName: "Ziad" })],
  ["omt:add-transaction OMT SEND paid in LBP", omt({ ...SEED_SEND, amount: 10, commission: 0, payments: [{ method: "CASH", currencyCode: "LBP", amount: 900000 }] })],
  // LIRA-321 T034a (FR-017): a queued Whish App receive whose customer paid
  // in several lines, part on the client's account, replays to the same
  // wallet/cash deltas and Service Debt as an online save.
  [
    "omt:add-transaction Whish App RECEIVE, customer pays Whish + Cash fee + account",
    omt({
      provider: "WHISH_APP", serviceType: "RECEIVE", amount: 100, currency: "USD", commission: 5, whishFee: 5,
      includingFees: false, feeCollectedSeparately: true, clientId: 7, cashoutMethod: "CASH",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
      customerPayments: [
        { method: "WHISH", currencyCode: "USD", amount: 90 },
        { method: "CASH", currencyCode: "USD", amount: 5 },
        { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 10 },
      ],
    }),
  ],
  ["omt:add-transaction OMT RECEIVE, cash out", omt({ provider: "OMT", serviceType: "RECEIVE", amount: 40, currency: "USD", commission: 0, cashoutMethod: "CASH", payments: [{ method: "CASH", currencyCode: "USD", amount: 40 }] })],
  [
    "financial:self-charge-telecom-item",
    c({
      channel: "financial:self-charge-telecom-item",
      payload: { mobileServiceItemId: 11 },
      online: () => getFinancialService().selfChargeTelecomItem({ ...selfChargeTelecomItemSchema.parse({ mobileServiceItemId: 11 }), userId: 1 } as never),
    }),
  ],
  [
    "wallet-exchange:create OMT App USD → LBP at the recorded rate",
    (() => {
      const p = { drawerName: "OMT_App", fromCurrency: "USD", toCurrency: "LBP", amountIn: 10, rate: 89000 };
      return c({ channel: "wallet-exchange:create", payload: p, online: () => getWalletExchangeService().exchange(createWalletExchangeSchema.parse(p) as never, 1) });
    })(),
  ],
];

describe("financial services bindings (T082)", () => {
  it("each channel validates with its REST route's schema object; omt:add-transaction lifted", () => {
    expect(recordedSchema("omt:add-transaction")).toBe(createFinancialServiceSchema);
    expect(recordedSchema("financial:update-metadata")).toBe(financialUpdateMetadataSchema);
    expect(recordedSchema("financial:self-charge-telecom-item")).toBe(selfChargeTelecomItemSchema);
    expect(recordedSchema("wallet-exchange:create")).toBe(createWalletExchangeSchema);
    expect(PENDING_LIFT).not.toContain("omt:add-transaction");
  });

  it("the lifted schema keeps every key the desktop sends (rule 23)", () => {
    const PRELOAD_KEYS = [
      "provider", "serviceType", "amount", "currency", "commission", "cost", "price", "paidByMethod", "payments",
      "clientId", "clientName", "referenceNumber", "phoneNumber", "senderName", "senderPhone", "receiverName",
      "receiverPhone", "senderClientId", "receiverClientId", "omtServiceType", "omtFee", "whishFee", "profitRate",
      "payFee", "itemKey", "itemCategory", "note", "includingFees", "paymentMethodFee", "paymentMethodFeeRate",
      "returnedCreditsUsd", "partnerId", "partnerMode", "cashoutMethod", "transaction_time", "deferPayment",
      "checkoutTotal", "tender_exchange_rate", "split_group", "split_role", "split_units", "feePayments",
      "kept_change_usd", "kept_change_lbp", "mobileServiceItemId", "telecomCreditReturns",
      // LIRA-321: the "Customer pays" lines on an app-wallet RECEIVE.
      "customerPayments", "customer_waived_amount", "feeCollectedSeparately",
    ];
    const shape = (createFinancialServiceSchema as unknown as { shape: Record<string, unknown> }).shape;
    expect(PRELOAD_KEYS.filter((k) => !(k in shape))).toEqual([]);
  });

  it.each(CASES)("%s — replay equals online, every row at the event's time", async (_n, pc) => {
    const run = await runParity(pc);
    expect(run.online.result).toMatchObject({ success: true });
    expect(run.replay.outcome).toMatchObject({ status: "booked" });
    expect(run.replay.state).toEqual(run.online.state);
    expect(run.replay.offTime).toEqual([]);
  });

  it("LIRA-321 T034a — the replayed Whish App receive books the customer's lines and the Service Debt", async () => {
    const pc = CASES.find(([n]) => n.startsWith("omt:add-transaction Whish App RECEIVE, customer pays"))![1];
    const run = await runParity(pc);
    expect(run.replay.outcome).toMatchObject({ status: "booked" });
    const money = (run.replay.state as { money: { debt: unknown[]; payments: Array<{ method: string; drawer_name: string; amount: number }> } }).money;
    expect(money.debt).toEqual([{ client_id: 7, transaction_type: "Service Debt", amount_usd: 10, amount_lbp: 0 }]);
    expect(money.payments.filter((p) => p.drawer_name === "Whish_App" && p.amount !== 0)).toEqual([
      expect.objectContaining({ method: "WHISH_APP", amount: 90 }),
    ]);
    expect(run.replay.state).toEqual(run.online.state);
  });

  it("financial:update-metadata — editedBy is the event actor's username", async () => {
    const run = await runParity(
      c({
        channel: "financial:update-metadata",
        payload: { id: 1, note: "late pickup", receiver_phone: "70999888" },
        actorUserId: 2,
        online: () => getFinancialService().updateFinancialServiceMetadata(1, { note: "late pickup", receiver_phone: "70999888" }, "cashier"),
      }),
    );
    expect(run.replay.outcome.status).toBe("booked");
    expect(run.replay.state).toEqual(run.online.state);
    expect(JSON.stringify(run.replay.state)).toContain('"edited_by":"cashier"');
  });

  it("a self-charge of an unknown item is refused with the service's reason", async () => {
    const run = await runParity(
      c({
        channel: "financial:self-charge-telecom-item",
        payload: { mobileServiceItemId: 999 },
        online: () => getFinancialService().selfChargeTelecomItem({ mobileServiceItemId: 999, userId: 1 } as never),
      }),
    );
    expect(run.online.result).toMatchObject({ success: false });
    expect(run.replay.outcome).toMatchObject({ status: "refused", error: (run.online.result as { error: string }).error });
    expect(run.replay.state).toEqual(run.online.state);
  });
});
