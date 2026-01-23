/**
 * App-specific shared types.
 *
 * These are the types used by the renderer and IPC payloads in this repo.
 * Keep them aligned with the actual database/DTO shapes used by the electron layer.
 */

export interface Product {
  id: number;
  barcode: string;
  name: string;
  category: string;
  cost_price: number;
  retail_price: number;
  stock_quantity: number;
  min_stock_level: number;
  image_url?: string;
  created_at?: string;
  is_active: number;
}

export interface Client {
  id: number;
  full_name: string;
  phone_number: string;
  notes?: string;
  whatsapp_opt_in: number; // SQLite stores booleans as 0/1
  created_at?: string;
}

export interface Expense {
  id?: number;
  description: string;
  category: string;
  expense_type: "Cash_Out" | "Non_Cash";
  amount_usd: number;
  amount_lbp: number;
  expense_date: string;
}

export interface CartItem extends Product {
  quantity: number;
  imei?: string;
}

export interface SaleItem {
  product_id: number;
  quantity: number;
  price: number;
  imei?: string;
}

export type PaymentMethod = "CASH" | "OMT" | "WHISH" | "BINANCE";
export type PaymentCurrencyCode = "USD" | "LBP";

export interface PaymentLine {
  method: PaymentMethod;
  currency_code: PaymentCurrencyCode;
  amount: number;
}

export interface SaleRequest {
  client_id: number | null;
  client_name?: string; // For auto-creation
  client_phone?: string; // Optional phone for auto-creation
  items: SaleItem[];
  total_amount: number;
  discount: number;
  final_amount: number;
  payment_usd: number;
  payment_lbp: number;
  payments?: PaymentLine[];
  change_given_usd?: number;
  change_given_lbp?: number;
  exchange_rate: number;
  drawer_name?: string; // Drawer assignment

  // Draft Support
  id?: number; // If present, updates existing sale/draft
  status?: "completed" | "draft" | "cancelled";
  note?: string;
}
