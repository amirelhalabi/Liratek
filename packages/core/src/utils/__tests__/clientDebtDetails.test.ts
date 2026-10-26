/**
 * LIRA-350 — one client-facing line + detail per sale type, built from the
 * transaction's saved data. Fixtures are the 11 real transactions the
 * 2026-10-27 test-tenant review created (exports/transactions.json), so the
 * expected lines are the review's "What each debt row should show" table
 * worded for these rows.
 */
import fs from "node:fs";
import path from "node:path";
import {
  buildClientDebtDetails,
  clientMoney,
  type ClientDebtSource,
  type ClientDebtTxSource,
} from "../clientDebtDetails";

type Fixture = Omit<ClientDebtTxSource, "voucher" | "loto"> & {
  source_table: string;
  created_at: string;
};
const FIX = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "fixtures/lira350TenantReview.json"),
    "utf8",
  ),
) as Record<string, Fixture>;

function tx(id: number, extra: Partial<ClientDebtTxSource> = {}) {
  const f = FIX[String(id)]!;
  return { ...f, ...extra } as ClientDebtTxSource;
}

function src(
  id: number,
  ledgerType: string,
  usd: number,
  lbp: number,
  note: string,
  extra: Partial<ClientDebtTxSource> = {},
): ClientDebtSource {
  return {
    ledger: {
      transaction_type: ledgerType,
      amount_usd: usd,
      amount_lbp: lbp,
      note,
    },
    tx: tx(id, extra),
  };
}

