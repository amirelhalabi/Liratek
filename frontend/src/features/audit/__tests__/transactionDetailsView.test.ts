/**
 * The generic transaction details renderer (owner request 2026-10-16): ONE
 * renderer for every `metadata_json.details` kind, the payment snapshot and
 * whatever legacy keys an older row carries.
 *
 * Fixtures are parsed through core's own `transactionDetailsSchema` /
 * `paymentSnapshotSchema` before use, so they are real-shaped by construction
 * (rule 24) — a fixture that drifts from the LIRA-329 contract fails here.
 *
 * Written failing-first against a stub `buildTransactionDetailsView` that
 * returned an empty view (rule 17).
 */
import {
  paymentSnapshotSchema,
  transactionDetailsSchema,
  type PaymentSnapshot,
  type TransactionDetails,
} from "@liratek/core";
import {
  buildTransactionDetailsView,
  humaniseKey,
  isCostKey,
  type DetailRow,
  type DetailValue,
} from "../transactionDetailsView";

const METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  OMT: "OMT Wallet",
};
const methodLabel = (code: string) => METHOD_LABELS[code] ?? code;
const ADMIN = { isAdmin: true, methodLabel };
const STAFF = { isAdmin: false, methodLabel };

function meta(
  details?: TransactionDetails,
  snapshot?: PaymentSnapshot,
  legacy: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    ...legacy,
    ...(details ? { details: transactionDetailsSchema.parse(details) } : {}),
    ...(snapshot
      ? { payment_snapshot: paymentSnapshotSchema.parse(snapshot) }
      : {}),
  });
}

function find(rows: DetailRow[], label: string): DetailRow | undefined {
  return rows.find((r) => r.label === label);
}
function text(value: DetailValue | undefined): string | undefined {
  return value?.kind === "text" ? value.text : undefined;
}
function allLabels(rows: DetailRow[]): string[] {
  return rows.flatMap((r) => [
    r.label,
    ...(r.value.kind === "group" ? allLabels(r.value.rows) : []),
    ...(r.value.kind === "table" ? r.value.columns.map((c) => c.label) : []),
  ]);
}

const omtSend: TransactionDetails = {
  v: 1,
  kind: "omt_whish_transfer",
  provider: "OMT",
  direction: "SEND",
  serviceType: "WESTERN_UNION",
  reference: "WU-998877",
  sender: { name: "Ali Saad", phone: "70123456" },
  receiver: { name: "Maya Haddad" },
  omtFee: 12500,
  includingFees: false,
};

const posSale: TransactionDetails = {
  v: 1,
  kind: "pos_sale",
  items: [
    {
      productId: 7,
      name: "USB-C cable",
      quantity: 2,
      unitPrice: 4.5,
      unitCost: 1.75,
    },
    {
      productId: 9,
      name: "iPhone 13",
      quantity: 1,
      unitPrice: 1250,
      unitCost: 980,
      imei: "356789012345678",
      warrantyMonths: 6,
    },
  ],
  paymentCurrency: "USD",
  discount: { amount: 1000, currency: "LBP" },
};

const maintenanceJob: TransactionDetails = {
  v: 1,
  kind: "maintenance_job",
  jobId: 1234,
  device: "Samsung A52",
  issue: "Broken screen, touch not responding",
  status: "Delivered",
  repairCost: { usd: 30 },
  price: { usd: 55, lbp: 450000 },
  warrantyMonths: 3,
  warrantyUntil: "2027-01-16",
};

const reversal: TransactionDetails = {
  v: 1,
  kind: "reversal",
  originalTransactionId: 4521,
  refundUnits: [
    { unitId: 31, flags: ["DEFECTIVE", "WARRANTY_OVERRIDE_CLEARED"] },
  ],
};

const cashSnapshot: PaymentSnapshot = {
  lines: [
    { method: "CASH", currency: "USD", amount: 20, direction: "IN" },
    { method: "CASH", currency: "LBP", amount: 89500, direction: "OUT" },
  ],
  change_returned: [{ method: "CASH", currency: "LBP", amount: 89500 }],
  kept: { lbp: 5000 },
};

describe("humaniseKey", () => {
  it.each([
    ["serviceType", "Service type"],
    ["reference", "Reference"],
    ["sender", "Sender"],
    ["omtFee", "OMT fee"],
    ["warranty_months", "Warranty months"],
    ["originalTransactionId", "Original transaction ID"],
  ])("%s → %s", (key, label) => {
    expect(humaniseKey(key)).toBe(label);
  });
});

describe("isCostKey — the one cost/profit key definition", () => {
  it.each([
    "unitCost",
    "cost",
    "repairCost",
    "costUsd",
    "cost_usd",
    "cost_lbp",
    "unit_cost_usd",
    "cost_price",
    "profitUsd",
    "profit_lbp",
    "net_profit_usd",
    "commission",
    "commissionRate",
    "commission_usd",
    "buy_rate",
  ])("hides %s", (key) => {
    expect(isCostKey(key)).toBe(true);
  });

  it.each(["omtFee", "whishFee", "discount", "unitPrice", "price", "amount"])(
    "keeps %s",
    (key) => {
      expect(isCostKey(key)).toBe(false);
    },
  );
});

