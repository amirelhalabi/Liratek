/**
 * Receipt Formatter Utility
 * Generates receipt data for thermal printer (58mm and 80mm widths)
 */

export interface ReceiptItem {
  name: string;
  quantity: number;
  price: number;
  subtotal: number;
  imei?: string | null;
}

export interface ReceiptData {
  shop_name: string;
  receipt_number: string;
  client_name?: string;
  client_phone?: string;
  items: ReceiptItem[];
  subtotal: number;
  discount: number;
  total: number;
  payment_usd: number;
  payment_lbp: number;
  change_usd: number;
  change_lbp: number;
  exchange_rate: number;
  timestamp: string;
  operator?: string;
  note?: string;
}

/**
 * Format receipt for 58mm thermal printer (default)
 */
export function formatReceipt58mm(data: ReceiptData): string {
  const width = 40; // 58mm width in characters (approx 40 chars)

  const padCenter = (text: string, char = " "): string => {
    const padding = Math.max(0, width - text.length);
    const left = Math.floor(padding / 2);
    const right = padding - left;
    return char.repeat(left) + text + char.repeat(right);
  };

  const padRight = (text: string, width: number, char = " "): string => {
    return (text + char.repeat(width)).slice(0, width);
  };

  let receipt = "";

  // Header
  receipt += padCenter("=".repeat(width)) + "\n";
  receipt += padCenter(data.shop_name) + "\n";
  receipt += padCenter("RECEIPT") + "\n";
  receipt += padCenter("=".repeat(width)) + "\n";
  receipt += "\n";

  // Receipt Info
  receipt += `Receipt #: ${data.receipt_number}\n`;
  receipt += `Date: ${new Date(data.timestamp).toLocaleDateString()}\n`;
  receipt += `Time: ${new Date(data.timestamp).toLocaleTimeString()}\n`;
  receipt += "\n";

  // Client Info (if available)
  if (data.client_name) {
    receipt += `Client: ${data.client_name}\n`;
    if (data.client_phone) {
      receipt += `Phone: ${data.client_phone}\n`;
    }
    receipt += "\n";
  }

  // Items
  receipt += "ITEMS\n";
  receipt += "-".repeat(width) + "\n";
  // Align "Price" header so "P" aligns with "$" in amounts below
  receipt += padRight("Item", 20) + padRight("Qty", 6) + " ".repeat(6) + "Price\n";
  receipt += "-".repeat(width) + "\n";

  data.items.forEach((item) => {
    // Item name (wrap if too long)
    const itemName = item.name.substring(0, 20);
    const priceStr = `$${item.price.toFixed(2)}`;
    const subtotalStr = `$${item.subtotal.toFixed(2)}`;
    
    receipt += padRight(itemName, 20);
    receipt += padRight(item.quantity.toString(), 6);
    receipt += priceStr.padStart(14, " ") + "\n";
    
    if (item.imei) {
      receipt += `  IMEI: ${item.imei}\n`;
    }
    
    receipt += padRight("", 26); // 20 + 6 for item name and qty columns
    receipt += subtotalStr.padStart(14, " ") + "\n";
  });

  receipt += "-".repeat(width) + "\n";

  // Totals (right-align amounts to width of 40)
  const subtotalStr = `$${data.subtotal.toFixed(2)}`;
  const totalStr = `$${data.total.toFixed(2)}`;
  const lbpStr = `≈ ${(data.total * data.exchange_rate).toLocaleString()} LBP`;
  
  receipt += "Subtotal:" + " ".repeat(width - 9 - subtotalStr.length) + subtotalStr + "\n";
  if (data.discount > 0) {
    const discountStr = `-$${data.discount.toFixed(2)}`;
    receipt += "Discount:" + " ".repeat(width - 9 - discountStr.length) + discountStr + "\n";
  }
  receipt += "TOTAL:" + " ".repeat(width - 6 - totalStr.length) + totalStr + "\n";
  receipt += lbpStr.padStart(width, " ") + "\n";
  receipt += "\n";

  // Payment
  receipt += "PAYMENT\n";
  receipt += "-".repeat(width) + "\n";
  
  const paidUsdStr = `$${data.payment_usd.toFixed(2)}`;
  const changeUsdStr = `$${data.change_usd.toFixed(2)}`;
  
  receipt += "Paid USD:" + " ".repeat(width - 9 - paidUsdStr.length) + paidUsdStr + "\n";
  
  if (data.payment_lbp > 0) {
    const paidLbpStr = `${data.payment_lbp.toLocaleString()}`;
    receipt += "Paid LBP:" + " ".repeat(width - 9 - paidLbpStr.length) + paidLbpStr + "\n";
    
    const rateUsdStr = `$${(data.payment_lbp / data.exchange_rate).toFixed(2)}`;
    receipt += "(@ Rate):" + " ".repeat(width - 9 - rateUsdStr.length) + rateUsdStr + "\n";
  }
  
  receipt += "Change USD:" + " ".repeat(width - 11 - changeUsdStr.length) + changeUsdStr + "\n";
  
  if (data.change_lbp > 0) {
    const changeLbpStr = `${data.change_lbp.toLocaleString()} LBP`;
    receipt += "Change LBP:" + " ".repeat(width - 11 - changeLbpStr.length) + changeLbpStr + "\n";
  }

  receipt += "\n" + padCenter("=".repeat(width)) + "\n";
  if (data.note) {
    receipt += padCenter(data.note) + "\n";
  }
  receipt += padCenter("Thank You!") + "\n";
  receipt += padCenter("=".repeat(width)) + "\n";

  return receipt;
}

