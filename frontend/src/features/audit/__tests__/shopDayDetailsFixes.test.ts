/**
 * Fixes from the 2026-10-16 "shop day" test of the Transactions Details panel
 * and export (owner decision Q7: FULL readable labels). Every fixture is a
 * REAL row from that day (`../__fixtures__/shopDayRows.ts`, copied from
 * `GET /api/transactions/recent`), so the shapes are the ones the app writes
 * (rule 24).
 *
 * Written before the fixes and seen failing (rule 17).
 */
import {
  buildTransactionDetailsView,
  readableTitle,
  type DetailRow,
  type DetailValue,
  type TransactionDetailsView,
} from "../transactionDetailsView";
import { amountCellText, deriveRow } from "../rowDerived";
import {
  detailsLineText,
  paymentsSheetRows,
  type ExportContext,
} from "../transactionExport";
import { reversedTransactionId, rowBadges, rowStatusText } from "../rowBadges";
import { isReversibleRow, offersWholeVoidRefund } from "../actionGating";
import { shopDayRow } from "../__fixtures__/shopDayRows";
import type { TransactionRow } from "../hooks/useTransactionRows";

const METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  WHISH: "Whish",
};
const methodLabel = (code: string) => METHOD_LABELS[code] ?? code;

function viewOf(row: TransactionRow, isAdmin = true): TransactionDetailsView {
  return buildTransactionDetailsView(row.metadata_json, {
    isAdmin,
    methodLabel,
    row,
  });
}

function find(rows: DetailRow[], label: string): DetailRow | undefined {
  return rows.find((r) => r.label === label);
}
function text(value: DetailValue | undefined): string | undefined {
  return value?.kind === "text" ? value.text : undefined;
}
function detail(id: number, label: string, isAdmin = true) {
  return text(find(viewOf(shopDayRow(id), isAdmin).details, label)?.value);
}
function other(id: number, label: string, isAdmin = true) {
  return text(find(viewOf(shopDayRow(id), isAdmin).other, label)?.value);
}
function tableOf(id: number, label: string, isAdmin = true) {
  const v = find(viewOf(shopDayRow(id), isAdmin).details, label)?.value;
  if (v?.kind !== "table") throw new Error(`${label} is not a table`);
  return {
    headers: v.columns.map((c) => c.label),
    cell: (row: number, header: string) =>
      v.rows[row]?.[v.columns.findIndex((c) => c.label === header)],
  };
}

describe("1 — codes read as words", () => {
  it.each([
    [10898, "Fee paid by", "Deducted"],
    [10898, "Cashout method", "Cash"],
    [10903, "Direction", "Receive"],
    [10928, "Status", "Delivered and paid"],
    [10941, "Action", "Pay"],
    [10943, "Action", "Settle"],
    [10944, "Action", "Write off"],
    [10949, "Action", "Collect"],
    [10946, "Source", "Drawer"],
    [10945, "Category", "Other"],
    [10945, "Direction", "In"],
    [10908, "Type", "Credits"],
    [10911, "Carrier", "Alfa"],
    [10908, "Carrier", "MTC"],
    [10927, "Provider", "Whish App"],
  ])("#%s %s → %s", (id, label, expected) => {
    expect(detail(id, label)).toBe(expected);
  });

  it("a partner reads as its name with the mode in words", () => {
    expect(detail(10903, "Partner")).toBe("Smoke Partner 3225 (#6) · Through");
    expect(detail(10945, "Partner")).toBe("Flow Partner 7619 (#4) · Via");
  });

  it("a gift tier shows its label, not its key", () => {
    expect(detail(10911, "Gift tier")).toBe("7 GB");
  });

  it("refund unit flags are words", () => {
    const t = tableOf(10939, "Refund units");
    expect(t.cell(0, "Flags")).toBe("Defective");
  });

  it("kind titles are sentence case; the panel title too", () => {
    expect(viewOf(shopDayRow(10945)).kindLabel).toBe("Custom service");
    expect(readableTitle("CUSTOM SERVICE")).toBe("Custom service");
    expect(readableTitle("OMT SEND")).toBe("OMT send");
    expect(readableTitle("WHISH RECEIVE")).toBe("Whish receive");
    // Already readable titles are left alone.
    expect(readableTitle("Supplier Payment")).toBe("Supplier Payment");
  });

  it("a catalog item shows its label when it has one, else its key", () => {
    const row = shopDayRow(10913);
    const meta = JSON.parse(row.metadata_json!) as {
      details: { items: Record<string, unknown>[] };
    };
    // Today's row has no label (core is adding it): the key stays.
    const before = tableOf(10913, "Items");
    expect(before.cell(0, "Key")).toBe("Katsh/alfa/Prepaid/4.5");
    meta.details.items[0]!.label = "Alfa $4.50";
    row.metadata_json = JSON.stringify(meta);
    const v = find(viewOf(row).details, "Items")?.value;
    if (v?.kind !== "table") throw new Error("items not a table");
    const labels = v.columns.map((c) => c.label);
    expect(labels).not.toContain("Key");
    expect(v.rows[0]?.[labels.indexOf("Label")]).toBe("Alfa $4.50");
  });

  it.each([
    [10901, "Reference", "C2B-889120"],
    [10898, "Wallet / reference", "TRC20 tx 7f3a91c2"],
    [10935, "Ticket number", "LT-48213"],
    [10930, "From", "EUR"],
    [10930, "To", "LBP"],
    [10930, "Via", "USD"],
    [10895, "Payment currency", "USD"],
    [10941, "Note", "Partial settlement of Katsh float, handed to rep Georges"],
  ])("free text and codes people type stay verbatim: #%s %s", (id, l, v) => {
    expect(detail(id, l)).toBe(v);
  });

  it("drawer names stay as saved", () => {
    expect(other(10946, "From drawer")).toBe("General");
    expect(other(10946, "To drawer")).toBe("OMT_App");
  });

  it("an IMEI stays verbatim", () => {
    expect(tableOf(10895, "Items").cell(0, "IMEI")).toBe("356938035643809");
  });
});

