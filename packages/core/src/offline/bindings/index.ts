/**
 * Binding registry (LIRA-306). Server-only — exported from `index.ts`, never
 * from `browser.ts` (bindings reach services → repositories → the database).
 * Each family module registers its channels here.
 */
import type { OfflineBinding } from "./types.js";
import { SALES_BINDINGS } from "./sales.js";
import { CLIENT_BINDINGS } from "./clients.js";
import { TRANSACTION_BINDINGS } from "./transactions.js";
import { DEBT_BINDINGS } from "./debts.js";
import { EXPENSE_BINDINGS } from "./expenses.js";
import { EXCHANGE_BINDINGS } from "./exchange.js";
import { CUSTOM_SERVICES_BINDINGS } from "./customServices.js";
import { LOTO_BINDINGS } from "./loto.js";
import { STOCK_BINDINGS } from "./stock.js";
import { DRAWERS_BINDINGS } from "./drawers.js";
import { MAINTENANCE_BINDINGS } from "./maintenance.js";
import { CHECKPOINT_BINDINGS } from "./checkpoints.js";

export type { OfflineBinding, OfflineBindingContext, BindingResult } from "./types.js";

const REGISTRY = new Map<string, OfflineBinding>();

function register(list: readonly OfflineBinding[]): void {
  for (const b of list) {
    if (REGISTRY.has(b.channel)) throw new Error(`duplicate offline binding for ${b.channel}`);
    REGISTRY.set(b.channel, b);
  }
}


register(SALES_BINDINGS);
register(CLIENT_BINDINGS);
register(TRANSACTION_BINDINGS);
register(DEBT_BINDINGS);
register(EXPENSE_BINDINGS);
register(EXCHANGE_BINDINGS);
register(CUSTOM_SERVICES_BINDINGS);
register(LOTO_BINDINGS);
register(STOCK_BINDINGS);
register(DRAWERS_BINDINGS);
register(MAINTENANCE_BINDINGS);
register(CHECKPOINT_BINDINGS);

export function getOfflineBinding(channel: string): OfflineBinding | undefined {
  return REGISTRY.get(channel);
}

export function boundChannels(): string[] {
  return [...REGISTRY.keys()].sort();
}