describe("buildClientDebtDetails — one line per sale type (REPORT table)", () => {
  it.each([
    [
      "POS sale, part paid",
      src(13100, "Sale Debt", 15, 0, "Sale #281: …"),
      "Sale #281: 2× iPhone 15 Tempered Glass, 1× USB-C to USB-C Cable 1m 60W, 1× iPhone 15 Clear MagSafe Case — $25 (discount $4), paid $10, $15 on account",
    ],
    [
      "POS sale, all on account",
      src(13101, "Sale Debt", 25, 0, "Sale #282: …"),
      "Sale #282: 1× Apple 20W USB-C Power Adapter, 1× Samsung Galaxy A55 Clear Case — $25",
    ],
    [
      "MTC credits",
      src(13102, "Recharge Debt", 0, 300000, "MTC 3$ Credits - 03261026"),
      "MTC $3 credit → 03261026 — 300,000 LBP",
    ],
    [
      "Alfa days, no number saved",
      src(13104, "Recharge Debt", 0, 623000, "Alfa 30 days"),
      "Alfa 30 days — 623,000 LBP",
    ],
    [
      "OMT send",
      src(13105, "Service Debt", 21, 0, "OMT SEND (INTRA) — $20"),
      "OMT send $20 + $1 fee = $21, ref OMT-REF-2610",
    ],
    [
      "Whish App bill",
      src(13107, "Service Debt", 0, 355000, "Whish App: …"),
      "Whish App: alfa: 3.03 (Prepaid) — 355,000 LBP",
    ],
    [
      "custom service with the cashier's note",
      src(13109, "Custom Service Debt", 5, 0, "Custom Service"),
      "Spotify Premium 1 Month — $5 — Spotify account: review2610@mail.com",
    ],
    [
      "maintenance job",
      src(13110, "Maintenance Debt", 20, 0, "Balance from Maintenance"),
      "Job #51 — iPhone 15 (black): Charging port replacement + screen protector fitted — $30, paid 890,000 LBP, $20 on account",
    ],
    [
      "loto ticket (no ticket number)",
      src(
        13111,
        "Loto Debt",
        0,
        200000,
        "Loto ticket sale: #217 CUSTOMER ACCOUNT",
        {
          loto: { ticket_number: null, sale_date: "2026-10-27", note: null },
        },
      ),
      "Loto ticket — 200,000 LBP",
    ],
    [
      "exchange",
      src(13112, "Exchange Debt", 10, 0, "Exchange USD → LBP"),
      "$20 → 1,780,000 LBP @ 89,000, paid $10, $10 on account",
    ],
    [
      "voucher with its note from the voucher record",
      src(13113, "Voucher Debt", 10, 0, "Voucher sold GIFT-SL8E-BKBM", {
        voucher: {
          code: "GIFT-SL8E-BKBM",
          amount: 10,
          currency_code: "USD",
          expiry_date: null,
          status: "pending",
          note: "Birthday gift for brother",
        },
      }),
      "Voucher GIFT-SL8E-BKBM $10 (Pending, no expiry) — Birthday gift for brother",
    ],
  ])("%s", (_name, source, line) => {
    expect(buildClientDebtDetails(source).line).toBe(line);
  });

  it("a multi-unit Whish checkout names every unit (LIRA-349 split label)", () => {
    const d = buildClientDebtDetails(
      src(13107, "Service Debt", 0, 710000, "x", {
        splitItems: [
          {
            provider: "WHISH_APP",
            serviceType: "SEND",
            name: "alfa: 3.03 (Prepaid)",
            amount: 355000,
            currency: "LBP",
          },
          {
            provider: "WHISH_APP",
            serviceType: "SEND",
            name: "alfa: 1GB Mobile Internet",
            amount: 355000,
            currency: "LBP",
          },
        ],
      }),
    );
    expect(d.line).toMatch(
      /^Whish App \(2 items\): alfa: 3\.03 \(Prepaid\), alfa: 1GB Mobile Internet — 710,000 LBP$/,
    );
    expect(d.items.map((i) => `${i.name} ${i.total}`)).toEqual([
      "alfa: 3.03 (Prepaid) 355,000 LBP",
      "alfa: 1GB Mobile Internet 355,000 LBP",
    ]);
  });

  it("a loto ticket number, when saved, is part of the line", () => {
    const d = buildClientDebtDetails(
      src(13111, "Loto Debt", 0, 200000, "x", {
        loto: { ticket_number: "88123", sale_date: "2026-10-27", note: null },
      }),
    );
    expect(d.line).toBe("Loto ticket #88123 — 200,000 LBP");
  });

  it("an Alfa Days row shows the number once the form saves it", () => {
    const f = FIX["13104"]!;
    const meta = JSON.parse(f.metadata_json!) as {
      details: Record<string, unknown>;
    };
    meta.details.phone = "03261026";
    const d = buildClientDebtDetails(
      src(13104, "Recharge Debt", 0, 623000, "x", {
        metadata_json: JSON.stringify(meta),
      }),
    );
    expect(d.line).toBe("Alfa 30 days → 03261026 — 623,000 LBP");
    expect(d.fields).toContainEqual({ key: "phone", value: "03261026" });
  });

  it("a session basket names each item and how it was paid", () => {
    const case12: ClientDebtTxSource = {
      id: 13120,
      type: "SALE",
      summary: "Sale #283: 1× iPhone 15 Clear MagSafe Case — $12",
      metadata_json: JSON.stringify({
        details: {
          v: 1,
          kind: "pos_sale",
          items: [
            {
              productId: 108,
              name: "iPhone 15 Clear MagSafe Case",
              quantity: 1,
              unitPrice: 12,
              unitCost: 4,
            },
          ],
        },
      }),
      amount_usd: 12,
      amount_lbp: 0,
    };
    const mtc6: ClientDebtTxSource = {
      id: 13121,
      type: "RECHARGE",
      summary: "Recharge: MTC Credits $6 — 600,000 LBP",
      metadata_json: JSON.stringify({
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        details: {
          v: 1,
          kind: "telecom_recharge",
          carrier: "MTC",
          type: "CREDIT_TRANSFER",
          phone: "03261026",
          amount: 6,
        },
      }),
      amount_usd: 0,
      amount_lbp: 600000,
    };
    const d = buildClientDebtDetails({
      ledger: {
        transaction_type: "Session Debt",
        amount_usd: 0,
        amount_lbp: 600000,
        note: "Session #162 basket",
        session_id: 162,
      },
      tx: null,
      session: {
        members: [
          { tx: case12, owed_usd: 0, owed_lbp: 0 },
          { tx: mtc6, owed_usd: 0, owed_lbp: 600000 },
        ],
        payments: [{ method: "CASH", currency: "USD", amount: 12 }],
      },
    });
    expect(d.line).toBe(
      "Session #162: Sale #283: 1× iPhone 15 Clear MagSafe Case — $12 (paid); MTC $6 credit → 03261026 — 600,000 LBP (600,000 LBP on account)",
    );
    expect(d.members?.map((m) => m.paidText)).toEqual([
      "Paid",
      "600,000 LBP on account",
    ]);
    expect(d.payments).toEqual([
      {
        method: "CASH",
        currency: "USD",
        amount: 12,
        text: "$12",
        direction: "IN",
      },
    ]);
  });
});