describe("2 — dates read as dates", () => {
  it.each([
    [10933, "Expense date", "16 Oct 2026"],
    [10935, "Prize date", "16 Oct 2026"],
    [10928, "Warranty until", "16 Jan 2027"],
  ])("#%s %s → %s", (id, label, expected) => {
    expect(detail(id, label)).toBe(expected);
  });

  it("legacy date keys too", () => {
    expect(other(10933, "Expense date")).toBe("16 Oct 2026");
  });
});

describe("3 — every amount carries its currency, with its decimals", () => {
  it.each([
    [10901, "OMT fee", "$4.00"],
    [10903, "Whish fee", "$2.00"],
    [10925, "Provider fee", "$1.50"],
    [10927, "Fee", "$3.00"],
    [10933, "Bill amount", "$18.50"],
    [10932, "Sale amount", "500,000 LBP"],
    [10908, "Amount", "$6.00"],
    [10908, "Default price", "600,000 LBP"],
    [10911, "Amount", "$9.00"],
    [10898, "Amount USDT", "150.00 USDT"],
    [10930, "Amount in", "€50.00"],
    [10930, "Amount out", "5,162,000 LBP"],
    [10945, "Price", "$45.00"],
  ])("#%s %s → %s", (id, label, expected) => {
    expect(detail(id, label)).toBe(expected);
  });

  it("POS item prices are dollars", () => {
    const t = tableOf(10895, "Items");
    expect(t.cell(0, "Unit price")).toBe("$799.00");
    expect(t.cell(0, "Unit cost")).toBe("$690.00");
  });

  it("catalog item prices take the sale's currency mode", () => {
    expect(tableOf(10913, "Items").cell(0, "Unit price")).toBe("500,000 LBP");
  });

  it("a maintenance part's price is dollars", () => {
    expect(tableOf(10928, "Parts").cell(0, "Unit price")).toBe("$5.00");
  });

  it("payment lines, change and kept change use the same money format", () => {
    const p = viewOf(shopDayRow(10933)).payment!;
    expect(p.lines.map((l) => l.amount)).toEqual(["$20.00", "$1.00"]);
    expect(p.changeReturned).toBe("Cash $1.00");
    expect(p.kept).toBe("$0.50");
  });
});

describe("4 — rates", () => {
  it("a commission rate is a percentage, exactly", () => {
    expect(detail(10932, "Commission rate")).toBe("4.45%");
  });

  it("exchange rates are plain numbers with separators, never rounded", () => {
    const t = tableOf(10930, "Legs");
    expect(t.cell(0, "Rate")).toBe("1.16");
    expect(t.cell(1, "Rate")).toBe("89,000");
    expect(t.cell(1, "Market rate")).toBe("89,500");
    expect(detail(10930, "Payout rate")).toBe("89,000");

    const row = shopDayRow(10930);
    const meta = JSON.parse(row.metadata_json!) as {
      details: { payoutRate: number };
    };
    meta.details.payoutRate = 88512.3456;
    row.metadata_json = JSON.stringify(meta);
    expect(text(find(viewOf(row).details, "Payout rate")?.value)).toBe(
      "88,512.3456",
    );
  });
});

