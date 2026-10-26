/**
 * LIRA-349 A3 — a multi-unit checkout put on the customer's account must show
 * EVERY item it charged, not just the first one.
 *
 * Owner repro (test tenant, tx 13107, services 819/820): a Whish App basket of
 * two items ("alfa: 3.03 (Prepaid)" 355,000 LBP + "alfa: 1GB Mobile Internet"
 * 355,000 LBP) paid fully on CUSTOMER_ACCOUNT. FinancialForm books one
 * transaction per unit; the FIRST unit (the split-group "carrier") carries
 * the whole 710,000 LBP payment, so the ONE 'Service Debt' row hangs off it
 * and every label read from it named only that unit — the second item was
 * invisible on the Debts page, the settle picker and the detail popup.
 *
 * One debt row per checkout stays (the money is right and the checkout can
 * only be reversed as a whole — `voidCheckoutGroup`, rule 20); only what the
 * row SAYS changes. Both split-checkout shapes are walked (rule 28d): the
 * FinancialForm catalog units (with a note each) and KatshForm bills (no
 * note at all).
 *
 * Failing-first (rule 17): written and run against the unfixed code first.
 */
import type Database from "better-sqlite3";
import {
  installDebtItemTestDb,
  uninstallDebtItemTestDb,
  addClient,
} from "../testHelpers/debtItemDb";
import { DebtRepository } from "../DebtRepository";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetSalesRepository } from "../SalesRepository";
import { resetClientRepository } from "../ClientRepository";
import { resetSettingsRepository } from "../SettingsRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

const CLIENT = 7;
let db: Database.Database;
let fsRepo: FinancialServiceRepository;

function resetAll(): void {
  resetSalesRepository();
  resetClientRepository();
  resetSettingsRepository();
  resetPaymentMethodRepository();
  resetTransactionRepository();
}

beforeEach(() => {
  db = installDebtItemTestDb();
  initFixedTenantContext(1);
  resetAll();
  addClient(db, CLIENT, "Review Client", "03261026");
  fsRepo = new FinancialServiceRepository();
});
afterEach(() => {
  resetAll();
  resetTenantContext();
  uninstallDebtItemTestDb(db);
});

/** The owner's basket: two Whish App catalog units, 355,000 LBP each, the
 *  whole 710,000 LBP on the account — exactly FinancialForm's payload. */
function whishBasket(): { carrierFsId: number; siblingFsId: number } {
  const group = "33333333-3333-4333-8333-333333333333";
  const carrier = fsRepo.createTransaction({
    provider: "WHISH_APP",
    serviceType: "SEND",
    amount: 355_000,
    cost: 318_978,
    currency: "LBP",
    commission: 36_022,
    paidByMethod: "CUSTOMER_ACCOUNT",
    payments: [
      { method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 710_000 },
    ],
    checkoutTotal: { usd: 0, lbp: 710_000 },
    clientId: CLIENT,
    itemKey: "WHISH_APP/alfa/Prepaid/3.03",
    itemCategory: "alfa",
    note: "alfa: 3.03 (Prepaid)",
    split_group: group,
    split_role: "carrier",
    split_units: 2,
    userId: 1,
  });
  const sibling = fsRepo.createTransaction({
    provider: "WHISH_APP",
    serviceType: "SEND",
    amount: 355_000,
    cost: 318_978,
    currency: "LBP",
    commission: 36_022,
    paidByMethod: "CUSTOMER_ACCOUNT",
    deferPayment: true,
    clientId: CLIENT,
    itemKey: "WHISH_APP/alfa/Internet/1GB",
    itemCategory: "alfa",
    note: "alfa: 1GB Mobile Internet",
    split_group: group,
    split_role: "sibling",
    split_units: 2,
    userId: 1,
  });
  return { carrierFsId: carrier.id, siblingFsId: sibling.id };
}

/** KatshForm bills: two Katsh bills (no note), $20 + $15 on the account. */
function katshBills(): { carrierFsId: number } {
  const group = "44444444-4444-4444-8444-444444444444";
  const carrier = fsRepo.createTransaction({
    provider: "Katsh",
    serviceType: "BILL",
    amount: 20,
    cost: 20,
    price: 20,
    currency: "USD",
    commission: 0,
    paidByMethod: "CUSTOMER_ACCOUNT",
    payments: [{ method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 35 }],
    checkoutTotal: { usd: 35, lbp: 0 },
    clientId: CLIENT,
    split_group: group,
    split_role: "carrier",
    split_units: 2,
    userId: 1,
  });
  fsRepo.createTransaction({
    provider: "Katsh",
    serviceType: "BILL",
    amount: 15,
    cost: 15,
    price: 15,
    currency: "USD",
    commission: 0,
    paidByMethod: "CUSTOMER_ACCOUNT",
    deferPayment: true,
    clientId: CLIENT,
    split_group: group,
    split_role: "sibling",
    split_units: 2,
    userId: 1,
  });
  return { carrierFsId: carrier.id };
}

