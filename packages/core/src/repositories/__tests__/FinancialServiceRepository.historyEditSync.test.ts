/**
 * Bug #6 (TRANSACTION_DETAIL_AUDIT.md §3) — editing a name, phone or note
 * from OMT / Whish History (and the OMT App / Whish App History) must reach
 * the transaction too: its client name and phone, the sender / receiver /
 * customer and note in its details, and its summary line. Rule 31: the edit
 * path is the update owner of every copy it made at creation.
 *
 * The expected summary is taken from a FRESH row created with the new name
 * (the create path's own builder), never hand-typed — the edited row must
 * read exactly as a new one would. Expected details go through the kind's
 * own schema (rule 24).
 *
 * Reversal rows (a void's / refund's negated row) keep what they recorded at
 * the moment of the reversal: they are left alone.
 *
 * Rule 17: run before the change and seen failing (the transaction kept the
 * old name, phone, details and summary).
 *
 * Real schema: create_db.sql + migrations.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  FinancialServiceRepository,
  resetFinancialServiceRepository,
  type CreateFinancialServiceData,
} from "../FinancialServiceRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetSupplierRepository } from "../SupplierRepository";
import { buildDb, fundDrawer, USER_ID } from "../testHelpers/omtAccountDb";
import {
  omtWhishTransferDetailsSchema,
  walletTransferDetailsSchema,
} from "../../validators/transactionDetails";

interface TxnRow {
  id: number;
  client_name: string | null;
  client_phone: string | null;
  summary: string;
  metadata_json: string;
  amount_usd: number;
  profit_usd: number;
}

function txn(db: Database.Database, fsId: number): TxnRow {
  return db
    .prepare(
      `SELECT id, client_name, client_phone, summary, metadata_json, amount_usd, profit_usd
         FROM transactions
        WHERE source_table = 'financial_services' AND source_id = ?
          AND type = 'FINANCIAL_SERVICE' AND reverses_id IS NULL`,
    )
    .get(fsId) as TxnRow;
}

function details(row: TxnRow): Record<string, unknown> {
  return (JSON.parse(row.metadata_json) as { details: Record<string, unknown> })
    .details;
}

const OMT_SEND: CreateFinancialServiceData = {
  provider: "OMT",
  serviceType: "SEND",
  amount: 100,
  currency: "USD",
  commission: 0,
  omtServiceType: "CASH_TO_BUSINESS",
  omtFee: 5,
  includingFees: false,
  referenceNumber: "R-123",
  clientName: "Ali Saad",
  phoneNumber: "70123456",
  senderName: "Ali Saad",
  senderPhone: "70123456",
  receiverName: "Sara Khoury",
  receiverPhone: "71987654",
  note: "urgent",
  payments: [{ method: "CASH", currencyCode: "USD", amount: 105 }],
};

describe("Bug #6 — a History edit reaches the transaction", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;

  beforeEach(() => {
    resetFinancialServiceRepository();
    resetTransactionRepository();
    resetSupplierRepository();
    db = buildDb();
    initFixedTenantContext(1);
    for (const d of [
      "General",
      "OMT_System",
      "Whish_System",
      "Whish_App",
      "Katsh",
      "iPick",
      "Binance",
    ]) {
      fundDrawer(db, d, "USD", 10000);
      fundDrawer(db, d, "LBP", 500_000_000);
    }
    db.prepare(
      `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance)
       VALUES (1, 'Binance', 'USDT', 10000)
       ON CONFLICT(tenant_id, drawer_name, currency_code) DO UPDATE SET balance = excluded.balance`,
    ).run();
    repo = new FinancialServiceRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  function create(data: CreateFinancialServiceData): number {
    return repo.createTransaction({ userId: USER_ID, ...data }).id;
  }

  it("OMT send: sender name/phone and note edited — client columns, details and summary follow; money untouched", () => {
    const id = create(OMT_SEND);
    const before = txn(db, id);

    repo.updateMetadata(
      id,
      {
        sender_name: "Ali Saeed",
        sender_phone: "70999888",
        note: "call first",
      },
      "admin",
    );
    const after = txn(db, id);

    // What a new row with the corrected name shows (the create path's own
    // builder) — the edited row must read the same.
    const fresh = txn(
      db,
      create({
        ...OMT_SEND,
        senderName: "Ali Saeed",
        senderPhone: "70999888",
        note: "call first",
      }),
    );
    expect(after.summary).toBe(fresh.summary);
    expect(after.summary).not.toBe(before.summary);
    expect(after.client_name).toBe("Ali Saeed");
    expect(after.client_phone).toBe("70999888");

    const expected = {
      ...details(before),
      sender: { name: "Ali Saeed", phone: "70999888" },
      note: "call first",
    };
    expect(omtWhishTransferDetailsSchema.parse(expected)).toEqual(expected);
    expect(details(after)).toEqual(expected);

    // Money is not an edit: unchanged.
    expect(after.amount_usd).toBe(before.amount_usd);
    expect(after.profit_usd).toBe(before.profit_usd);
  });

  it("OMT receive: editing the SENDER changes the details only; the row's customer is the receiver", () => {
    const id = create({
      ...OMT_SEND,
      serviceType: "RECEIVE",
      omtFee: undefined,
      includingFees: undefined,
      clientName: "Sara Khoury",
      phoneNumber: "71987654",
      cashoutMethod: "CASH",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
    });
    const before = txn(db, id);
    expect(before.client_name).toBe("Sara Khoury");

    repo.updateMetadata(id, { sender_name: "Ali Saeed" }, "admin");
    const after = txn(db, id);
    expect(after.client_name).toBe("Sara Khoury");
    expect(after.summary).toBe(before.summary);
    expect((details(after).sender as { name: string }).name).toBe("Ali Saeed");

    repo.updateMetadata(id, { receiver_name: "Sara K. Khoury" }, "admin");
    const renamed = txn(db, id);
    expect(renamed.client_name).toBe("Sara K. Khoury");
    expect(renamed.client_phone).toBe("71987654");
    expect(renamed.summary).toContain("Sara K. Khoury");
    expect(renamed.summary).not.toContain("Sara Khoury —");
  });

  it("Whish App transfer: the customer's name, phone and note follow (counterparty)", () => {
    const WALLET: CreateFinancialServiceData = {
      provider: "WHISH_APP",
      serviceType: "SEND",
      amount: 20,
      currency: "USD",
      commission: 2,
      whishFee: 1,
      clientName: "Maya Aoun",
      phoneNumber: "76555444",
      note: "for rent",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 22 }],
    };
    const id = create(WALLET);
    const before = txn(db, id);

    repo.updateMetadata(
      id,
      { client_name: "Maya Haddad", phone_number: "76000111", note: "rent" },
      "admin",
    );
    const after = txn(db, id);
    const fresh = txn(
      db,
      create({
        ...WALLET,
        clientName: "Maya Haddad",
        phoneNumber: "76000111",
        note: "rent",
      }),
    );
    expect(after.summary).toBe(fresh.summary);
    expect(after.client_name).toBe("Maya Haddad");
    expect(after.client_phone).toBe("76000111");
    const expected = {
      ...details(before),
      counterparty: { name: "Maya Haddad", phone: "76000111" },
      note: "rent",
    };
    expect(walletTransferDetailsSchema.parse(expected)).toEqual(expected);
    expect(details(after)).toEqual(expected);
  });

  /**
   * The summary is rewritten only when the create path's builder reproduces
   * the saved line from the row as it was — so every kind the History edit
   * reaches is checked against a fresh row (a kind whose stored inputs did
   * not reproduce it would silently keep the old line).
   */
  it.each<
    [
      string,
      CreateFinancialServiceData,
      Record<string, string>,
      Partial<CreateFinancialServiceData>,
    ]
  >([
    [
      "Whish system send with a Whish fee",
      {
        provider: "WHISH",
        serviceType: "SEND",
        amount: 200,
        currency: "USD",
        commission: 0,
        whishFee: 3,
        includingFees: false,
        clientName: "Maya Aoun",
        phoneNumber: "76555444",
        senderName: "Maya Aoun",
        senderPhone: "76555444",
        receiverName: "Karim Aoun",
        receiverPhone: "0033612345678",
        payments: [{ method: "CASH", currencyCode: "USD", amount: 203 }],
      },
      { sender_name: "Maya Haddad" },
      { senderName: "Maya Haddad" },
    ],
    [
      "Binance send",
      {
        provider: "BINANCE",
        serviceType: "SEND",
        amount: 50,
        currency: "USDT",
        commission: 1,
        feePaidBy: "SENDER",
        referenceNumber: "TRX-0x99",
        clientName: "Karim",
        paidByMethod: "CASH",
        payments: [{ method: "CASH", currencyCode: "USD", amount: 51 }],
        checkoutTotal: { usd: 51, lbp: 0 },
      },
      { client_name: "Karim Saad" },
      { clientName: "Karim Saad" },
    ],
    [
      "Katsh card sale (the note is the item label)",
      {
        provider: "Katsh",
        serviceType: "SEND",
        amount: 2_050_000,
        cost: 1_980_000,
        currency: "LBP",
        commission: 70_000,
        paidByMethod: "CASH",
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 2_050_000 }],
        checkoutTotal: { usd: 0, lbp: 2_050_000 },
        clientName: "Hassan Ali",
        phoneNumber: "76000111",
        note: "Alfa: $22 card",
      },
      { note: "Alfa: $22 card (Prepaid)", client_name: "Hassan Aly" },
      { note: "Alfa: $22 card (Prepaid)", clientName: "Hassan Aly" },
    ],
    [
      "iPick bill",
      {
        provider: "iPick",
        serviceType: "BILL",
        amount: 500_000,
        cost: 500_000,
        price: 500_000,
        currency: "LBP",
        commission: 0,
        clientName: "Rana",
        paidByMethod: "CASH",
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 500_000 }],
      },
      { client_name: "Rana Aziz" },
      { clientName: "Rana Aziz" },
    ],
  ])(
    "%s: the edited row reads like a new one",
    (_label, input, edit, asCreated) => {
      // A Whish system transfer needs Whish as the shop's base system.
      if (input.provider === "WHISH") {
        db.prepare(
          `UPDATE system_settings SET value = 'WHISH' WHERE key_name = 'shop_base_system' AND tenant_id = 1`,
        ).run();
      }
      const id = create(input);
      const before = txn(db, id);
      repo.updateMetadata(id, edit, "admin");
      const after = txn(db, id);
      const fresh = txn(db, create({ ...input, ...asCreated }));
      expect(after.summary).toBe(fresh.summary);
      expect(after.client_name).toBe(fresh.client_name);
      if (fresh.summary !== before.summary) {
        expect(after.summary).not.toBe(before.summary);
      }
    },
  );

  it("a voided transfer: the original row follows the edit, the void's reversal row keeps what it recorded", () => {
    const id = create(OMT_SEND);
    const original = txn(db, id);
    getTransactionRepository().voidTransaction(original.id, 1);
    const reversalBefore = db
      .prepare(
        `SELECT client_name, summary, metadata_json FROM transactions WHERE reverses_id = ?`,
      )
      .get(original.id);

    repo.updateMetadata(id, { sender_name: "Ali Saeed" }, "admin");

    expect(txn(db, id).client_name).toBe("Ali Saeed");
    expect(
      db
        .prepare(
          `SELECT client_name, summary, metadata_json FROM transactions WHERE reverses_id = ?`,
        )
        .get(original.id),
    ).toEqual(reversalBefore);
  });
});
