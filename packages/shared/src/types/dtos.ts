/**
 * Data Transfer Objects for API requests and responses.
 * These are used for IPC communication between frontend and backend.
 */

import type {
  SQLiteBoolean,
  CurrencyCode,
  DrawerId,
  UserRole,
  Product,
  Client,
  Sale,
  SaleItem,
  SafeUser,
} from "./entities";

// =============================================================================
// Auth DTOs
// =============================================================================

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  success: boolean;
  user?: SafeUser;
  error?: string;
}

export interface ChangePasswordRequest {
  userId: number;
  currentPassword: string;
  newPassword: string;
}

// =============================================================================
// User DTOs
// =============================================================================

export interface CreateUserRequest {
  username: string;
  password: string;
  role: UserRole;
}

export interface UpdateUserRequest {
  id: number;
  username?: string;
  role?: UserRole;
  is_active?: SQLiteBoolean;
}

// =============================================================================
// Product DTOs
// =============================================================================

export interface CreateProductRequest {
  sku: string;
  name: string;
  category: string;
  cost_usd: number;
  price_usd: number;
  price_lbp: number;
  quantity: number;
  reorder_level?: number;
}

export interface UpdateProductRequest {
  id: number;
  sku?: string;
  name?: string;
  category?: string;
  cost_usd?: number;
  price_usd?: number;
  price_lbp?: number;
  quantity?: number;
  reorder_level?: number;
  is_active?: SQLiteBoolean;
}

export interface ProductSearchRequest {
  query?: string;
  category?: string;
  includeInactive?: boolean;
  limit?: number;
  offset?: number;
}

// =============================================================================
// Client DTOs
// =============================================================================

export interface CreateClientRequest {
  name: string;
  phone?: string;
  whatsapp_opt_in?: SQLiteBoolean;
  notes?: string;
}

export interface UpdateClientRequest {
  id: number;
  name?: string;
  phone?: string;
  whatsapp_opt_in?: SQLiteBoolean;
  notes?: string;
  is_active?: SQLiteBoolean;
}

export interface ClientSearchRequest {
  query?: string;
  includeInactive?: boolean;
  limit?: number;
  offset?: number;
}

// =============================================================================
// Cart & Sale DTOs
// =============================================================================

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface SaleItemRequest {
  product_id: number;
  product_name: string;
  quantity: number;
  unit_price_usd: number;
}

export interface CreateSaleRequest {
  drawer_id: DrawerId;
  client_id?: number;
  items: SaleItemRequest[];
  subtotal_usd: number;
  discount_usd: number;
  total_usd: number;
  payment_method: string;
  amount_paid_usd: number;
  amount_paid_lbp: number;
  change_usd: number;
  change_lbp: number;
  cashier_id: number;
  create_debt?: boolean;
}

export interface SaleResponse extends Sale {
  items: SaleItem[];
  client?: Client;
}

export interface SalesListRequest {
  drawer_id?: DrawerId;
  client_id?: number;
  from_date?: string;
  to_date?: string;
  limit?: number;
  offset?: number;
}

// =============================================================================
// Debt DTOs
// =============================================================================

export interface CreateDebtRequest {
  client_id: number;
  sale_id?: number;
  original_amount_usd: number;
  notes?: string;
}

export interface DebtPaymentRequest {
  debt_id: number;
  amount_usd: number;
  payment_method: string;
  notes?: string;
}

export interface DebtListRequest {
  client_id?: number;
  status?: "active" | "partial" | "paid" | "all";
  limit?: number;
  offset?: number;
}

// =============================================================================
// Exchange DTOs
// =============================================================================

export interface SetExchangeRateRequest {
  from_currency: CurrencyCode;
  to_currency: CurrencyCode;
  rate: number;
}

export interface ExchangeTransactionRequest {
  drawer_id: DrawerId;
  from_currency: CurrencyCode;
  to_currency: CurrencyCode;
  from_amount: number;
  rate_used: number;
  cashier_id: number;
}

// =============================================================================
// Drawer DTOs
// =============================================================================

export interface OpenDrawerRequest {
  drawer_id: DrawerId;
  cashier_id: number;
  opening_balance_usd: number;
  opening_balance_lbp: number;
}

export interface CloseDrawerRequest {
  drawer_id: DrawerId;
  cashier_id: number;
  closing_balance_usd: number;
  closing_balance_lbp: number;
}

export interface DrawerBalanceUpdate {
  drawer_id: DrawerId;
  currency: CurrencyCode;
  amount: number;
  operation: "add" | "subtract" | "set";
}

// =============================================================================
// Recharge DTOs
// =============================================================================

export interface CreateRechargeRequest {
  drawer_id: DrawerId;
  provider: string;
  amount_usd: number;
  phone_number: string;
  client_id?: number;
  cashier_id: number;
}

// =============================================================================
// OMT DTOs
// =============================================================================

export interface CreateOMTRequest {
  drawer_id: DrawerId;
  transaction_type: "send" | "receive";
  amount_usd: number;
  fee_usd?: number;
  recipient_name?: string;
  sender_name?: string;
  phone_number?: string;
  client_id?: number;
  cashier_id: number;
  notes?: string;
}

// =============================================================================
// Expense DTOs
// =============================================================================

export interface CreateExpenseRequest {
  drawer_id: DrawerId;
  category: string;
  description: string;
  amount_usd: number;
  cashier_id: number;
}

export interface ExpenseListRequest {
  drawer_id?: DrawerId;
  category?: string;
  from_date?: string;
  to_date?: string;
  limit?: number;
  offset?: number;
}

// =============================================================================
// Report DTOs
// =============================================================================

export interface DailyReportRequest {
  drawer_id?: DrawerId;
  date: string; // YYYY-MM-DD
}

export interface DateRangeReportRequest {
  drawer_id?: DrawerId;
  from_date: string;
  to_date: string;
}

export interface DailySummary {
  total_sales_usd: number;
  total_sales_lbp: number;
  sale_count: number;
  total_expenses_usd: number;
  expense_count: number;
  total_recharges_usd: number;
  recharge_count: number;
  total_omt_fees_usd: number;
  omt_count: number;
  net_profit_usd: number;
}

// =============================================================================
// Pagination DTOs
// =============================================================================

export interface PaginatedRequest {
  limit?: number;
  offset?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

// =============================================================================
// Generic Response DTOs
// =============================================================================

export interface SuccessResponse<T = void> {
  success: true;
  data: T;
}

export interface ErrorResponse {
  success: false;
  error: string;
  code?: string;
  details?: Record<string, unknown>;
}

export type ApiResponse<T = void> = SuccessResponse<T> | ErrorResponse;
