/**
 * LIRA-333 T032 (FR-022) — "Send on WhatsApp" is offered for POS sales only
 * in this change. Money transfers (OMT/Whish system and app), Binance and
 * debt repayments must NOT get it, and a later phase that widens it must
 * gate it with the SAME rule that decides "Print" (`isReceiptableTransaction`),
 * never a new list.
 *
 * Asserted on the import graph: the button may be imported only by the two
 * sale-only screens (the sale details window and the post-sale strip), OR by
 * a file that also imports the receipt gating rule. A new screen that adds
 * the button without the gate fails here.
 */
import fs from "node:fs";
import path from "node:path";
import { isReceiptableTransaction } from "../receiptGating";

const SRC = path.join(__dirname, "../../..");

const SALE_ONLY_IMPORTERS = new Set([
  "features/sales/pages/POS/components/SaleDetailModal.tsx",
  "features/sales/pages/POS/components/SaleCompletedStrip.tsx",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "__tests__" && e.name !== "node_modules") walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".d.ts")) {
      out.push(p);
    }
  }
  return out;
}

describe("WhatsApp receipt scope (FR-022)", () => {
  it("the gating rule still refuses transfers, Binance and repayments", () => {
    for (const provider of ["OMT", "WHISH", "OMT_APP", "BINANCE"]) {
      expect(
        isReceiptableTransaction({ type: "FINANCIAL_SERVICE", provider }),
      ).toBe(false);
    }
    expect(isReceiptableTransaction({ type: "DEBT_REPAYMENT" })).toBe(false);
  });

  it("SendOnWhatsAppButton is reachable only from sale-only screens or behind the gate", () => {
    const importers = walk(SRC)
      .filter((f) =>
        /from\s+["'][^"']*\/SendOnWhatsAppButton["']/.test(
          fs.readFileSync(f, "utf8"),
        ),
      )
      .map((f) => path.relative(SRC, f).split(path.sep).join("/"));

    // the premise: the scan does find the real importers
    expect(importers).toEqual(expect.arrayContaining([...SALE_ONLY_IMPORTERS]));

    const ungated = importers.filter(
      (f) =>
        !SALE_ONLY_IMPORTERS.has(f) &&
        !/receiptGating/.test(fs.readFileSync(path.join(SRC, f), "utf8")),
    );
    expect(ungated).toEqual([]);
  });
});
