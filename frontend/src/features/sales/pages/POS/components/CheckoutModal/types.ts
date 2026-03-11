import type { Client, CartItem } from "@liratek/ui";

export interface CheckoutDraftData {
  selectedClient: Client | null;
  clientSearchInput: string;
  clientSearchSecondary: string;
  discount: number;
  paidUSD: number;
  paidLBP: number;
  changeGivenUSD: number;
  changeGivenLBP: number;
  exchangeRate: number;
}

export interface CartItemWithIMEI extends CartItem {
  imei?: string;
}