/**
 * Format receipt for 80mm thermal printer
 */
export function formatReceipt80mm(data: ReceiptData): string {
  const width = 56; // 80mm width in characters

  const padCenter = (text: string): string => {
    const padding = Math.max(0, width - text.length);
    const left = Math.floor(padding / 2);
    const right = padding - left;
    return " ".repeat(left) + text + " ".repeat(right);
  };

  const padRight = (text: string, w: number): string => {
    return (text + " ".repeat(w)).slice(0, w);
  };

  let receipt = "";

  // Header
  receipt += padCenter("═".repeat(width)) + "\n";
  receipt += padCenter(data.shop_name) + "\n";
  receipt += padCenter("═ RECEIPT ═") + "\n";
  receipt += padCenter("═".repeat(width)) + "\n";
  receipt += "\n";

  // Receipt Info
  receipt += `Receipt #: ${data.receipt_number}`.padEnd(width) + "\n";
  receipt +=
    `Date: ${new Date(data.timestamp).toLocaleDateString()}  Time: ${new Date(data.timestamp).toLocaleTimeString()}`.padEnd(
      width,
    ) + "\n";
  receipt += "\n";

  // Client Info
  if (data.client_name) {
    receipt += `Client: ${data.client_name}`.padEnd(width) + "\n";
    if (data.client_phone) {
      receipt += `Phone: ${data.client_phone}`.padEnd(width) + "\n";
    }
    receipt += "\n";
  }

  // Items Header
  receipt += "ITEM DETAILS\n";
  receipt += "─".repeat(width) + "\n";
  receipt += padRight("Item", 28) + padRight("Qty", 8) + "Amount\n";
  receipt += "─".repeat(width) + "\n";

  // Items
  data.items.forEach((item) => {
    const itemName = item.name.substring(0, 28);
    receipt += padRight(itemName, 28);
    receipt += padRight(item.quantity.toString(), 8);
    receipt += `$${item.subtotal.toFixed(2)}\n`;
    if (item.imei) {
      receipt += `  IMEI: ${item.imei}\n`;
    }
  });

  receipt += "─".repeat(width) + "\n";

  // Totals
  receipt += padRight("Subtotal:", 46) + `$${data.subtotal.toFixed(2)}\n`;
  if (data.discount > 0) {
    receipt += padRight("Discount:", 46) + `-$${data.discount.toFixed(2)}\n`;
  }
  receipt += padRight("TOTAL DUE:", 46) + `$${data.total.toFixed(2)}\n`;
  receipt +=
    padRight("(LBP Equivalent):", 46) +
    `${(data.total * data.exchange_rate).toLocaleString()}\n`;
  receipt += "\n";

  // Payment Info
  receipt += "PAYMENT METHOD\n";
  receipt += "─".repeat(width) + "\n";
  receipt +=
    padRight("USD Received:", 46) + `$${data.payment_usd.toFixed(2)}\n`;
  if (data.payment_lbp > 0) {
    receipt +=
      padRight("LBP Received:", 46) + `${data.payment_lbp.toLocaleString()}\n`;
    receipt +=
      padRight(`(@ ${data.exchange_rate}/USD)`, 46) +
      `$${(data.payment_lbp / data.exchange_rate).toFixed(2)}\n`;
  }
  receipt += padRight("Change - USD:", 46) + `$${data.change_usd.toFixed(2)}\n`;
  if (data.change_lbp > 0) {
    receipt +=
      padRight("Change - LBP:", 46) + `${data.change_lbp.toLocaleString()}\n`;
  }

  receipt += "\n" + padCenter("═".repeat(width)) + "\n";
  if (data.note) {
    receipt += padCenter(data.note) + "\n";
  }
  receipt += padCenter("✓ THANK YOU FOR YOUR BUSINESS ✓") + "\n";
  receipt += padCenter("═".repeat(width)) + "\n";

  return receipt;
}

/**
 * Return receipt as JSON (for future API/network printing)
 */
export function getReceiptJSON(data: ReceiptData): Record<string, unknown> {
  return {
    receipt_number: data.receipt_number,
    shop_name: data.shop_name,
    client: {
      name: data.client_name || "Walk-in",
      phone: data.client_phone || null,
    },
    timestamp: data.timestamp,
    items: data.items,
    summary: {
      subtotal: data.subtotal,
      discount: data.discount,
      total: data.total,
      total_lbp: data.total * data.exchange_rate,
    },
    payment: {
      paid_usd: data.payment_usd,
      paid_lbp: data.payment_lbp,
      change_usd: data.change_usd,
      change_lbp: data.change_lbp,
      exchange_rate: data.exchange_rate,
    },
    note: data.note || null,
    operator: data.operator || "System",
  };
}
