/**
 * LIRA-388 — the ONE refund classification (rule 14). Both the core
 * dispatcher (`TransactionService.refundTransaction`) and the Transactions
 * page read it; the page keeps no list of its own.
 *
 * Leaf module (rule 29): reachable from `browser.ts`, imports nothing but
 * `transactionTypes`.
 *
 * Two lists, two meanings — never merge them:
 *   - `NON_REVERSIBLE_TRANSACTION_TYPES` (transactionTypes.ts) is the GENERIC
 *     path's safety gate: the raw `transactions:void` keeps refusing every
 *     type in it, because the generic reversal alone cannot reverse them.
 *   - `REFUND_OWNERS` names, for the types in that gate that are still
 *     refundable, WHO reverses them. A refund of such a type goes through
 *     its owner, never through a bare generic reversal.
 *   - `NON_REFUNDABLE_TRANSACTION_TYPES` = the gate minus the owned types:
 *     what the cashier sees as "Can't refund here".
 */
import {
  NON_REVERSIBLE_TRANSACTION_TYPES,
  type TransactionType,
} from "./transactionTypes.js";

/** Who reverses a refunded row.
 *  - generic: `TransactionRepository._refundTransactionInternal` (with the
 *    type's own owner step inside it)
 *  - holdPickup: Hold Money page's `voidPickup`
 *  - voucher: Vouchers page's `cancelVoucher`
 *  - warranty: Warranty page's `voidClaim` */
export type RefundOwner = "generic" | "holdPickup" | "voucher" | "warranty";

/** What the page opens: the refund window (customer money, method choice),
 *  a one-line confirm (no customer money, or a page action with no method
 *  choice), or nothing ("Can't refund here"). */
export type RefundKind = "window" | "confirm" | "none";

/** Which way the money goes on a window refund: back to the customer (the
 *  customer paid in) or from the customer (the shop paid out). */
export type RefundDirection = "to_customer" | "from_customer";

export interface RefundOwnerEntry {
  owner: RefundOwner;
  kind: Exclude<RefundKind, "none">;
  direction?: RefundDirection;
}

/** Types in the raw-void gate that are refundable through a named owner
 *  (rule 20 — the reversal owner of each is documented in
 *  specs/388-refund-any-transaction/research.md R4). */
export const REFUND_OWNERS: Readonly<
  Partial<Record<TransactionType, RefundOwnerEntry>>
> = {
  // Customer money — the window.
  LOTO_CASH_PRIZE: {
    owner: "generic",
    kind: "window",
    direction: "from_customer",
  },
  CREDIT_CASH_OUT: {
    owner: "generic",
    kind: "window",
    direction: "from_customer",
  },
  DEBT_CASH_OUT: {
    owner: "generic",
    kind: "window",
    direction: "from_customer",
  },
  CREDIT_CASH_IN: {
    owner: "generic",
    kind: "window",
    direction: "to_customer",
  },
  HOLD_MONEY: { owner: "generic", kind: "window", direction: "to_customer" },
  VOUCHER_SALE: { owner: "voucher", kind: "window", direction: "to_customer" },
  // Page actions with no method choice — a confirm.
  HOLD_MONEY_COLLECT: { owner: "holdPickup", kind: "confirm" },
  WARRANTY_COST: { owner: "warranty", kind: "confirm" },
  // Bookkeeping — an opposite entry, a confirm.
  DRAWER_TOPUP: { owner: "generic", kind: "confirm" },
  DRAWER_CASHOUT: { owner: "generic", kind: "confirm" },
  PARTNER_ADJUSTMENT: { owner: "generic", kind: "confirm" },
  ACCOUNT_ADJUSTMENT: { owner: "generic", kind: "confirm" },
  SUPPLIER_ADJUSTMENT: { owner: "generic", kind: "confirm" },
  COUNTERPARTY_DISCOUNT: { owner: "generic", kind: "confirm" },
  LOTO_MONTHLY_FEE: { owner: "generic", kind: "confirm" },
  CARRIER_LINE_ADJUSTMENT: { owner: "generic", kind: "confirm" },
};

/** "Can't refund here" — the gate minus the owned types. */
export const NON_REFUNDABLE_TRANSACTION_TYPES: ReadonlySet<TransactionType> =
  new Set<TransactionType>(
    [...NON_REVERSIBLE_TRANSACTION_TYPES].filter((t) => !REFUND_OWNERS[t]),
  );

/** Carrier-line edits whose credits can be put back (the writer records
 *  `credits_before`/`credits_after` for these from LIRA-388 on). */
export const REFUNDABLE_CARRIER_LINE_REASONS: ReadonlySet<string> = new Set([
  "edited",
  "quick-update",
]);

export interface RefundPlan {
  kind: RefundKind;
  owner?: RefundOwner;
  direction?: RefundDirection;
  /** For kind "none": the reason key — the row's type, or a row-level key
   *  (`carrierLineNoValues`, `reversal`). The page maps it to a text. */
  reason?: string;
}

export interface RefundPlanRow {
  type: string;
  reverses_id?: number | null;
  metadata_json?: string | null;
}

function parseMeta(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    const v = JSON.parse(json) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** True when a CARRIER_LINE_ADJUSTMENT recorded what its line held before
 *  and after (and is an edit whose credits can be put back). */
export function carrierLineAdjustmentHasValues(
  metadataJson: string | null | undefined,
): boolean {
  const m = parseMeta(metadataJson);
  return (
    typeof m.reason === "string" &&
    REFUNDABLE_CARRIER_LINE_REASONS.has(m.reason) &&
    typeof m.credits_before === "number" &&
    typeof m.credits_after === "number"
  );
}

/**
 * The refund plan of one row. Status-independent (whether the row is still
 * live — not voided, not already refunded — is the caller's separate check,
 * `isReversibleRow` on the page, the repository's guards on the server).
 */
export function refundPlanOf(row: RefundPlanRow): RefundPlan {
  const type = row.type as TransactionType;
  // A structural type first, so a REFUND row (which also carries
  // `reverses_id`) keeps its own reason text.
  if (NON_REFUNDABLE_TRANSACTION_TYPES.has(type)) {
    return { kind: "none", reason: type };
  }
  if (row.reverses_id != null) return { kind: "none", reason: "reversal" };
  const owned = REFUND_OWNERS[type];
  if (owned) {
    if (
      type === "CARRIER_LINE_ADJUSTMENT" &&
      !carrierLineAdjustmentHasValues(row.metadata_json)
    ) {
      return { kind: "none", reason: "carrierLineNoValues" };
    }
    return { ...owned };
  }
  // Every other type is reversed by the generic path, through the window.
  return { kind: "window", owner: "generic" };
}
