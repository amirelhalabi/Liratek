/**
 * Cart types for LIRA-014: Walk-In Session with Batch Checkout
 *
 * Cart items are stored in-memory in SessionContext.
 * Each item captures the exact IPC payload needed to replay the transaction at checkout.
 */

export interface CartItem {
  /** UUID for React keys & removal */
  id: string;
  /** Module identifier */
  module: CartModule;
  /** Human-readable label: e.g. "MTC Recharge - 03123456 - $50" */
  label: string;
  /** Signed amount: positive = customer pays, negative = shop pays out */
  amount: number;
  /** Currency of the amount */
  currency: "USD" | "LBP" | "USDT";
  /** Exact payload for the IPC handler (to replay at checkout) */
  formData: Record<string, unknown>;
  /** IPC channel to call at checkout */
  ipcChannel: string;
  /** Pre-calculated Side A drawer movements (informational, not used for actual drawer ops) */
  drawerOperations?: DrawerOp[];
}

export type CartModule =
  | "pos"
  | "recharge_mtc"
  | "recharge_alfa"
  | "omt_app"
  | "whish_app"
  | "ipick"
  | "katsh"
  | "binance_send"
  | "binance_receive"
  | "omt_system"
  | "whish_system"
  | "loto_ticket"
  | "loto_prize"
  | "custom_service"
  | "maintenance";

export interface DrawerOp {
  /** Drawer name: 'MTC' | 'Alfa' | 'OMT_App' | 'Binance' | 'General' | 'Loto' | etc. */
  drawer: string;
  /** Signed: positive = credit, negative = debit */
  amount: number;
  /** Currency */
  currency: string;
}

/** Summary of cart totals by currency */
export interface CartTotals {
  usd: number;
  lbp: number;
  usdt: number;
}
