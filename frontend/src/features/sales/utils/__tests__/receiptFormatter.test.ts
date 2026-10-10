import {
  formatReceipt58mm,
  formatReceipt80mm,
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
