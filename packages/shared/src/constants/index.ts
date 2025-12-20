/**
 * Shared constants used across frontend and backend.
 */

// =============================================================================
// User Roles
// =============================================================================

export const USER_ROLES = {
  ADMIN: 'admin',
  CASHIER: 'cashier',
} as const;

export const USER_ROLE_LABELS: Record<string, string> = {
  admin: 'Administrator',
  cashier: 'Cashier',
};

// =============================================================================
// Currencies
// =============================================================================

export const CURRENCIES = {
  USD: 'USD',
  LBP: 'LBP',
  EUR: 'EUR',
} as const;

export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  LBP: 'L£',
  EUR: '€',
};

export const CURRENCY_LABELS: Record<string, string> = {
  USD: 'US Dollar',
  LBP: 'Lebanese Pound',
  EUR: 'Euro',
};

// =============================================================================
// Drawers
// =============================================================================

export const DRAWERS = {
  DRAWER1: 'drawer1',
  DRAWER2: 'drawer2',
} as const;

export const DRAWER_LABELS: Record<string, string> = {
  drawer1: 'Drawer 1',
  drawer2: 'Drawer 2',
};

// =============================================================================
// Payment Methods
// =============================================================================

export const PAYMENT_METHODS = {
  CASH: 'cash',
  CARD: 'card',
  MIXED: 'mixed',
  CREDIT: 'credit',
} as const;

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  mixed: 'Mixed',
  credit: 'Credit (Debt)',
};

// =============================================================================
// Debt Status
// =============================================================================

export const DEBT_STATUS = {
  ACTIVE: 'active',
  PARTIAL: 'partial',
  PAID: 'paid',
} as const;

export const DEBT_STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  partial: 'Partially Paid',
  paid: 'Paid',
};

// =============================================================================
// OMT Transaction Types
// =============================================================================

export const OMT_TYPES = {
  SEND: 'send',
  RECEIVE: 'receive',
} as const;

export const OMT_TYPE_LABELS: Record<string, string> = {
  send: 'Send Money',
  receive: 'Receive Money',
};

// =============================================================================
// Expense Categories
// =============================================================================

export const EXPENSE_CATEGORIES = [
  'utilities',
  'rent',
  'supplies',
  'maintenance',
  'salary',
  'transportation',
  'food',
  'other',
] as const;

export const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  utilities: 'Utilities',
  rent: 'Rent',
  supplies: 'Supplies',
  maintenance: 'Maintenance',
  salary: 'Salary',
  transportation: 'Transportation',
  food: 'Food',
  other: 'Other',
};

// =============================================================================
// Recharge Providers
// =============================================================================

export const RECHARGE_PROVIDERS = [
  'alfa',
  'mtc',
  'ogero',
  'other',
] as const;

export const RECHARGE_PROVIDER_LABELS: Record<string, string> = {
  alfa: 'Alfa',
  mtc: 'Touch (MTC)',
  ogero: 'Ogero',
  other: 'Other',
};

// =============================================================================
// Product Categories (Default)
// =============================================================================

export const DEFAULT_PRODUCT_CATEGORIES = [
  'electronics',
  'accessories',
  'cables',
  'cases',
  'chargers',
  'batteries',
  'other',
] as const;

// =============================================================================
// Drawer Limits (Default Values)
// =============================================================================

export const DEFAULT_DRAWER_LIMITS = {
  USD: 500,
  LBP: 50_000_000,
  EUR: 500,
} as const;

// =============================================================================
// Session Settings
// =============================================================================

export const SESSION_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8 hours
export const SESSION_WARNING_MS = 30 * 60 * 1000; // 30 minutes before expiry

// =============================================================================
// Pagination Defaults
// =============================================================================

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// =============================================================================
// Validation Constants
// =============================================================================

export const VALIDATION = {
  USERNAME_MIN_LENGTH: 3,
  USERNAME_MAX_LENGTH: 50,
  PASSWORD_MIN_LENGTH: 8,
  PASSWORD_MAX_LENGTH: 128,
  PHONE_REGEX: /^[\d\s\-+()]+$/,
  SKU_REGEX: /^[A-Za-z0-9\-_]+$/,
} as const;