describe("Whish App catalog basket on the account (owner repro)", () => {
  it("books ONE 710,000 LBP debt row (unchanged money)", () => {
    whishBasket();
    const rows = db
      .prepare(
        `SELECT amount_lbp FROM debt_ledger WHERE client_id = ? AND transaction_type = 'Service Debt'`,
      )
      .all(CLIENT) as { amount_lbp: number }[];
    expect(rows).toEqual([{ amount_lbp: 710_000 }]);
  });

  it("the settle picker names BOTH items and the checkout total", () => {
    whishBasket();
    const items = new DebtRepository().findOpenDebtItems(CLIENT);
    const charge = items.filter((i) => i.kind === "charge");
    expect(charge).toHaveLength(1);
    expect(charge[0]!.openLbp).toBe(710_000);
    expect(charge[0]!.label).toBe(
      "Whish App (2 items): alfa: 3.03 (Prepaid), alfa: 1GB Mobile Internet — 710,000 LBP",
    );
  });

  it("the account history row lists every item with its own price", () => {
    whishBasket();
    const row = new DebtRepository()
      .findClientHistory(CLIENT)
      .find((r) => r.transaction_type === "Service Debt")!;
    expect(row.itemNames).toEqual([
      "alfa: 3.03 (Prepaid) — 355,000 LBP",
      "alfa: 1GB Mobile Internet — 355,000 LBP",
    ]);
  });

  it("the detail record carries every item of the checkout", () => {
    const { carrierFsId } = whishBasket();
    const record = fsRepo.findWithCheckoutItems(carrierFsId)!;
    expect(record.id).toBe(carrierFsId);
    expect(record.checkout_items).toEqual([
      {
        provider: "WHISH_APP",
        serviceType: "SEND",
        name: "alfa: 3.03 (Prepaid)",
        amount: 355_000,
        currency: "LBP",
      },
      {
        provider: "WHISH_APP",
        serviceType: "SEND",
        name: "alfa: 1GB Mobile Internet",
        amount: 355_000,
        currency: "LBP",
      },
    ]);
  });
});

describe("KatshForm bills (no note) on the account", () => {
  it("names each bill by provider and amount", () => {
    katshBills();
    const items = new DebtRepository().findOpenDebtItems(CLIENT);
    const charge = items.find((i) => i.kind === "charge")!;
    expect(charge.label).toBe("Katsh (2 items): Katsh Bill, Katsh Bill — $35");
    const row = new DebtRepository()
      .findClientHistory(CLIENT)
      .find((r) => r.transaction_type === "Service Debt")!;
    expect(row.itemNames).toEqual(["Katsh Bill — $20", "Katsh Bill — $15"]);
  });
});

describe("a single-unit sale is unchanged", () => {
  it("keeps its own summary and gets no item list", () => {
    const one = fsRepo.createTransaction({
      provider: "WHISH_APP",
      serviceType: "SEND",
      amount: 355_000,
      cost: 318_978,
      currency: "LBP",
      commission: 36_022,
      paidByMethod: "CUSTOMER_ACCOUNT",
      payments: [
        { method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 355_000 },
      ],
      clientId: CLIENT,
      note: "alfa: 3.03 (Prepaid)",
      userId: 1,
    });
    const charge = new DebtRepository()
      .findOpenDebtItems(CLIENT)
      .find((i) => i.kind === "charge")!;
    // Its own (single-unit) summary, untouched by the checkout label.
    expect(charge.label).toContain("alfa: 3.03 (Prepaid)");
    expect(charge.label).not.toContain("items");
    const row = new DebtRepository()
      .findClientHistory(CLIENT)
      .find((r) => r.transaction_type === "Service Debt")!;
    expect(row.itemNames).toBeUndefined();
    expect(
      fsRepo.findWithCheckoutItems(one.id)!.checkout_items,
    ).toBeUndefined();
  });
});
