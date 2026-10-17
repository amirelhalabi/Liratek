import {
  formatReceipt58mm,
  formatReceipt80mm,
  getReceiptJSON,
  formatReceiptWhatsApp,
  buildWhatsAppLink,
  WHATSAPP_TEXT_MAX_ENCODED,
  type ReceiptData,
} from "../receiptFormatter";
import { addMonthsIso } from "../dateMath";

describe("Receipt Formatter", () => {
  const mockReceiptData: ReceiptData = {
    shop_name: "Test Shop",
    shop_phone: "70123456",
    shop_location: "Beirut, Lebanon",
    receipt_number: "RCP-123456789",
    client_name: "John Doe",
    client_phone: "03123456",
    items: [
      {
        name: "iPhone 15 Case",
        quantity: 1,
        price: 25.0,
        subtotal: 25.0,
      },
      {
        name: "Screen Protector",
        quantity: 2,
        price: 10.0,
        subtotal: 20.0,
      },
    ],
    subtotal: 45.0,
    discount: 5.0,
    total: 40.0,
    payment_usd: 50.0,
    payment_lbp: 0,
    change_usd: 10.0,
    change_lbp: 0,
    exchange_rate: 89500,
    timestamp: "2026-03-07T10:20:13Z",
    operator: "Staff",
  };

  describe("formatReceipt58mm", () => {
    it("should format a basic receipt correctly", () => {
      const result = formatReceipt58mm(mockReceiptData);
      expect(result).toContain("Test Shop");
      expect(result).toContain("Beirut, Lebanon");
      expect(result).toContain("70123456");
      expect(result).toContain("#RCP-123456789");
      expect(result).toContain("iPhone 15 Case");
      expect(result).toContain("$25.00");
      expect(result).toContain("Screen Protector");
      expect(result).toContain("2x$10.00");
      expect(result).toContain("TOTAL:");
      expect(result).toContain("$40.00");
      expect(result).toContain("3,580,000 LBP");
      expect(result).toContain("Powered by LiraTek");
    });

    it("should handle missing optional fields", () => {
      const minimalData: ReceiptData = {
        shop_name: "Minimal Shop",
        receipt_number: "RCP-MIN",
        items: [],
        subtotal: 0,
        discount: 0,
        total: 0,
        payment_usd: 0,
        payment_lbp: 0,
        change_usd: 0,
        change_lbp: 0,
        exchange_rate: 89500,
        timestamp: new Date().toISOString(),
      };
      const result = formatReceipt58mm(minimalData);
      expect(result).toContain("Minimal Shop");
      expect(result).not.toContain("Beirut, Lebanon");
      expect(result).not.toContain("Discount:");
    });

    it("should include IMEI if present", () => {
      const dataWithImei: ReceiptData = {
        ...mockReceiptData,
        items: [
          {
            ...mockReceiptData.items[0],
            imei: "123456789012345",
          },
        ],
      };
      const result = formatReceipt58mm(dataWithImei);
      expect(result).toContain("IMEI: 123456789012345");
    });

    it("computes 'Warranty until' from warranty_months + the receipt's own timestamp (owner decision #4)", () => {
      const dataWithWarranty: ReceiptData = {
        ...mockReceiptData,
        items: [
          {
            ...mockReceiptData.items[0],
            warranty_months: 12,
          },
        ],
      };
      const result = formatReceipt58mm(dataWithWarranty);
      const expectedDate = addMonthsIso(mockReceiptData.timestamp, 12);
      expect(result).toContain(`Warranty until: ${expectedDate}`);
    });

    it("prefers the stamped warranty_until over recomputing from warranty_months", () => {
      const dataWithBoth: ReceiptData = {
        ...mockReceiptData,
        items: [
          {
            ...mockReceiptData.items[0],
            warranty_months: 12,
            warranty_until: "2099-01-01",
          },
        ],
      };
      const result = formatReceipt58mm(dataWithBoth);
      expect(result).toContain("Warranty until: 2099-01-01");
      expect(result).not.toContain(
        `Warranty until: ${addMonthsIso(mockReceiptData.timestamp, 12)}`,
      );
    });

    it("prints no warranty line when the item has neither warranty field", () => {
      const result = formatReceipt58mm(mockReceiptData);
      expect(result).not.toContain("Warranty until");
    });
  });

  describe("formatReceipt80mm", () => {
    it("should format an 80mm receipt correctly", () => {
      const result = formatReceipt80mm(mockReceiptData);
      expect(result).toContain("Test Shop");
      expect(result).toContain("Beirut, Lebanon");
      expect(result).toContain("ITEM DETAILS");
      expect(result).toContain("iPhone 15 Case");
      expect(result).toContain("TOTAL DUE:");
      expect(result).toContain("3,580,000");
    });

    it("includes the warranty line too", () => {
      const dataWithWarranty: ReceiptData = {
        ...mockReceiptData,
        items: [
          {
            ...mockReceiptData.items[0],
            warranty_until: "2027-06-15",
          },
        ],
      };
      const result = formatReceipt80mm(dataWithWarranty);
      expect(result).toContain("Warranty until: 2027-06-15");
    });
  });
});

