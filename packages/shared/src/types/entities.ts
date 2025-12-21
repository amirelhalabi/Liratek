/**
 * Core entity types shared between frontend and backend.
 * These represent the database models.
 */

// =============================================================================
// Base Types
// =============================================================================

/** SQLite boolean representation (0 or 1) */
export type SQLiteBoolean = 0 | 1;

/** ISO 8601 date string */
export type ISODateString = string;

/** Currency codes supported by the system */
export type CurrencyCode = "USD" | "LBP" | "EUR";

/** User roles */
export type UserRole = "admin" | "cashier";

/** Drawer identifiers */
export type DrawerId = "drawer1" | "drawer2";

// =============================================================================
// User Entity
// =============================================================================

export interface User {
  id: number;
  username: string;
  password_hash: string;
  role: UserRole;
  is_active: SQLiteBoolean;
  created_at: ISODateString;
  updated_at: ISODateString;
}

/** User without sensitive password hash */
export type SafeUser = Omit<User, "password_hash">;

// =============================================================================
// Product Entity
// =============================================================================

export interface Product {
  id: number;
  sku: string;
  name: string;
  category: string;
  cost_usd: number;
  price_usd: number;
  price_lbp: number;
  quantity: number;
  reorder_level: number;
  is_active: SQLiteBoolean;
  created_at: ISODateString;
  updated_at: ISODateString;
}

// =============================================================================
// Client Entity
// =============================================================================

export interface Client {
  id: number;
  name: string;
  phone: string | null;
  whatsapp_opt_in: SQLiteBoolean;
  notes: string | null;
  is_active: SQLiteBoolean;
  created_at: ISODateString;
  updated_at: ISODateString;
}

// =============================================================================
// Sale Entity
// =============================================================================

export interface Sale {
  id: number;
  drawer_id: DrawerId;
  client_id: number | null;
  subtotal_usd: number;
  discount_usd: number;
  total_usd: number;
  payment_method: string;
  amount_paid_usd: number;
  amount_paid_lbp: number;
  change_usd: number;
  change_lbp: number;
  cashier_id: number;
  created_at: ISODateString;
}

export interface SaleItem {
  id: number;
  sale_id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  unit_price_usd: number;
  subtotal_usd: number;
  created_at: ISODateString;
}

// =============================================================================
// Debt Entity
// =============================================================================

export interface Debt {
  id: number;
  client_id: number;
  sale_id: number | null;
  original_amount_usd: number;
  remaining_amount_usd: number;
  status: "active" | "partial" | "paid";
  notes: string | null;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface DebtPayment {
  id: number;
  debt_id: number;
  amount_usd: number;
  payment_method: string;
  notes: string | null;
  created_at: ISODateString;
}

// =============================================================================
// Exchange Entity
// =============================================================================

export interface ExchangeRate {
  id: number;
  from_currency: CurrencyCode;
  to_currency: CurrencyCode;
  rate: number;
  effective_date: ISODateString;
  created_at: ISODateString;
}

export interface ExchangeTransaction {
  id: number;
  drawer_id: DrawerId;
  from_currency: CurrencyCode;
  to_currency: CurrencyCode;
  from_amount: number;
  to_amount: number;
  rate_used: number;
  cashier_id: number;
  created_at: ISODateString;
}

// =============================================================================
// Drawer Entity
// =============================================================================

export interface DrawerBalance {
  id: number;
  drawer_id: DrawerId;
  currency: CurrencyCode;
  amount: number;
  updated_at: ISODateString;
}

export interface DrawerSession {
  id: number;
  drawer_id: DrawerId;
  cashier_id: number;
  opening_balance_usd: number;
  opening_balance_lbp: number;
  closing_balance_usd: number | null;
  closing_balance_lbp: number | null;
  status: "open" | "closed";
  opened_at: ISODateString;
  closed_at: ISODateString | null;
}

// =============================================================================
// Recharge Entity
// =============================================================================

export interface RechargeTransaction {
  id: number;
  drawer_id: DrawerId;
  provider: string;
  amount_usd: number;
  phone_number: string;
  client_id: number | null;
  cashier_id: number;
  created_at: ISODateString;
}

// =============================================================================
// OMT Entity
// =============================================================================

export interface OMTTransaction {
  id: number;
  drawer_id: DrawerId;
  transaction_type: "send" | "receive";
  amount_usd: number;
  fee_usd: number;
  recipient_name: string | null;
  sender_name: string | null;
  phone_number: string | null;
  client_id: number | null;
  cashier_id: number;
  notes: string | null;
  created_at: ISODateString;
}

// =============================================================================
// Expense Entity
// =============================================================================

export interface Expense {
  id: number;
  drawer_id: DrawerId;
  category: string;
  description: string;
  amount_usd: number;
  cashier_id: number;
  created_at: ISODateString;
}

// =============================================================================
// Audit Log Entity
// =============================================================================

export interface AuditLog {
  id: number;
  user_id: number;
  action: string;
  entity_type: string;
  entity_id: number | null;
  old_values: string | null; // JSON string
  new_values: string | null; // JSON string
  ip_address: string | null;
  created_at: ISODateString;
}