describe("buildClientDebtDetails — what the detail window shows", () => {
  it("POS sale: items with price, each payment leg with method + currency", () => {
    const d = buildClientDebtDetails(src(13101, "Sale Debt", 25, 0, "x"));
    expect(d.kind).toBe("pos_sale");
    expect(d.ref).toBe("#282");
    expect(d.items).toEqual([
      {
        name: "Apple 20W USB-C Power Adapter",
        quantity: 1,
        unitPrice: "$19",
        total: "$19",
      },
      {
        name: "Samsung Galaxy A55 Clear Case",
        quantity: 1,
        unitPrice: "$6",
        total: "$6",
      },
    ]);
    expect(d.payments).toEqual([
      {
        method: "CUSTOMER_ACCOUNT",
        currency: "LBP",
        amount: 2225000,
        text: "2,225,000 LBP",
        direction: "IN",
      },
    ]);
    expect(d.onAccount).toEqual({ usd: 25, lbp: 0 });
  });

  it("maintenance: device, issue, labour, parts, warranty — no repair cost", () => {
    const d = buildClientDebtDetails(
      src(13110, "Maintenance Debt", 20, 0, "x"),
    );
    expect(d.ref).toBe("#51");
    expect(d.fields).toEqual(
      expect.arrayContaining([
        { key: "device", value: "iPhone 15 (black)" },
        {
          key: "issue",
          value: "Charging port replacement + screen protector fitted",
        },
        { key: "labour", value: "$25" },
        { key: "total", value: "$30" },
        { key: "warrantyUntil", value: "2027-01-27", type: "date" },
        { key: "status", value: "Delivered" },
      ]),
    );
    expect(d.items).toEqual([
      {
        name: "iPhone 15 Tempered Glass",
        quantity: 1,
        unitPrice: "$5",
        total: "$5",
      },
    ]);
    expect(d.payments.map((p) => `${p.method} ${p.text}`)).toEqual([
      "CASH 890,000 LBP",
      "CUSTOMER_ACCOUNT $20",
    ]);
  });

  it("OMT: amount, fee, total, reference, sender — never the commission", () => {
    const d = buildClientDebtDetails(src(13105, "Service Debt", 21, 0, "x"));
    expect(d.kind).toBe("transfer");
    expect(d.fields).toEqual([
      { key: "service", value: "OMT send (Intra)" },
      { key: "amount", value: "$20" },
      { key: "fee", value: "$1" },
      { key: "total", value: "$21" },
      { key: "reference", value: "OMT-REF-2610" },
      { key: "sender", value: "Review Client 26-10 · 03261026" },
    ]);
  });

  it("exchange: both sides, the rate and the legs", () => {
    const d = buildClientDebtDetails(src(13112, "Exchange Debt", 10, 0, "x"));
    expect(d.fields).toEqual([
      { key: "gave", value: "$20" },
      { key: "received", value: "1,780,000 LBP" },
      { key: "rate", value: "89,000" },
    ]);
    expect(
      d.payments.map((p) => `${p.direction} ${p.method} ${p.text}`),
    ).toEqual([
      "OUT CASH 1,780,000 LBP",
      "IN CASH $10",
      "IN CUSTOMER_ACCOUNT $10",
    ]);
  });

  it("voucher: code, value, expiry, status, note", () => {
    const d = buildClientDebtDetails(
      src(13113, "Voucher Debt", 10, 0, "x", {
        voucher: {
          code: "GIFT-SL8E-BKBM",
          amount: 10,
          currency_code: "USD",
          expiry_date: "2027-03-01",
          status: "pending",
          note: "Birthday gift for brother",
        },
      }),
    );
    expect(d.fields).toEqual([
      { key: "code", value: "GIFT-SL8E-BKBM" },
      { key: "value", value: "$10" },
      { key: "expiry", value: "2027-03-01", type: "date" },
      { key: "status", value: "Pending" },
    ]);
    expect(d.note).toBe("Birthday gift for brother");
    expect(d.line).toBe(
      "Voucher GIFT-SL8E-BKBM $10 (Pending, expires 2027-03-01) — Birthday gift for brother",
    );
  });

  it("C13: no cost, product id, commission or internal status ever leaves the builder", () => {
    for (const id of Object.keys(FIX)) {
      const out = JSON.stringify(
        buildClientDebtDetails(src(Number(id), "Any Debt", 1, 0, "x")),
      );
      expect(out).not.toMatch(
        /cost|productId|commission|Delivered_Paid|profit/i,
      );
      // The cost VALUES of the fixtures (unit cost $4, repair cost $8,
      // recharge cost 255,000 / 76,500, Whish cost 318,978).
      expect(out).not.toMatch(/255,000|76,500|318,978|"\$8"/);
    }
  });

  it("a manual / imported row (no transaction) shows its note", () => {
    const d = buildClientDebtDetails({
      ledger: {
        transaction_type: "Manual Debt",
        amount_usd: 5,
        amount_lbp: 0,
        note: "Borrowed cash",
      },
      tx: null,
    });
    expect(d.kind).toBe("manual");
    expect(d.line).toBe("Borrowed cash");
  });
});

describe("clientMoney", () => {
  it("puts a minus sign before the currency sign", () => {
    expect(clientMoney(-5, "USD")).toBe("-$5");
    expect(clientMoney(-6.5, "USD")).toBe("-$6.50");
    expect(clientMoney(-300000, "LBP")).toBe("-300,000 LBP");
    expect(clientMoney(1234.5, "USD")).toBe("$1,234.50");
  });
});