describe("5 — names instead of ids", () => {
  it("a supplier id shows the supplier's name", () => {
    const view = viewOf(shopDayRow(10941));
    expect(text(find(view.details, "Supplier")?.value)).toBe("Katsh (#27)");
    expect(find(view.details, "Supplier ID")).toBeUndefined();
  });

  it("a partner id shows the partner's name", () => {
    expect(detail(10943, "Partner")).toBe("Flow Partner 7619 (#4)");
    expect(detail(10944, "Partner")).toBe("Smoke Partner 3225 (#6)");
  });

  it("a client id in the legacy keys shows the client's name", () => {
    expect(other(10927, "Client")).toBe("Nour Khalil (#8939)");
  });
});

describe("6/7 — the Amount the table, panel and export share", () => {
  const amount = (id: number) => {
    const row = shopDayRow(id);
    return amountCellText(row, deriveRow(row));
  };

  it("a write-off / discount shows the amount forgiven, not —", () => {
    expect(amount(10944)).toBe("$15 forgiven");
    expect(amount(10938)).toBe("$5 forgiven");
  });

  it("an exchange shows what was given and what was got", () => {
    expect(amount(10930)).toBe("50 EUR → 5,162,000 LBP");
    expect(amount(10929)).toBe("$100 → 8,850,000 LBP");
  });

  it("other rows are unchanged", () => {
    expect(amount(10895)).toBe("$823");
    expect(amount(10934)).toBe("−$26");
  });
});

describe("9 — reversals' money is in the Payments sheet", () => {
  const ctx: ExportContext = { isAdmin: false, methodLabel };

  it("a void lists its legs as kind 'reversal'", () => {
    const rows = paymentsSheetRows([shopDayRow(10934)], ctx).map((r) =>
      r.slice(3),
    );
    expect(rows).toEqual([
      ["reversal", "Out", "Cash", "LBP", "2,400,000 LBP", ""],
      ["reversal", "In", "Cash", "LBP", "90,000 LBP", ""],
    ]);
  });

  it("an item refund (no reverses_id) too, with currency decimals", () => {
    const rows = paymentsSheetRows([shopDayRow(10939)], ctx).map((r) =>
      r.slice(3),
    );
    expect(rows).toEqual([
      ["reversal", "Out", "Cash", "USD", "$679.59", ""],
      ["reversal", "Out", "Cash", "LBP", "11,164,642 LBP", ""],
      ["reversal", "In", "Cash", "USD", "$5.83", ""],
      ["reversal", "In", "Cash", "LBP", "19,417 LBP", ""],
    ]);
  });

  it("the panel shows the same lines", () => {
    const p = viewOf(shopDayRow(10934), false).payment;
    expect(p?.lines.map((l) => `${l.direction} ${l.amount}`)).toEqual([
      "Out 2,400,000 LBP",
      "In 90,000 LBP",
    ]);
  });

  it("a normal sale is not a reversal", () => {
    const kinds = paymentsSheetRows([shopDayRow(10895)], ctx).map((r) => r[3]);
    expect(kinds).not.toContain("reversal");
  });
});

/** The real rows plus the link fields core's `getRecent` now returns
 *  (TransactionRepository `item_refund_of_id` / `item_refunded` /
 *  `item_refund_remaining`, shop-day 2026-10-16 core fix) — the fixtures
 *  were captured before that landed. */
const itemRefund = () => ({ ...shopDayRow(10939), item_refund_of_id: 10895 });
const partlyRefundedSale = () => ({
  ...shopDayRow(10895),
  item_refunded: true,
  item_refund_remaining: true,
});
const itemFullyRefundedSale = () => ({
  ...shopDayRow(10895),
  item_refunded: true,
  item_refund_remaining: false,
});

describe("10 — item refunds link to their sale (export)", () => {
  const ctx: ExportContext = { isAdmin: false, methodLabel };

  it("the export says what an item refund reverses", () => {
    expect(detailsLineText(itemRefund(), ctx)).toContain("Reverses: #10895");
  });

  it("the export marks a partly refunded original", () => {
    expect(detailsLineText(partlyRefundedSale(), ctx)).toContain(
      "Status: Partly refunded",
    );
  });

  it("…and one refunded item by item down to nothing as Refunded", () => {
    expect(detailsLineText(itemFullyRefundedSale(), ctx)).toContain(
      "Status: Refunded",
    );
  });
});