describe("buildTransactionDetailsView", () => {
  it("renders an OMT send's details with humanised labels, a person on one line, Yes/No and a readable kind", () => {
    const view = buildTransactionDetailsView(meta(omtSend), ADMIN);
    expect(view.kindLabel).toBe("OMT / Whish transfer");
    expect(text(find(view.details, "Service type")?.value)).toBe(
      "Western union",
    );
    expect(text(find(view.details, "Reference")?.value)).toBe("WU-998877");
    expect(text(find(view.details, "Sender")?.value)).toBe(
      "Ali Saad · 70123456",
    );
    expect(text(find(view.details, "Receiver")?.value)).toBe("Maya Haddad");
    expect(text(find(view.details, "OMT fee")?.value)).toBe("12,500");
    expect(text(find(view.details, "Fees included")?.value)).toBe("No");
    expect(view.isEmpty).toBe(false);
  });

  it("never shows the shape version `v` or `kind` as a row", () => {
    const view = buildTransactionDetailsView(meta(omtSend), ADMIN);
    expect(view.details.map((r) => r.key)).not.toContain("v");
    expect(view.details.map((r) => r.key)).not.toContain("kind");
  });

  it("renders a POS sale's items as a table with humanised headers (admin sees unit cost)", () => {
    const view = buildTransactionDetailsView(meta(posSale), ADMIN);
    const items = find(view.details, "Items")?.value;
    expect(items?.kind).toBe("table");
    if (items?.kind !== "table") return;
    const headers = items.columns.map((c) => c.label);
    expect(headers).toEqual(
      expect.arrayContaining([
        "Product ID",
        "Name",
        "Quantity",
        "Unit price",
        "Unit cost",
        "IMEI",
        "Warranty months",
      ]),
    );
    const nameCol = items.columns.findIndex((c) => c.key === "name");
    const idCol = items.columns.findIndex((c) => c.key === "productId");
    const imeiCol = items.columns.findIndex((c) => c.key === "imei");
    const priceCol = items.columns.findIndex((c) => c.key === "unitPrice");
    expect(items.rows[1][nameCol]).toBe("iPhone 13");
    expect(items.rows[1][idCol]).toBe("#9");
    expect(items.rows[1][imeiCol]).toBe("356789012345678");
    // Inventory items are priced in dollars (shop-day fix, owner Q7).
    expect(items.rows[1][priceCol]).toBe("$1,250.00");
    // A cable has no IMEI — an empty cell, not "undefined".
    expect(items.rows[0][imeiCol]).toBe("");
    // The discount as typed, currency-aware.
    expect(text(find(view.details, "Discount")?.value)).toBe("1,000 LBP");
    expect(text(find(view.details, "Payment currency")?.value)).toBe("USD");
  });

  it("hides cost columns and cost rows from staff — no Unit cost column at all", () => {
    const sale = buildTransactionDetailsView(meta(posSale), STAFF);
    const items = find(sale.details, "Items")?.value;
    expect(items?.kind).toBe("table");
    if (items?.kind !== "table") return;
    expect(items.columns.map((c) => c.label)).not.toContain("Unit cost");
    expect(items.rows.every((r) => r.length === items.columns.length)).toBe(
      true,
    );

    const job = buildTransactionDetailsView(meta(maintenanceJob), STAFF);
    expect(allLabels(job.details)).not.toContain("Repair cost");
    expect(find(job.details, "Price")).toBeDefined();
  });

  it("renders a maintenance job: id as #, {usd,lbp} as one amount, admin sees the repair cost", () => {
    const view = buildTransactionDetailsView(meta(maintenanceJob), ADMIN);
    expect(view.kindLabel).toBe("Maintenance job");
    expect(text(find(view.details, "Job ID")?.value)).toBe("#1234");
    expect(text(find(view.details, "Price")?.value)).toBe(
      "$55.00 + 450,000 LBP",
    );
    expect(text(find(view.details, "Repair cost")?.value)).toBe("$30.00");
    expect(text(find(view.details, "Issue")?.value)).toBe(
      "Broken screen, touch not responding",
    );
  });

  it("renders a partner {id, name, mode} on one line: name, id, mode in words", () => {
    const view = buildTransactionDetailsView(
      meta({
        v: 1,
        kind: "custom_service",
        description: "Visa application",
        partner: { id: 4, name: "Rami", mode: "VIA" },
      }),
      ADMIN,
    );
    expect(text(find(view.details, "Partner")?.value)).toBe("Rami (#4) · Via");
  });

  it("renders a nested object with mixed fields as indented sub-rows", () => {
    const view = buildTransactionDetailsView(
      meta({
        v: 1,
        kind: "telecom_recharge",
        carrier: "MTC",
        type: "DAYS",
        typed: { costUsd: 3.5, priceUsd: 6 },
      }),
      ADMIN,
    );
    const typed = find(view.details, "Typed")?.value;
    expect(typed?.kind).toBe("group");
    if (typed?.kind !== "group") return;
    expect(text(find(typed.rows, "Cost USD")?.value)).toBe("$3.50");
    expect(text(find(typed.rows, "Price USD")?.value)).toBe("$6.00");
  });

  it("renders a reversal: original id, refund units table with flags joined", () => {
    const view = buildTransactionDetailsView(meta(reversal), STAFF);
    expect(view.kindLabel).toBe("Reversal");
    expect(text(find(view.details, "Original transaction ID")?.value)).toBe(
      "#4521",
    );
    const units = find(view.details, "Refund units")?.value;
    expect(units?.kind).toBe("table");
    if (units?.kind !== "table") return;
    expect(units.columns.map((c) => c.label)).toEqual(["Unit ID", "Flags"]);
    expect(units.rows[0]).toEqual([
      "#31",
      "Defective, Warranty override cleared",
    ]);
  });

  it("renders the payment snapshot as In/Out lines with method labels, change returned and kept change", () => {
    const view = buildTransactionDetailsView(
      meta(posSale, cashSnapshot),
      STAFF,
    );
    expect(view.payment?.lines).toEqual([
      {
        direction: "In",
        method: "Cash",
        currency: "USD",
        amount: "$20.00",
        value: 20,
        note: null,
      },
      {
        direction: "Out",
        method: "Cash",
        currency: "LBP",
        amount: "89,500 LBP",
        value: 89500,
        note: null,
      },
    ]);
    expect(view.payment?.changeReturned).toBe("Cash 89,500 LBP");
    expect(view.payment?.kept).toBe("5,000 LBP");
    expect(view.payment?.sessionId).toBeNull();
  });

  it("shows the session once, whether it came from details or the snapshot", () => {
    const view = buildTransactionDetailsView(
      meta({ ...omtSend, paid_in_session: 88 }, { lines: [], session_id: 88 }),
      ADMIN,
    );
    expect(view.payment?.sessionId).toBe(88);
    expect(find(view.details, "Paid in session")).toBeUndefined();
  });

  it("shows a legacy-only row's keys under Other saved data (cost keys hidden for staff)", () => {
    const legacy = JSON.stringify({
      provider: "OMT",
      service_type: "INTRA",
      omt_fee: 2,
      cost_usd: 1.5,
      profit_usd: 0.5,
      is_auto: false,
    });
    const staff = buildTransactionDetailsView(legacy, STAFF);
    expect(staff.details).toEqual([]);
    expect(staff.payment).toBeNull();
    expect(text(find(staff.other, "Provider")?.value)).toBe("OMT System");
    expect(text(find(staff.other, "Service type")?.value)).toBe("Intra");
    expect(text(find(staff.other, "OMT fee")?.value)).toBe("2");
    expect(text(find(staff.other, "Is auto")?.value)).toBe("No");
    expect(allLabels(staff.other)).not.toContain("Cost USD");
    expect(allLabels(staff.other)).not.toContain("Profit USD");
    expect(staff.isEmpty).toBe(false);

    const admin = buildTransactionDetailsView(legacy, ADMIN);
    expect(text(find(admin.other, "Cost USD")?.value)).toBe("$1.50");
    expect(text(find(admin.other, "Profit USD")?.value)).toBe("$0.50");
  });

  it("never pairs a legacy top-level number with the legacy `currency` key (a recharge's $9 card is not 9 LBP)", () => {
    // Shape of a real Alfa Gift row's legacy keys (visual check 2026-10-16):
    // `currency` is the price's currency, `amount` the card's dollar value.
    const view = buildTransactionDetailsView(
      JSON.stringify({ amount: 9, price: 850000, currency: "LBP" }),
      ADMIN,
    );
    expect(text(find(view.other, "Amount")?.value)).toBe("9");
    expect(text(find(view.other, "Price")?.value)).toBe("850,000");
  });

  it("keeps legacy keys separate from details and the snapshot", () => {
    const view = buildTransactionDetailsView(
      meta(omtSend, cashSnapshot, { item_key: "omt_send" }),
      ADMIN,
    );
    expect(view.other.map((r) => r.key)).toEqual(["item_key"]);
  });

  it.each([null, "", "{}", "not json", "[1,2]"])(
    "is empty (never throws) for metadata %p",
    (raw) => {
      const view = buildTransactionDetailsView(raw, ADMIN);
      expect(view.isEmpty).toBe(true);
      expect(view.details).toEqual([]);
      expect(view.other).toEqual([]);
      expect(view.payment).toBeNull();
    },
  );

  it("shows an unknown future kind's fields with the same renderer", () => {
    const view = buildTransactionDetailsView(
      JSON.stringify({
        details: { v: 2, kind: "drone_delivery", droneName: "Falcon", hops: 3 },
      }),
      ADMIN,
    );
    expect(view.kindLabel).toBe("Drone delivery");
    expect(text(find(view.details, "Drone name")?.value)).toBe("Falcon");
    expect(text(find(view.details, "Hops")?.value)).toBe("3");
  });
});
