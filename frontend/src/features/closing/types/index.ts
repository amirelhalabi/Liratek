/**
 * Closing & Opening Module Types
 * Enterprise-level type definitions for the closing and opening workflows
 */

export interface Currency {
  code: string;
  name: string;
  is_active: number;
}

export type DrawerType =
  | "General"
  | "OMT_System"
  | "OMT_App"
  | "Whish_App"
  | "Binance"
  | "MTC"
  | "Alfa"
  | "iPick"
  | "Katsh"
  | "Whish_System";

export interface DrawerAmount {
  drawer_name: DrawerType;
  currency_code: string;
  amount: number;
}

export interface OpeningBalanceAmount extends DrawerAmount {
  opening_amount: number;
}

export interface PhysicalAmount extends DrawerAmount {
  physical_amount: number;
}

export interface DrawerBalances {
  [currencyCode: string]: number;
}

/**
 * Dynamic system expected balances: Record<drawerName, Record<currencyCode, balance>>
 */
export type DynamicSystemExpectedBalances = Record<
  string,
  Record<string, number>
>;

export interface DrawerConfig {
  type: DrawerType;
  label: string;
  description: string;
  icon: string;
  color: {
    border: string;
    background: string;
    accent: string;
  };
}

export interface ValidationError {
  drawer: DrawerType;
  currency: string;
  message: string;
}

export interface OpeningFormData {
  amounts: Record<DrawerType, DrawerBalances>;
  closing_date: string;
  user_id?: number;
}

export interface ClosingFormData {
  physicalAmounts: Record<DrawerType, DrawerBalances>;
  closing_date: string;
  variance_notes?: string;
  user_id?: number;
}