// LIRA-296 (T023 / T026, SF-3) — the shop's warranty terms print below the
// items only when a line carries a warranty; the saved receipt header prints
// under the shop name when it is set. Both widths.
describe("Receipt Formatter — warranty terms and header (LIRA-296)", () => {
  const base: ReceiptData = {
    shop_name: "Test Shop",
    receipt_number: "RCP-12",
    items: [{ name: "Cable", quantity: 1, price: 5, subtotal: 5 }],
    subtotal: 5,
    discount: 0,
    total: 5,
    payment_usd: 5,
    payment_lbp: 0,
    change_usd: 0,
    change_lbp: 0,
    exchange_rate: 89500,
    timestamp: "2026-10-10T10:00:00Z",
  };
  const TERMS = "Covers manufacturing faults only.";
  const withWarranty: ReceiptData = {
    ...base,
    warranty_terms: TERMS,
    items: [
      {
        name: "Earbuds",
        quantity: 1,
        price: 20,
        subtotal: 20,
        warranty_until: "2026-11-10",
      },
    ],
  };

  for (const [label, fmt, width] of [
    ["58mm", formatReceipt58mm, 42],
    ["80mm", formatReceipt80mm, 56],
  ] as const) {
    describe(label, () => {
      it("prints the terms when a line has a warranty", () => {
        const r = fmt(withWarranty);
        expect(r).toContain(TERMS);
        // Below the items: after the item name.
        expect(r.indexOf(TERMS)).toBeGreaterThan(r.indexOf("Earbuds"));
      });

      it("also when the warranty comes from warranty_months (live checkout)", () => {
        const r = fmt({
          ...base,
          warranty_terms: TERMS,
          items: [
            { name: "Case", quantity: 1, price: 5, subtotal: 5, warranty_months: 1 },
          ],
        });
        expect(r).toContain(TERMS);
      });

      it("prints no terms when no line has a warranty", () => {
        expect(fmt({ ...base, warranty_terms: TERMS })).not.toContain(TERMS);
      });

      it("wraps long terms to the paper width", () => {
        const long = "Warranty covers manufacturing faults only and excludes water damage, drops and opened devices.";
        const r = fmt({ ...withWarranty, warranty_terms: long });
        for (const lineText of r.split("\n")) {
          expect(lineText.length).toBeLessThanOrEqual(width);
        }
        expect(r.replace(/\s+/g, " ")).toContain(long);
      });

      it("prints the receipt header under the shop name when set", () => {
        const r = fmt({ ...base, header_text: "Open daily 9-9" });
        expect(r).toContain("Open daily 9-9");
        expect(r.indexOf("Open daily 9-9")).toBeGreaterThan(
          r.indexOf("Test Shop"),
        );
        expect(r.indexOf("Open daily 9-9")).toBeLessThan(r.indexOf("Cable"));
      });

      it("prints nothing extra when the header is empty", () => {
        expect(fmt({ ...base, header_text: "" })).toBe(fmt(base));
        expect(fmt({ ...base, header_text: "   " })).toBe(fmt(base));
      });
    });
  }
});

