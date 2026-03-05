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
  shop_phone?: string;
  shop_location?: string;
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
  /** Currency symbol for the primary currency (default: "$") */
  currency_symbol?: string;
}

/**
 * Format receipt for 58mm thermal printer (default)
 */
export function formatReceipt58mm(data: ReceiptData): string {
  const width = 38; // wider fit for bolder, more readable receipts
  const sym = data.currency_symbol ?? "$";

  const padCenter = (text: string, char = " "): string => {
    const padding = Math.max(0, width - text.length);
    const left = Math.floor(padding / 2);
    const right = padding - left;
    return char.repeat(left) + text + char.repeat(right);
  };

  let receipt = "";

  // Header
  receipt += padCenter("=".repeat(width)) + "\n";
  receipt += padCenter(data.shop_name) + "\n";
  if (data.shop_location) {
    receipt += padCenter(data.shop_location) + "\n";
  }
  if (data.shop_phone) {
    receipt += padCenter(data.shop_phone) + "\n";
  }
  receipt += padCenter("=".repeat(width)) + "\n";

  // Receipt Info — date+time on one line
  const dt = new Date(data.timestamp);
  receipt += `#${data.receipt_number}\n`;
  receipt += `${dt.toLocaleDateString()} ${dt.toLocaleTimeString()}\n`;

  // Client Info (if available)
  if (data.client_name) {
    receipt += `${data.client_name}`;
    if (data.client_phone) receipt += ` ${data.client_phone}`;
    receipt += "\n";
  }

  // Items — single line per item: name  qty x price
  receipt += "-".repeat(width) + "\n";

  data.items.forEach((item) => {
    const priceStr = `${sym}${item.subtotal.toFixed(2)}`;
    const qtyPrice = `${item.quantity}x${sym}${item.price.toFixed(2)}`;
    // Available space for name = width - priceStr.length - 1 (space)
    const nameWidth = Math.max(8, width - priceStr.length - 1);
    const itemName =
      item.name.length > nameWidth
        ? item.name.substring(0, nameWidth)
        : item.name;

    // First line: name left-aligned, subtotal right-aligned
    receipt += itemName;
    receipt += " ".repeat(
      Math.max(1, width - itemName.length - priceStr.length),
    );
    receipt += priceStr + "\n";

    // Qty x unit-price on same or next mini-line if needed
    if (item.quantity > 1) {
      receipt += `  ${qtyPrice}\n`;
    }

    if (item.imei) {
      receipt += `  IMEI: ${item.imei}\n`;
    }
  });

  receipt += "-".repeat(width) + "\n";

  // Totals
  const fmtLine = (label: string, value: string) => {
    const gap = Math.max(1, width - label.length - value.length);
    return label + " ".repeat(gap) + value + "\n";
  };

  if (data.discount > 0) {
    receipt += fmtLine("Subtotal:", `${sym}${data.subtotal.toFixed(2)}`);
    receipt += fmtLine("Discount:", `-${sym}${data.discount.toFixed(2)}`);
  }
  receipt += fmtLine("TOTAL:", `${sym}${data.total.toFixed(2)}`);

  const lbpTotal = data.total * data.exchange_rate;
  if (lbpTotal > 0) {
    const lbpStr = `${lbpTotal.toLocaleString()} LBP`;
    receipt += lbpStr.padStart(width, " ") + "\n";
  }

  // Payment
  receipt += "-".repeat(width) + "\n";
  receipt += fmtLine("Paid USD:", `${sym}${data.payment_usd.toFixed(2)}`);

  if (data.payment_lbp > 0) {
    receipt += fmtLine("Paid LBP:", `${data.payment_lbp.toLocaleString()}`);
  }

  if (data.change_usd > 0) {
    receipt += fmtLine("Change:", `${sym}${data.change_usd.toFixed(2)}`);
  }
  if (data.change_lbp > 0) {
    receipt += fmtLine("Change LBP:", `${data.change_lbp.toLocaleString()}`);
  }

  receipt += padCenter("=".repeat(width)) + "\n";
  if (data.note) {
    receipt += padCenter(data.note) + "\n";
  }
  receipt += padCenter("Thank You!") + "\n";
  receipt += padCenter("Powered by LiraTek • 81077357") + "\n";
  receipt += padCenter("=".repeat(width)) + "\n";

  return receipt;
}

/**
 * Format receipt for 80mm thermal printer
 */
export function formatReceipt80mm(data: ReceiptData): string {
  const width = 56; // 80mm width in characters
  const sym = data.currency_symbol ?? "$";

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
  if (data.shop_location) {
    receipt += padCenter(data.shop_location) + "\n";
  }
  if (data.shop_phone) {
    receipt += padCenter(data.shop_phone) + "\n";
  }
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
    receipt += `${sym}${item.subtotal.toFixed(2)}\n`;
    if (item.imei) {
      receipt += `  IMEI: ${item.imei}\n`;
    }
  });

  receipt += "─".repeat(width) + "\n";

  // Totals
  receipt += padRight("Subtotal:", 46) + `${sym}${data.subtotal.toFixed(2)}\n`;
  if (data.discount > 0) {
    receipt +=
      padRight("Discount:", 46) + `-${sym}${data.discount.toFixed(2)}\n`;
  }
  receipt += padRight("TOTAL DUE:", 46) + `${sym}${data.total.toFixed(2)}\n`;
  receipt +=
    padRight("(LBP Equivalent):", 46) +
    `${(data.total * data.exchange_rate).toLocaleString()}\n`;
  receipt += "\n";

  // Payment Info
  receipt += "PAYMENT METHOD\n";
  receipt += "─".repeat(width) + "\n";
  receipt +=
    padRight("USD Received:", 46) + `${sym}${data.payment_usd.toFixed(2)}\n`;
  if (data.payment_lbp > 0) {
    receipt +=
      padRight("LBP Received:", 46) + `${data.payment_lbp.toLocaleString()}\n`;
    receipt +=
      padRight(`(@ ${data.exchange_rate}/USD)`, 46) +
      `${sym}${(data.payment_lbp / data.exchange_rate).toFixed(2)}\n`;
  }
  receipt +=
    padRight("Change - USD:", 46) + `${sym}${data.change_usd.toFixed(2)}\n`;
  if (data.change_lbp > 0) {
    receipt +=
      padRight("Change - LBP:", 46) + `${data.change_lbp.toLocaleString()}\n`;
  }

  receipt += "\n" + padCenter("═".repeat(width)) + "\n";
  if (data.note) {
    receipt += padCenter(data.note) + "\n";
  }
  receipt += padCenter("✓ THANK YOU FOR YOUR BUSINESS ✓") + "\n";
  receipt += padCenter("Powered by LiraTek • 81077357") + "\n";
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
