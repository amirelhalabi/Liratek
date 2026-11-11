/**
 * cryptoServiceFields — 2 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 2).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import { createFinancialServiceSchema } from "@liratek/core";
import { buildCryptoServiceFields } from "../cryptoServiceFields";

function resetBetweenFiles() {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("cryptoServiceFields.lira366Note (LIRA-366)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-366 — the Binance form's existing Notes box is its typed note. The
   * ONE builder (walk-in send and session basket alike, rule 22) carries it
   * as `typedNote`; `referenceNumber` keeps the same text as before, so the
   * Binance History screen loses nothing. Blank → no key. Parsed through the
   * shared schema (rule 24). Rule 17: seen failing before the builder took it.
   */

  function build(typedNote: string) {
    return buildCryptoServiceFields({
      cryptoType: "SEND",
      amount: 100,
      commission: 2,
      clientId: 7,
      clientName: "Rana Aziz",
      reference: typedNote,
      typedNote,
      detailFields: { feePaidBy: "SENDER" },
    });
  }

  describe("buildCryptoServiceFields — typed note (LIRA-366)", () => {
    it("a typed note rides as typedNote and still as the reference", () => {
      const parsed = createFinancialServiceSchema.parse({
        ...build("rest on Monday"),
        payments: [],
      });
      expect(parsed.typedNote).toBe("rest on Monday");
      expect(parsed.referenceNumber).toBe("rest on Monday");
    });

    it("blank → no typedNote key", () => {
      expect("typedNote" in build("   ")).toBe(false);
    });
  });
});

describe("cryptoServiceFields", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Bug #4 (TRANSACTION_DETAIL_AUDIT §3) — a Binance send / cash-out added to a
   * customer session's basket keeps the "Set custom time" picked on the form,
   * exactly like the same send made on its own: both are built by ONE builder
   * (rule 22). Expected keys are checked against the shared schema (rule 24).
   */

  const PICKED = "2026-10-14T09:30:00.000Z";

  function build(transactionTime?: string) {
    return buildCryptoServiceFields({
      cryptoType: "SEND",
      amount: 100,
      commission: 2,
      clientId: 7,
      clientName: "Rana Aziz",
      reference: "wallet-1",
      detailFields: { feePaidBy: "SENDER" },
      transactionTime,
    });
  }

  describe("buildCryptoServiceFields — one Binance payload for both modes", () => {
    it("carries the picked time (the session basket item used to drop it)", () => {
      const fields = build(PICKED);
      expect(fields.transaction_time).toBe(PICKED);
      // The schema keeps it — never stripped on the way to the server.
      const parsed = createFinancialServiceSchema.parse({
        ...fields,
        payments: [],
      }) as { transaction_time?: string };
      expect(parsed.transaction_time).toBe(PICKED);
    });

    it("no time picked: the key is absent (booked now)", () => {
      expect("transaction_time" in build(undefined)).toBe(false);
    });

    it("keeps the other fields every Binance item carries", () => {
      expect(build(undefined)).toEqual({
        provider: "BINANCE",
        serviceType: "SEND",
        amount: 100,
        currency: "USDT",
        clientId: 7,
        clientName: "Rana Aziz",
        referenceNumber: "wallet-1",
        commission: 2,
        feePaidBy: "SENDER",
      });
    });
  });
});