describe("10 — PARTLY REFUNDED and the item refund's link (rowBadges)", () => {
  const labels = (row: TransactionRow) => rowBadges(row).map((b) => b.label);

  it("an item refund (reverses_id null) links to its sale", () => {
    expect(reversedTransactionId(itemRefund())).toBe(10895);
    expect(labels(itemRefund())).toContain("↩ #10895");
  });

  it("a whole void still links by reverses_id", () => {
    expect(reversedTransactionId(shopDayRow(10934))).toBe(10896);
  });

  it("an item-refunded sale with quantity left is PARTLY REFUNDED", () => {
    expect(labels(partlyRefundedSale())).toEqual(["PARTLY REFUNDED"]);
    expect(rowStatusText(partlyRefundedSale())).toBe("Partly refunded");
  });

  it("every line refunded item by item reads REFUNDED", () => {
    expect(labels(itemFullyRefundedSale())).toEqual(["REFUNDED"]);
    expect(rowStatusText(itemFullyRefundedSale())).toBe("Refunded");
  });

  it("a sale with no item refund gets no tag", () => {
    expect(labels({ ...shopDayRow(10895), item_refunded: false })).toEqual([]);
  });
});

describe("10 — an item-refunded sale offers no whole Void / Refund", () => {
  it("the whole Void / Refund pair is gone once a line was item-refunded", () => {
    expect(offersWholeVoidRefund(shopDayRow(10895))).toBe(true);
    expect(offersWholeVoidRefund(partlyRefundedSale())).toBe(false);
    expect(offersWholeVoidRefund(itemFullyRefundedSale())).toBe(false);
  });

  it("…but the row stays reversible, so a session sale keeps 'Refund item'", () => {
    expect(isReversibleRow(partlyRefundedSale())).toBe(true);
  });
});

describe("payout change and wallet top-up keys (core follow-ups)", () => {
  const ctx: ExportContext = { isAdmin: false, methodLabel };

  it("on a payout, change that came back to the shop is 'Change received'", () => {
    const p = viewOf(shopDayRow(10933)).payment!;
    expect(p.changeLabel).toBe("Change received");
    const rows = paymentsSheetRows([shopDayRow(10933)], ctx).map((r) =>
      r.slice(3),
    );
    expect(rows).toContainEqual([
      "change received",
      "In",
      "Cash",
      "USD",
      "$1.00",
      "",
    ]);
  });

  it("on a sale / send, change handed back stays 'Change returned'", () => {
    expect(viewOf(shopDayRow(10901)).payment!.changeLabel).toBe(
      "Change returned",
    );
    const rows = paymentsSheetRows([shopDayRow(10901)], ctx).map((r) =>
      r.slice(3),
    );
    expect(rows).toContainEqual([
      "change returned",
      "Out",
      "Cash",
      "USD",
      "$6.00",
      "",
    ]);
  });

  it("a wallet top-up's amount, currency and drawers read clearly", () => {
    // 10946 as core now saves it (amount / currency / drawers added to
    // `details`, shop-day core fix).
    const row = shopDayRow(10946);
    const meta = JSON.parse(row.metadata_json!) as {
      details: Record<string, unknown>;
    };
    Object.assign(meta.details, {
      amount: 15,
      currency: "USD",
      sourceDrawer: "General",
      destDrawer: "OMT_App",
    });
    row.metadata_json = JSON.stringify(meta);
    const d = viewOf(row).details;
    expect(text(find(d, "Amount")?.value)).toBe("$15.00");
    expect(text(find(d, "Currency")?.value)).toBe("USD");
    expect(text(find(d, "From drawer")?.value)).toBe("General");
    expect(text(find(d, "To drawer")?.value)).toBe("OMT_App");
  });
});

describe("advisor follow-ups: who kept the change, Binance fee currency", () => {
  it("on a payout the change not handed back was kept by the vendor, not the shop", () => {
    expect(viewOf(shopDayRow(10933)).payment!.keptLabel).toBe(
      "Change kept by them",
    );
    const rows = paymentsSheetRows([shopDayRow(10933)], {
      isAdmin: false,
      methodLabel,
    }).map((r) => r[3]);
    expect(rows).toContain("kept by them");
  });

  it("on an exchange the shop kept the change", () => {
    expect(viewOf(shopDayRow(10929)).payment!.keptLabel).toBe(
      "Change kept by the shop",
    );
  });

  it("a Binance fee is in dollars (core books it in USD)", () => {
    expect(detail(10898, "Fee")).toBe("$3.00");
    expect(detail(10898, "Amount USDT")).toBe("150.00 USDT");
  });
});
