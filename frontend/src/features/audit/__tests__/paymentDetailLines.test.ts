/**
 * LIRA-304 T044 — payment-detail lines: one line per method + direction,
 * currencies joined, per-drawer split only when a line touched 2+ drawers.
 */
import { buildPaymentDetailLines } from "../paymentDetailLines";
import type { TransactionPaymentLeg } from "../cashFlow";

const leg = (
  direction: "in" | "out",
  method: string,
  currency: string,
  amount: number,
  drawer?: string,
): TransactionPaymentLeg => ({
  direction,
  method,
  currency_code: currency,
  amount,
  signed_amount: direction === "in" ? amount : -amount,
  ...(drawer ? { drawer_name: drawer } : {}),
});

const text = (l: ReturnType<typeof buildPaymentDetailLines>[number]) =>
  `${l.direction === "in" ? "In" : "Out"} — ${l.method}: ${l.amountText}` +
  (l.drawersText ? `  {${l.drawersText}}` : "");

describe("buildPaymentDetailLines", () => {
  it("merges currencies of one method into one line (the 10 Oct repayment)", () => {
    const lines = buildPaymentDetailLines([
      leg("in", "Cash", "USD", 115, "General"),
      leg("in", "Cash", "LBP", 200_000, "General"),
      leg("out", "Customer Account", "USD", 115),
      leg("out", "Customer Account", "LBP", 200_000),
    ]);
    expect(lines.map(text)).toEqual([
      "In — Cash: $115 + 200,000 LBP",
      "Out — Customer Account: $115 + 200,000 LBP",
    ]);
  });

  it("shows the per-drawer split when cash went to two drawers (basket checkout)", () => {
    const lines = buildPaymentDetailLines([
      leg("in", "Cash", "USD", 101, "OMT_System"),
      leg("in", "Cash", "USD", 33, "General"),
    ]);
    expect(lines.map(text)).toEqual([
      "In — Cash: $134  {$101 OMT Cash Drawer · $33 General}",
    ]);
  });

  it("splits per drawer per currency", () => {
    const lines = buildPaymentDetailLines([
      leg("in", "Cash", "USD", 101, "OMT_System"),
      leg("in", "Cash", "USD", 14, "General"),
      leg("in", "Cash", "LBP", 200_000, "General"),
    ]);
    expect(lines.map(text)).toEqual([
      "In — Cash: $115 + 200,000 LBP  {$101 OMT Cash Drawer · $14 + 200,000 LBP General}",
    ]);
  });

  it("keeps different methods and directions on separate lines", () => {
    const lines = buildPaymentDetailLines([
      leg("in", "Cash", "USD", 50, "General"),
      leg("in", "Whish Wallet", "USD", 20, "Whish_App"),
      leg("out", "Cash", "USD", 5, "General"),
    ]);
    expect(lines.map(text)).toEqual([
      "In — Cash: $50",
      "In — Whish Wallet: $20",
      "Out — Cash: $5",
    ]);
  });
});

describe("buildPaymentDetailLines — internal drawer moves (LIRA-304)", () => {
  it("a repayment whose cash all moved to the OMT Cash Drawer says so", () => {
    const lines = buildPaymentDetailLines(
      [
        leg("in", "Cash", "USD", 50, "General"),
        leg("out", "Customer Account", "USD", 50),
      ],
      [{ from: "General", to: "OMT_System", currency_code: "USD", amount: 50 }],
    );
    expect(lines.map(text)).toEqual([
      "In — Cash: $50  {$50 OMT Cash Drawer}",
      "Out — Customer Account: $50",
    ]);
  });

  it("the owner's example: $101 moved out of a $115 + 200,000 LBP cash payment", () => {
    const lines = buildPaymentDetailLines(
      [
        leg("in", "Cash", "USD", 115, "General"),
        leg("in", "Cash", "LBP", 200_000, "General"),
        leg("out", "Customer Account", "USD", 115),
        leg("out", "Customer Account", "LBP", 200_000),
      ],
      [{ from: "General", to: "OMT_System", currency_code: "USD", amount: 101 }],
    );
    expect(lines.map(text)).toEqual([
      "In — Cash: $115 + 200,000 LBP  {$14 + 200,000 LBP General · $101 OMT Cash Drawer}",
      "Out — Customer Account: $115 + 200,000 LBP",
    ]);
  });
});