describe("LIRA-296 P3 — the serial line uses the category's label", () => {
  const base: ReceiptData = {
    shop_name: "Shop",
    shop_phone: "",
    shop_location: "",
    receipt_number: "RCP-1",
    client_name: "Walk-in Customer",
    client_phone: "",
    items: [
      {
        name: "ThinkPad",
        quantity: 1,
        price: 600,
        subtotal: 600,
        imei: "SN-001",
        serial_label: "Serial",
      },
    ],
    subtotal: 600,
    discount: 0,
    total: 600,
    payment_usd: 600,
    payment_lbp: 0,
    change_usd: 0,
    change_lbp: 0,
    exchange_rate: 89500,
    timestamp: "2026-10-10 10:00:00",
  } as ReceiptData;

  it("prints 'Serial:' for a Serial category on both widths", () => {
    expect(formatReceipt58mm(base)).toContain("Serial: SN-001");
    expect(formatReceipt80mm(base)).toContain("Serial: SN-001");
    expect(formatReceipt58mm(base)).not.toContain("IMEI: SN-001");
  });

  it("keeps 'IMEI:' when the item carries no label (older data)", () => {
    const { serial_label: _omit, ...withoutLabel } = base.items[0]!;
    void _omit;
    const old: ReceiptData = { ...base, items: [withoutLabel] };
    expect(formatReceipt58mm(old)).toContain("IMEI: SN-001");
  });
});

/**
 * LIRA-319 (owner 2026-10-13): an extra charge prints as its own
 * "Extra +$X" line after the discount slot; the total includes it.
 * Not proven failing-first (new field).
 */
describe("Receipt Formatter — extra charge (LIRA-319)", () => {
  const sale: ReceiptData = {
    shop_name: "Test Shop",
    receipt_number: "RCP-7",
    items: [{ name: "Cable", quantity: 1, price: 6, subtotal: 6 }],
    subtotal: 6,
    discount: 0,
    extra: 1,
    total: 7,
    payment_usd: 7,
    payment_lbp: 0,
    change_usd: 0,
    change_lbp: 0,
    exchange_rate: 89500,
    timestamp: "2026-10-13T10:00:00Z",
    operator: "Staff",
  };

  it("58mm: Subtotal $6.00, Extra +$1.00, TOTAL $7.00 — no Discount line", () => {
    const r = formatReceipt58mm(sale);
    expect(r).toMatch(/Subtotal:\s+\$6\.00/);
    expect(r).toMatch(/Extra:\s+\+\$1\.00/);
    expect(r).toMatch(/TOTAL:\s+\$7\.00/);
    expect(r).not.toContain("Discount:");
    expect(r.indexOf("Extra:")).toBeLessThan(r.indexOf("TOTAL:"));
  });

  it("80mm: Extra +$1.00 between Subtotal and TOTAL DUE", () => {
    const r = formatReceipt80mm(sale);
    expect(r).toMatch(/Extra:\s+\+\$1\.00/);
    expect(r.indexOf("Subtotal:")).toBeLessThan(r.indexOf("Extra:"));
    expect(r.indexOf("Extra:")).toBeLessThan(r.indexOf("TOTAL DUE:"));
  });

  it("JSON summary carries the extra", () => {
    const j = getReceiptJSON(sale) as { summary: { extra: number } };
    expect(j.summary.extra).toBe(1);
  });

  it("no extra (omitted or 0) prints no Extra line", () => {
    const { extra: _omit, ...without } = sale;
    void _omit;
    expect(formatReceipt58mm({ ...without, total: 6 })).not.toContain("Extra:");
    expect(formatReceipt80mm({ ...sale, extra: 0 })).not.toContain("Extra:");
  });
});

// ─── LIRA-333 T013 — the WhatsApp layout (contracts/whatsapp-message.md) ───

