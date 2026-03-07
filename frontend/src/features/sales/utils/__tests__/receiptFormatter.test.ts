import { formatReceipt58mm, formatReceipt80mm, type ReceiptData } from "../receiptFormatter";

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
  });
});