describe("formatReceiptWhatsApp (LIRA-333)", () => {
  const full: ReceiptData = {
    shop_name: "Corner Shop",
    shop_phone: "70 123 456",
    shop_location: "Hamra, Beirut",
    header_text: "Open 9 to 9",
    warranty_terms: "Warranty void if opened.",
    receipt_number: "RCP-42",
    client_name: "Ali",
    client_phone: "03 123 456",
    items: [
      {
        name: "Charger",
        quantity: 2,
        price: 10,
        subtotal: 20,
        imei: "356000000000001",
        serial_label: "Serial",
        warranty_until: "2027-04-10",
      },
      { name: "Cable", quantity: 1, price: 10, subtotal: 10 },
    ],
    subtotal: 30,
    discount: 0,
    extra: 2,
    total: 32,
    payment_usd: 11,
    payment_lbp: 89_000,
    gift_card_usd: 5,
    on_account_usd: 14,
    on_account_lbp: 0,
    change_usd: 1,
    change_lbp: 50_000,
    exchange_rate: 89_000,
    timestamp: "2026-10-10T08:15:00Z",
    note: "Thanks Ali",
  };

  it("lays out one fact per line, in the contract's order", () => {
    const dt = new Date(full.timestamp);
    const lines = formatReceiptWhatsApp(full).split("\n");
    expect(lines).toEqual([
      "*Corner Shop*",
      "Open 9 to 9",
      "Hamra, Beirut",
      "70 123 456",
      "",
      "Receipt: RCP-42",
      `Date: ${dt.toLocaleDateString()} ${dt.toLocaleTimeString()}`,
      "Client: Ali",
      "",
      "Charger — $20.00",
      "  2 × $10.00",
      "  Serial: 356000000000001",
      "  Warranty until: 2027-04-10",
      "Cable — $10.00",
      "Warranty void if opened.",
      "",
      "Subtotal: $30.00",
      "Extra: +$2.00",
      "*Total: $32.00*",
      `Total in LBP: ${(32 * 89_000).toLocaleString()} LBP`,
      "Paid USD: $11.00",
      `Paid LBP: ${(89_000).toLocaleString()}`,
      "Gift card: $5.00",
      "On account: $14.00",
      "Change: $1.00",
      `Change LBP: ${(50_000).toLocaleString()}`,
      "",
      "Thanks Ali",
      "Thank You!",
      "Powered by LiraTek • 81077357",
    ]);
  });

  it("omits the lines the paper receipt omits", () => {
    const text = formatReceiptWhatsApp({
      ...full,
      header_text: "",
      shop_location: "",
      shop_phone: "",
      items: [{ name: "Cable", quantity: 1, price: 10, subtotal: 10 }],
      extra: 0,
      discount: 0,
      total: 10,
      subtotal: 10,
      payment_usd: 10,
      payment_lbp: 0,
      gift_card_usd: 0,
      on_account_usd: 0,
      change_usd: 0,
      change_lbp: 0,
      note: "",
    });
    for (const absent of [
      "Subtotal",
      "Discount",
      "Extra",
      "Paid LBP",
      "Gift card",
      "On account",
      "Change",
      "Warranty",
      "×",
    ]) {
      expect(text).not.toContain(absent);
    }
    expect(text).toContain("Paid USD: $10.00");
  });

  it("never puts the account part inside Paid (FR-008)", () => {
    const lines = formatReceiptWhatsApp(full).split("\n");
    const paid = lines.filter((l) => l.startsWith("Paid"));
    expect(paid.join(" ")).not.toContain("14.00");
    expect(lines).toContain("On account: $14.00");
  });

  it("has no padding runs or fixed-width columns (FR-009)", () => {
    for (const line of formatReceiptWhatsApp(full).split("\n")) {
      expect(line).not.toMatch(/\S {3,}\S/);
      expect(line).not.toMatch(/ +$/);
      expect(line).not.toMatch(/^[=─═-]{5,}/);
    }
  });

  it("every $ figure equals the paper receipt's for the same data (SC-002)", () => {
    const dollars = (s: string) =>
      new Set(s.match(/\$\d[\d,]*\.\d{2}/g) ?? []);
    const paper = formatReceipt58mm(full);
    const wa = formatReceiptWhatsApp(full);
    expect([...dollars(wa)].sort()).toEqual([...dollars(paper)].sort());
    for (const lbp of [
      (89_000).toLocaleString(),
      (50_000).toLocaleString(),
      `${(32 * 89_000).toLocaleString()} LBP`,
    ]) {
      expect(paper).toContain(lbp);
      expect(wa).toContain(lbp);
    }
  });

  it("the paper receipt prints the gift card on its own line too", () => {
    expect(formatReceipt58mm(full)).toMatch(/Gift card:\s+\$5\.00/);
    expect(formatReceipt80mm(full)).toMatch(/Gift card:\s+\$5\.00/);
    expect(formatReceipt58mm({ ...full, gift_card_usd: 0 })).not.toContain(
      "Gift card",
    );
  });

  it("carries no cost, profit or supplier figure (FR-010)", () => {
    const text = formatReceiptWhatsApp(full).toLowerCase();
    for (const word of ["cost", "profit", "supplier", "margin"]) {
      expect(text).not.toContain(word);
    }
  });

  it("Arabic text survives the link's encoding", () => {
    const text = formatReceiptWhatsApp({
      ...full,
      shop_name: "محل الزاوية",
      items: [{ name: "شاحن سريع", quantity: 1, price: 10, subtotal: 10 }],
    });
    const url = buildWhatsAppLink("9613123456", text);
    const decoded = decodeURIComponent(url.split("?text=")[1]);
    expect(decoded).toBe(text);
    expect(decoded).toContain("*محل الزاوية*");
    expect(decoded).toContain("شاحن سريع — $10.00");
  });

  it("buildWhatsAppLink → https://wa.me/<digits>?text=<encoded>", () => {
    expect(buildWhatsAppLink("9613123456", "a b&c")).toBe(
      "https://wa.me/9613123456?text=a%20b%26c",
    );
  });

  it("ships a provisional cap until it is measured (T031)", () => {
    expect(WHATSAPP_TEXT_MAX_ENCODED).toBe(2000);
  });

  describe("shortening when over the cap (FR-011)", () => {
    const long: ReceiptData = {
      ...full,
      warranty_terms: "T".repeat(600),
      items: Array.from({ length: 40 }, (_, i) => ({
        name: `Long product name number ${i + 1} with details`,
        quantity: 2,
        price: 5,
        subtotal: 10,
        imei: `35600000000${String(i).padStart(4, "0")}`,
        serial_label: "IMEI",
        warranty_until: "2027-04-10",
      })),
    };

    it("stays under the cap and keeps totals, payment, account and change", () => {
      const text = formatReceiptWhatsApp(long);
      expect(encodeURIComponent(text).length).toBeLessThanOrEqual(
        WHATSAPP_TEXT_MAX_ENCODED,
      );
      for (const kept of [
        "*Total: $32.00*",
        "Paid USD: $11.00",
        "Gift card: $5.00",
        "On account: $14.00",
        "Change: $1.00",
        "(shortened — ask the shop for the full receipt)",
      ]) {
        expect(text).toContain(kept);
      }
      expect(text).not.toContain("T".repeat(600));
      expect(text).toMatch(/…and \d+ more items/);
    });

    it("drops warranty terms first, before touching the items", () => {
      const terms = "Warranty void if opened. ".repeat(8).trim();
      const withTerms = { ...full, warranty_terms: terms };
      const text = formatReceiptWhatsApp(withTerms, {
        maxEncoded:
          encodeURIComponent(formatReceiptWhatsApp(withTerms)).length - 1,
      });
      expect(text).not.toContain("Warranty void if opened.");
      expect(text).toContain("  Serial: 356000000000001");
      expect(text).toContain("(shortened — ask the shop for the full receipt)");
    });

    it("does not shorten a receipt that fits", () => {
      expect(formatReceiptWhatsApp(full)).not.toContain("shortened");
    });
  });
});
