import { BaseRepository } from "./BaseRepository.js";
import { DatabaseError } from "../utils/errors.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { getFinancialServiceRepository } from "./FinancialServiceRepository.js";
import {
  TRANSACTION_TYPES,
  type TransactionType,
} from "../constants/transactionTypes.js";
import {
  isDrawerAffectingMethod,
  resolveServiceCashDrawer,
  type ServiceCashDrawerContext,
} from "../utils/payments.js";
// Primary Cash Drawer plan §8.2 (docs/plans/todo_plans/PRIMARY_CASH_DRAWER_PLAN.md):
// resolveServiceCashDrawer needs the shop's base system to decide whether a
// supplier's cash leg is a primary-system leg (→ PCD) or not — reuse the one
// canonical getter rather than re-reading system_settings a third time.
import { getSettingsService } from "../services/SettingsService.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { buildCounterpartyMetadata } from "../validators/counterparty.js";
import { allocateFifo } from "../utils/fifoCoverage.js";
import { allocateProportional } from "../utils/largestRemainder.js";
import {
  applyDrawerDelta,
  insertPaymentRow,
  buildCounterpartyDiscountPosting,
} from "./moneyPosting.js";
// BILL_COMMISSION_SETTLEMENT_PLAN.md — the bills-only commission-at-settlement
// drawer top-up reuses the SAME provider→drawer map `RechargeRepository
// .topUpFromSupplier` uses (rule 14), deliberately WITHOUT that method's
// debt-booking half — see `_bookBillsCommissionDrawerTopUp`'s doc comment.
import {
  TOP_UP_PROVIDER_DRAWERS,
  isTopUpProvider,
} from "../constants/index.js";

export interface SupplierEntity {
  id: number;
  name: string;
  contact_name: string | null;
  phone: string | null;
  note: string | null;
  is_active: number;
  module_key: string | null;
  provider: string | null;
  is_system: number;
  created_at: string;
  /**
   * COMMISSION_AT_SETTLEMENT_PLAN.md D8 — per-supplier entry-mode
   * preference for a NEW-MODEL settlement batch: pre-selects the
   * Settlement UI's LUMP/RATE toggle. Null on schemas older than v150
   * (COALESCE'd to 'LUMP' in getColumns()).
   */
  commission_entry_mode: "LUMP" | "RATE";
  /** D8 — the per-unit rate used to pre-fill RATE-mode entry. Null until set. */
  commission_rate: number | null;
  /**
   * LIRA-112 (COMMISSION_AT_SETTLEMENT_PLAN.md D12, v151) — does this
   * supplier currently earn commission from the shop AT ALL? The ONE
   * data-driven gate `FinancialServiceRepository.isPendingSupplierSettlement`
   * / `pendingSettlementSql()` reads for BILL rows (rule 14) — replaces the
   * provider-name hardcode (`provider IN ('iPick', 'Katsh')`) that credited
   * iPick a commission it never earned. 1 (eligible) is the default for
   * every supplier, unchanged from v150's shipped behavior; iPick is seeded
   * to 0 by the v151 migration and `defaultCommissionConfigForProvider`.
   * COALESCE'd to 1 in getColumns() for schemas older than v151.
   */
  commission_eligible: number;
  /**
   * LIRA-112 (v151) — the currency `commission_rate` is denominated in.
   * `commission_rate` (v150) was specced in USD, but Katsh's real-world
   * rate is 20,000 LBP per bill — this column makes that explicit instead
   * of the settle screen silently assuming USD. Defaults to 'USD' (the
   * original spec assumption) for every supplier except Katsh. COALESCE'd
   * to 'USD' in getColumns() for schemas older than v151.
   */
  commission_rate_currency: "USD" | "LBP";
  /**
   * OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-187, v176) — self-FK: when set,
   * this supplier is an ACCOUNT CHILD whose `supplier_ledger` rows still live
   * on ITS OWN id (ledger rows never move — see the plan's §2 design
   * principle) but roll up read-time into the PARENT's account balance/
   * ledger/unsettled-queue (`getAccountBalances`/`getAccountLedger`/
   * `getAccountUnsettled` below). NULL for a standalone supplier and for the
   * parent itself (the parent is found BY being pointed at, not by pointing
   * anywhere). Selected only when `_suppliersHasAccountLinkColumn()` is true
   * (getColumns()) — undefined on a connection older than v176, mirroring
   * every other schema-drift guard in this file.
   */
  account_supplier_id?: number | null;
}

/**
 * LIRA-112 (COMMISSION_AT_SETTLEMENT_PLAN.md D12) — the ONE provider-keyed
 * default for a BRAND-NEW supplier row's commission configuration
 * (rule 14: not a provider-name `if` sprinkled across the codebase, a
 * single function every creation path calls). Owner: "i said ipick bills
 * gives us no comission, but katsh does... 20,000 LBP per bill sold...
 * ipick its not the case." iPick earns nothing, ever; Katsh earns 20,000
 * LBP/bill via RATE mode; every other provider keeps v150's shipped default
 * (eligible, LUMP, no preset rate).
 *
 * Applied at creation time only (`SupplierRepository.createSupplier`) — this
 * is what makes a BRAND-NEW tenant's iPick/Katsh suppliers correct from the
 * moment they're added (checked: `TenantRepository.seedConfig` deliberately
 * excludes the sample suppliers rows as "sample data, not config", so a
 * fresh tenant only gets a correct iPick/Katsh supplier if whatever creates
 * it — this method, today's only path — defaults it correctly). The v151
 * migration's data backfill and `create_db.sql`'s desktop fixture seed carry
 * the same literal values for existing tenants / the desktop fresh install,
 * necessarily as raw SQL (migrations/seed data can't call back into
 * application code) — kept in sync with this function by hand; this is the
 * one function every *application-code* creation path (present and future)
 * calls, so no repository ever re-derives eligibility from a provider name.
 */
export function defaultCommissionConfigForProvider(
  provider: string | null | undefined,
): {
  commission_eligible: 0 | 1;
  commission_entry_mode: "LUMP" | "RATE";
  commission_rate: number | null;
  commission_rate_currency: "USD" | "LBP";
} {
  if (provider === "iPick") {
    return {
      commission_eligible: 0,
      commission_entry_mode: "LUMP",
      commission_rate: null,
      commission_rate_currency: "USD",
    };
  }
  if (provider === "Katsh") {
    return {
      commission_eligible: 1,
      commission_entry_mode: "RATE",
      commission_rate: 20000,
      commission_rate_currency: "LBP",
    };
  }
  return {
    commission_eligible: 1,
    commission_entry_mode: "LUMP",
    commission_rate: null,
    commission_rate_currency: "USD",
  };
}

export type SupplierLedgerEntryType =
  | "TOP_UP"
  /** Sale cost consumed from a provider balance (cost/price-flow SEND). Increases
   *  what the shop owes the supplier, like TOP_UP, but labeled distinctly so it can
   *  be reconciled as a real sale cost rather than a manual top-up. */
  | "SALE_COST"
  | "PAYMENT"
  | "ADJUSTMENT"
  | "SETTLEMENT"
  | "CASH_PRIZE"
  /** The supplier paid the shop (e.g. settling an overpayment they owed us).
   *  Positive ledger amount (mirror of PAYMENT) with cash CREDITED to the
   *  payment-method drawer. */
  | "SUPPLIER_PAYS_US"
  /** CQ-10 (v131): the supplier forgives part of what the shop owes them.
   *  Negative ledger amount (mirror of PAYMENT — reduces what we owe), NO
   *  cash movement (no drawer/payments row) — see SupplierRepository's
   *  _postSupplierDiscount. */
  | "DISCOUNT"
  /** SUPPLIER_STOCK_INTAKE_PLAN.md (migration v164): receiving stock with a
   *  supplier attached writes ONE positive ledger row (+qty * unit cost) —
   *  see recordStockIntake. Balance is the ledger sum ONLY; sales/refunds/
   *  cost edits never touch it (that recompute-from-live-inventory bug is
   *  exactly what this entry type replaces — see getProductSupplierBalances). */
  | "STOCK_INTAKE";

export interface SupplierLedgerEntryEntity {
  id: number;
  supplier_id: number;
  entry_type: SupplierLedgerEntryType;
  amount_usd: number;
  amount_lbp: number;
  note: string | null;
  created_by: number | null;
  transaction_id: number | null;
  is_auto: number;
  /** 1 = soft-voided (its transaction was voided/refunded) — excluded from every balance/pool aggregate. */
  is_refunded: number;
  refunded_at: string | null;
  /** LIRA-091 (v136): back-link to the PARENT transaction's own source row
   *  (mirrors transactions.source_table/source_id) for an auto-generated
   *  sibling row — lets TransactionRepository cascade-void this row when the
   *  parent is voided/refunded. NULL for manual entries and for rows created
   *  before the migration (legacy, not backfilled). */
  source_ref_table: string | null;
  source_ref_id: number | null;
  created_at: string;
  /** Display-only LEFT JOIN enrichment (getSupplierLedger) — the batch
   *  commission collected at a bills-only settlement, when this row IS that
   *  settlement's SETTLEMENT row. NOT a ledger amount and never summed into
   *  a balance; see the join's doc comment on getSupplierLedger. Undefined
   *  when `supplier_settlements` isn't joined (pre-v150 fixture), null when
   *  joined but no matching settlement row exists. */
  settlement_commission_usd?: number | null;
  /** @see settlement_commission_usd */
  settlement_commission_lbp?: number | null;
}

/**
 * Rule-14 fragment: excludes soft-voided ledger rows (their transaction was
 * voided/refunded via TransactionRepository._markSourceRefunded) from every
 * balance/pool aggregate. Flagging the ORIGINAL row is the only mechanism
 * that keeps the sign-bucketed FIFO pools correct — a compensating row of
 * either sign lands in the wrong pool.
 */
const ledgerNotRefunded = (alias = ""): string =>
  `COALESCE(${alias}is_refunded, 0) = 0`;

/**
 * OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-187/188), rule 14 — the ONE
 * "is this supplier a member of account X" predicate: X itself (the
 * parent), or any supplier pointing at X via `account_supplier_id` (a
 * child). Shared by `getAccountBalances`, `getAccountLedger` and
 * `getAccountUnsettled` — never re-typed as a second `s.id = ? OR
 * s.account_supplier_id = ?` literal.
 */
const accountMemberOf = (alias = "s."): string =>
  `(${alias}id = ? OR ${alias}account_supplier_id = ?)`;

export interface SettleTransactionsData {
  supplier_id: number;
  /** IDs from financial_services to mark as settled */
  financial_service_ids: number[];
  /**
   * Net amount paid to the supplier.
   *
   * LEGACY batches (every selected row's `commission_model` = 0, EMBEDDED —
   * byte-for-byte unchanged): under the Primary Cash Drawer model
   * (docs/plans/todo_plans/PRIMARY_CASH_DRAWER_PLAN.md §8.3 — supersedes PR
   * #66's float-model fee-only booking), `financial_services.supplier_owed`
   * / `supplier_ledger` TOP_UP rows are booked GROSS — principal + fee −
   * commission (`grossOwedDelta`, FinancialServiceRepository.ts) — so this
   * figure is simply the sum of the outstanding `supplier_owed` for
   * `financial_service_ids`. It must NOT be further reduced by
   * `commission_usd`/`commission_lbp` below — the shop's cut is already
   * embedded in the gross figure (it nets out to the shop's cut over a
   * SEND+RECEIVE cycle), and subtracting it again double-nets the shop's cut
   * out of the payment.
   *
   * NEW-MODEL batches (every selected row's `commission_model` = 1,
   * AT_SETTLEMENT — COMMISSION_AT_SETTLEMENT_PLAN.md D1-D9): `supplier_owed`
   * for these rows is NOT commission-adjusted (the commission is entered
   * HERE, not guessed at creation) — the caller (settlement UI) is expected
   * to compute this figure as `gross owed − commission_usd/commission_lbp`
   * (net pay). The repository trusts this figure for the money that actually
   * moves (the SETTLEMENT ledger row + `payments[]`) exactly like the legacy
   * path — what's NEW is that `settleTransactions` additionally books the
   * entered commission as its own real ledger event (see
   * `commission_usd`/`commission_lbp` below) and a `supplier_settlements` +
   * `settlement_commission_allocations` audit/reporting record (D5/D6).
   */
  amount_usd: number;
  amount_lbp: number;
  /**
   * Total commission this batch represents.
   *
   * LEGACY batches: INFORMATIONAL ONLY (audit/display), stamped onto the
   * settlement transaction's metadata. It has NO drawer or ledger effect:
   * under the GROSS model (plan §8.3) the shop's cut is already embedded in
   * `amount_usd`/`amount_lbp` (and in the TOP_UP rows being settled) via
   * `grossOwedDelta`, so there is nothing left to "fund" or "realize" here —
   * the commission simply stays behind in whichever drawer took the
   * original transaction's cash (the primary cash drawer, PCD, for the
   * shop's primary provider) as the difference between what the customer
   * paid (fee f) and what gets remitted to the provider (f − c). This field
   * drives NO separate `drawer += commission` pair or `SUPPLIER_PAYS_US`
   * ledger row for a legacy batch — that would double-count money already
   * reflected in the gross TOP_UP/SETTLEMENT pair.
   *
   * NEW-MODEL batches: MONEY-BEARING. `settleTransactions` books this exact
   * total as a `SUPPLIER_PAYS_US` supplier_ledger credit (negative = the
   * supplier owes the shop; is_auto, linked to this settlement's own ledger
   * row — never by time proximity, the LIRA-085 lesson), splits it across
   * the settled rows via largest-remainder proportional allocation
   * (`settlement_commission_allocations`, D6 — Σ = this figure exactly, per
   * currency), and snapshots the batch total onto `supplier_settlements`
   * (D5). See `entry_mode`/`commission_rate`/`commission_unit_count` below
   * for how the operator arrived at this number (RATE mode) — this field
   * always carries the FINAL money amount regardless of entry mode.
   */
  commission_usd: number;
  commission_lbp: number;
  /**
   * COMMISSION_AT_SETTLEMENT_PLAN.md D8 — how the operator entered
   * `commission_usd`/`commission_lbp` for a NEW-MODEL batch: 'LUMP' (a
   * single total for the whole batch) or 'RATE' (`commission_rate` ×
   * `commission_unit_count`). Snapshotted verbatim onto `supplier_settlements`
   * for audit — ignored for LEGACY batches. Defaults to 'LUMP' when omitted.
   */
  entry_mode?: "LUMP" | "RATE";
  /** RATE mode only — the per-unit rate the operator entered (audit snapshot; see `entry_mode`). */
  commission_rate?: number;
  /** RATE mode only — the unit count (e.g. bill/transaction count) the operator entered (audit snapshot; see `entry_mode`). */
  commission_unit_count?: number;
  /**
   * BILL_COMMISSION_SETTLEMENT_PLAN.md follow-up (owner, 2026-08-13) — for a
   * BILLS-ONLY batch (`isBillsOnlyBatch`, re-derived server-side — never
   * trusted from this field alone), how the entered commission actually
   * arrives:
   *   - `'TOP_UP'` (default when omitted — byte-identical to the original
   *     LIRA-137 behavior): the provider (Katsh/iPick) funds a top-up
   *     straight into its OWN drawer via `_bookBillsCommissionDrawerTopUp`.
   *     `payments` below must stay empty — there is no cash owed for a leg
   *     to pay.
   *   - `'OTHER_PAYMENT'`: the commission arrives via real payment-method
   *     legs instead — `payments` below carries them (money arriving IN,
   *     e.g. genuine CASH into the till), posted by
   *     `_bookBillsCommissionViaPaymentLegs`. `settleTransactions` verifies
   *     the legs sum to `commission_usd`/`commission_lbp` (within the same
   *     tolerance every other cash-owed check in this method uses) before
   *     accepting them — this is the ONE exception to the sibling "no cash
   *     owed, no legs" guard just below.
   * Ignored for every other batch shape (legacy, non-bills new-model) — the
   * provider-drawer top-up is the ONLY commission-collection path those
   * shapes have ever had, and this field cannot change that.
   */
  commission_collection_mode?: "TOP_UP" | "OTHER_PAYMENT";
  /**
   * @deprecated No longer used to move money. `OMT_System`/`Whish_System` IS
   * the shop's real physical cash drawer at the money-transfer counter (plan
   * §1) — but settlement still pays the net amount EXCLUSIVELY through
   * `payments[]` (real payment-method legs, resolved to the PCD when the
   * supplier is the shop's primary provider — see `settleTransactions`'s
   * `resolveServiceCashDrawer` call), never a bare named drawer. Kept
   * optional for backward-compatible typing only; any value passed here is
   * ignored.
   */
  drawer_name?: string;
  note?: string;
  created_by: number;
  /**
   * Payment-method legs the net amount is actually paid through (CASH →
   * General, wallet methods → their own drawer, …) — REQUIRED whenever
   * `amount_usd`/`amount_lbp` is nonzero (mirrors `recordSupplierCashflow`'s
   * own `payments` requirement). A settlement that nets to $0 (commission
   * alone offsets what's owed, or a bills-only batch whose principal never
   * touched the ledger — COMMISSION_AT_SETTLEMENT_PLAN.md's "bills
   * settlement note") needs no legs.
   *
   * LIRA-193 (OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §11.4) — `direction` was
   * missing from this type even though the shared runtime schema
   * (`supplierPaymentLegSchema`, reused by `supplierSettleSchema`) has
   * always carried it: a caller CAN put `direction: "OUT"` on a leg here at
   * runtime today, TypeScript's structural typing does not strip it, and
   * this repository never read the field to reject it. Declared here so the
   * reconciliation guard in `settleTransactions` below can see and reject it
   * (no code in that method has ever interpreted a per-leg `direction` — a
   * supplier settlement has no customer to hand change back to, same
   * reasoning `settleAccount` (LIRA-189) already established).
   */
  payments?: Array<{
    method: string;
    currency_code: string;
    amount: number;
    direction?: "IN" | "OUT";
  }>;
}

/**
 * COMMISSION_AT_SETTLEMENT_PLAN.md D2/D3/D4 — one `financial_services` row
 * still eligible to be settled (id exists, tenant-scoped, `settlement_id IS
 * NULL` — the exact predicate `settleTransactions`' own UPDATE applies),
 * carrying just enough to derive the batch's commission model and, for a
 * new-model batch, to write its `settlement_commission_allocations` row.
 */
interface EligibleSettlementRow {
  id: number;
  provider: string;
  service_type: string;
  commission: number;
  commission_model: number;
  currency: string;
}

/**
 * Pay a supplier / record a supplier paying us, using real payment-method legs
 * (MultiPaymentInput) so the CORRECT drawer is debited/credited — not the
 * provider's own stock drawer. Works with zero pending transactions to settle
 * (pure balance pay-down / receipt).
 */
/** CQ-10 — a discount/write-off amount bundled with a cashflow, or posted
 *  standalone. amount_usd/amount_lbp are the FORGIVEN amounts (always
 *  treated as positive magnitudes regardless of sign supplied). */
export interface SupplierDiscountData {
  amount_usd: number;
  amount_lbp: number;
  reason?: string;
}

export interface SupplierCashflowData {
  supplier_id: number;
  /** PAY = shop pays the supplier (cash out, ledger −). RECEIVE = supplier pays
   *  the shop (cash in, ledger +). */
  direction: "PAY" | "RECEIVE";
  /**
   * Payment-method legs; each routes to its method's drawer.
   *
   * LIRA-193 (OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §11.4) — `direction` is on the
   * shared runtime schema (`supplierPaymentLegSchema`, reused by
   * `supplierCashflowSchema`) but was missing here, the same completeness
   * gap `SettleTransactionsData.payments` had (see its doc comment).
   * `recordSupplierCashflow` has never read a per-leg `direction` either —
   * declared so the reject-outright guard below can see and reject it.
   */
  payments: Array<{
    method: string;
    currency_code: string;
    amount: number;
    direction?: "IN" | "OUT";
  }>;
  note?: string;
  created_by: number;
  /** Exchange rate (1 USD = X LBP) used to convert LBP legs to USD when
   *  applying FIFO coverage to supplier_purchases. Defaults to 89 000. */
  exchange_rate?: number;
  /** CQ-10 — bundled discount: "owed X, paid Y, discount Z". ONLY valid on
   *  PAY direction (a supplier can't simultaneously pay the shop AND forgive
   *  what the shop owes them) — recordSupplierCashflow throws otherwise.
   *  Posts its OWN 'DISCOUNT' supplier_ledger row + COUNTERPARTY_DISCOUNT
   *  transaction. */
  discount?: SupplierDiscountData;
}

export interface CreateSupplierData {
  name: string;
  contact_name?: string;
  phone?: string;
  note?: string;
  module_key?: string;
  provider?: string;
}

/**
 * LIRA-191 (OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §5) — set (`account_supplier_id`
 * a positive id) or clear (`null`) a supplier's account parent. See
 * {@link SupplierRepository.updateAccountLink}'s own doc comment for the
 * full validation contract.
 */
export interface UpdateSupplierAccountLinkData {
  supplier_id: number;
  account_supplier_id: number | null;
}

export interface CreateSupplierLedgerEntryData {
  supplier_id: number;
  entry_type: SupplierLedgerEntryType;
  amount_usd: number;
  amount_lbp: number;
  note?: string;
  created_by: number;
  drawer_name?: string;
  is_auto?: boolean;
  /** Real payment-method leg for the PAYMENT+drawer branch's `payments` row.
   *  Defaults to "CASH" — behavior-identical for existing callers that never
   *  pass it (CQ-7: the branch used to hardcode 'CASH' unconditionally). */
  method?: string;
  /**
   * Link-mode (CQ-7): when provided, the ledger row is stamped with this
   * EXISTING transactions.id and addLedgerEntry creates NO new transaction
   * row — the caller's own flow (e.g. RechargeRepository.topUpFromSupplier,
   * LotoTicketRepository, LotoCashPrizeRepository) already created its own
   * unified transaction (and owns any drawer movement) inside the SAME
   * db.transaction(). When omitted, addLedgerEntry creates its own
   * journal transaction row, as before.
   */
  transaction_id?: number;
  /**
   * LIRA-091 (v136): stamp this auto-generated row with a back-link to the
   * PARENT transaction's own source row (e.g. `source_ref_table:
   * "financial_services", source_ref_id: <fs id>`) so TransactionRepository
   * can find and cascade-void it when the parent is voided/refunded. Only
   * meaningful for is_auto:true, separate-hidden-transaction callers
   * (FinancialServiceRepository's BILL/SEND/RECEIVE auto rows) — link-mode
   * callers (transaction_id set) already share the parent's own transaction
   * row and must NOT set this (their supplier_ledger.transaction_id already
   * points AT the parent's transaction, so stamping source_ref too would
   * make the generic cascade call _voidTransactionInternal on its own
   * in-flight parent transaction).
   */
  source_ref_table?: string;
  source_ref_id?: number;
}

export interface SupplierBalance {
  supplier_id: number;
  total_usd: number;
  total_lbp: number;
}

/**
 * OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-187/188) — a rolled-up read of the
 * OMT open-credit account: the parent supplier ('OMT') plus every child
 * (`account_supplier_id` pointing at it — 'OMT App', 'iPick' today). Ledger
 * rows never move (plan §2); this is a read-time aggregate only.
 */
export interface AccountBalance {
  account_supplier_id: number;
  account_name: string;
  /** Parent + every child, summed. */
  total_usd: number;
  total_lbp: number;
  children: AccountChildBalance[];
}

/** One member row (parent or child) inside an {@link AccountBalance}. */
export interface AccountChildBalance {
  supplier_id: number;
  name: string;
  provider: string | null;
  /** From `service_providers.drawer_name` (joined on provider code) — null
   *  when the row/table isn't available (schema drift or unknown provider),
   *  never a hardcoded provider→drawer map. */
  drawer_name: string | null;
  total_usd: number;
  total_lbp: number;
  /** true for the account PARENT's own row (the OMT counter itself). */
  is_parent: boolean;
}

/** One `supplier_ledger` row surfaced through the account's merged ledger
 *  (`getAccountLedger`) — carries which member it actually belongs to
 *  (ledger rows never move) so the UI can render a Type column. */
export interface AccountLedgerEntry {
  id: number;
  supplier_id: number;
  /** 'OMT' | 'OMT_APP' | 'iPick' — the owning member's `provider`. */
  source_provider: string | null;
  /** 'OMT' | 'OMT App' | 'iPick' — the owning member's `name`; the Type column. */
  source_name: string;
  entry_type: string;
  amount_usd: number;
  amount_lbp: number;
  note: string | null;
  created_at: string;
  is_refunded: number;
  settlement_id: number | null;
}

/**
 * One row still awaiting settlement inside the account, from either of two
 * structurally different sources (plan §9.3): a `financial_services` row
 * (the OMT counter's own pending-settlement predicate) or a raw
 * `supplier_ledger` row with no settlement batch yet (iPick / OMT App
 * supplier-credit debt, which has no `financial_services` row at all).
 */
export interface AccountUnsettledRow {
  kind: "FINANCIAL_SERVICE" | "LEDGER";
  id: number;
  supplier_id: number;
  source_provider: string | null;
  source_name: string;
  created_at: string;
  amount_usd: number;
  amount_lbp: number;
  /** LEDGER rows only. */
  entry_type: string | null;
  /** FINANCIAL_SERVICE rows only. */
  service_type: string | null;
  /**
   * Deferred cashout commission this row will contribute to
   * `settleAccount`'s recognised profit (D14, §8.3a) — the SAME figure
   * `_sumCashoutCommission` sums server-side at settlement time, read here
   * per-row so the settle sheet's preview can never disagree with the
   * stamp (both go through `_cashoutCommissionByLedgerId`, rule 14). Always
   * 0 for a FINANCIAL_SERVICE row, for a non-cashout LEDGER row, and for a
   * cashout whose linked transaction is missing/VOIDED/unreadable — never
   * `undefined`, so a caller never needs an `?? 0` guard.
   */
  commission_usd: number;
  commission_lbp: number;
}

/**
 * OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-189, wave 2, CONTRACT_W2.md §2.1) —
 * settle the WHOLE OMT open-credit account (the counter + every account
 * child — 'OMT App' / 'iPick' today) in ONE action, unlike
 * {@link SettleTransactionsData} (single supplier, financial_services
 * only). A selection here can mix FINANCIAL_SERVICE rows (a member's own
 * pending-settlement queue) with raw LEDGER rows (a child's supplier-credit
 * debt, or a WALLET_CASHOUT credit row — negative, LIRA-192). See
 * {@link SupplierRepository.settleAccount}'s own doc comment for the full
 * algorithm and the reversal-shape contract W2 (TransactionRepository)
 * builds against.
 */
export interface SettleAccountData {
  /** The account's PARENT supplier id (e.g. 'OMT') —
   *  {@link SupplierRepository.getAccountUnsettled}'s own key. */
  account_supplier_id: number;
  /**
   * PAY = the selected rows net POSITIVE (shop owes the account) — cash
   * out. COLLECT = they net NEGATIVE (cashouts outweigh debt — §8.4) — cash
   * in. Cross-checked server-side against the RE-COMPUTED net of
   * `selections`, per currency; a caller passing the wrong direction for
   * the actual net is rejected, never trusted.
   */
  direction: "PAY" | "COLLECT";
  /**
   * Explicit rows to settle, RE-VALIDATED against
   * {@link SupplierRepository.getAccountUnsettled} — never trusted by id
   * alone (a foreign, already-settled, or refunded id is rejected).
   * `kind: "FINANCIAL_SERVICE"` ids are `financial_services.id`;
   * `kind: "LEDGER"` ids are raw `supplier_ledger.id`.
   */
  selections: Array<{ kind: "FINANCIAL_SERVICE" | "LEDGER"; id: number }>;
  /** Net cash magnitude for `payments[]` — cross-checked against the
   *  server-recomputed |net| of `selections`, per currency (same 0.005
   *  USD / 1 LBP tolerance `settleTransactions` uses). */
  amount_usd: number;
  amount_lbp: number;
  /**
   * Operator-entered settlement-day commission (the existing LIRA-137
   * mechanism, unchanged) — applies ONLY to whichever ONE account member's
   * FINANCIAL_SERVICE selections resolve to `commission_model = 1` (in
   * practice, today, the OMT counter; iPick defaults `commission_eligible
   * = 0` so the UI never asks for one there). REJECTED — never silently
   * dropped — when nonzero with no such member, or when MORE THAN ONE
   * member has eligible rows in the same batch: one flat figure cannot be
   * safely split across two members' commissions (plan §1 "do not
   * aggregate"). This is separate from, and ADDED to, the D14 cashout
   * commission below (summed automatically from `metadata_json`, never
   * operator-entered).
   */
  commission_usd: number;
  commission_lbp: number;
  entry_mode?: "LUMP" | "RATE";
  commission_rate?: number;
  commission_unit_count?: number;
  note?: string;
  created_by: number;
  /** Unused by `settleAccount` today — §8.3: "no exchange rate is involved
   *  anywhere in this flow." Kept for type parity with the sibling
   *  cashflow/settlement payloads (contract §2.1). */
  exchange_rate?: number;
  /**
   * Payment-method legs for the net cash — required whenever
   * `amount_usd`/`amount_lbp` is nonzero, forbidden otherwise (mirrors
   * `settleTransactions`'s own reverse-hazard guard). Resolved through
   * `resolveServiceCashDrawer` with the PARENT's provider context (D3) — a
   * CASH leg always lands in the OMT Cash Drawer, regardless of which
   * child the debt came from.
   *
   * `direction: "OUT"` is hard-rejected by `settleAccount` itself (Finding
   * A, third hardening round) — kept on the shared leg shape only because
   * `settleTransactions`/`recordSupplierCashflow` reuse the same type for
   * their own legitimate change-return legs.
   */
  payments?: Array<{
    method: string;
    currency_code: string;
    amount: number;
    direction?: "IN" | "OUT";
  }>;
  /**
   * LIRA-203 (owner D18 follow-up, OMT_OPEN_CREDIT_ACCOUNT_PLAN.md) — pay
   * MORE than `selections` net to, and record the difference as a
   * standalone account credit rather than rejecting the batch outright.
   * `amount_usd`/`amount_lbp` above stay the EXACT rows net — this guard is
   * untouched (D18: "the ticked rows settle EXACTLY as today"). The surplus
   * is its OWN thing, added on top: `payments[]` must cover
   * `amount_usd + surplus_usd` / `amount_lbp + surplus_lbp` (step 4b), and
   * `settleAccount` writes it as its own negative `PAYMENT` `supplier_ledger`
   * row on the account PARENT, deliberately left UNSETTLED
   * (`settlement_id` stays NULL) so it re-enters {@link getAccountUnsettled}
   * as a credit row the operator can tick at a LATER settlement — the exact
   * same mixed-sign netting a `WALLET_CASHOUT` credit row already gets
   * (§8.4), so "applying" the credit needs no new code path (D18: "applied
   * manually", never auto-applied). Optional, defaults to 0 — every existing
   * caller is byte-identical. Only valid with `direction: "PAY"` (rejected
   * on COLLECT — collecting more than owed is a different, un-designed
   * flow); must be non-negative.
   */
  surplus_usd?: number;
  surplus_lbp?: number;
}

export class SupplierRepository extends BaseRepository<SupplierEntity> {
  /** Memoized result of {@link _hasSupplierSettlementsTable} — the schema
   *  doesn't change mid-process, so unlike the per-call PRAGMA checks
   *  elsewhere in this file, this one is safe (and worth it: getSupplierLedger
   *  is on the Suppliers page's hot path) to check once per repository
   *  instance. */
  private _hasSupplierSettlementsTableCache: boolean | null = null;

  /** Memoized result of {@link _hasServiceProvidersTable}. */
  private _hasServiceProvidersTableCache: boolean | null = null;

  constructor() {
    super("suppliers", { softDelete: false });
  }

  /**
   * True when the connected `suppliers` table already carries the v150 D8
   * `commission_entry_mode`/`commission_rate` columns. Same schema-drift-
   * guard shape as `_supplierLedgerHasSourceRefColumns` (checked once per
   * call — PRAGMA is cheap, this is not a hot path — rather than cached):
   * dozens of `packages/core` jest fixtures hand-roll a `suppliers` table
   * that predates this migration, and `getColumns()`'s SELECT would throw
   * `no such column` on every one of them if it referenced the columns
   * unconditionally.
   */
  private _suppliersHasCommissionPrefColumns(): boolean {
    const cols = this.db.prepare(`PRAGMA table_info(suppliers)`).all() as {
      name: string;
    }[];
    return (
      cols.some((c) => c.name === "commission_entry_mode") &&
      cols.some((c) => c.name === "commission_rate")
    );
  }

  /**
   * LIRA-112 (v151) — same schema-drift-guard shape as
   * `_suppliersHasCommissionPrefColumns()` above, for the two columns THAT
   * migration adds (`commission_eligible`, `commission_rate_currency`).
   * Checked independently of the v150 guard: a hand-rolled jest fixture
   * could in principle carry the v150 columns without the v151 ones (they
   * were added in separate migrations), so this must not assume one implies
   * the other.
   */
  private _suppliersHasCommissionEligibilityColumns(): boolean {
    const cols = this.db.prepare(`PRAGMA table_info(suppliers)`).all() as {
      name: string;
    }[];
    return (
      cols.some((c) => c.name === "commission_eligible") &&
      cols.some((c) => c.name === "commission_rate_currency")
    );
  }

  /**
   * OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-187, v176) — same schema-drift-
   * guard shape as `_suppliersHasCommissionEligibilityColumns()` above, for
   * the self-FK `account_supplier_id` column that migration adds. Checked
   * independently (not cached — PRAGMA is cheap, this is not a hot path,
   * same tier as the other per-call `suppliers` guards) so a hand-rolled
   * jest fixture that predates v176 keeps working: `getColumns()` and every
   * account-rollup method below (`getAccountBalances`/`getSupplierBalances`'
   * child-exclusion/`getAccountLedger`/`getAccountUnsettled`) degrade to
   * their pre-v176 behavior instead of throwing `no such column`.
   */
  private _suppliersHasAccountLinkColumn(): boolean {
    const cols = this.db.prepare(`PRAGMA table_info(suppliers)`).all() as {
      name: string;
    }[];
    return cols.some((c) => c.name === "account_supplier_id");
  }

  /**
   * OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-191, §5) — the ONE "hide the
   * SECONDARY OMT/WHISH system" predicate (rule 14): a supplier whose
   * `provider` is 'OMT' or 'WHISH' and isn't the shop's `shop_base_system`
   * has no direct relationship on this shop (its obligations live in
   * partner_ledger), so it's hidden from both the tile list
   * (`listSuppliers`) and the balance list (`getSupplierBalances`) — this
   * predicate used to be typed out twice, byte-for-byte, in those two
   * methods; now shared.
   *
   * LIRA-191's Whish-base exemption: an account PARENT (some other supplier
   * points at it via `account_supplier_id`) with at least one ACTIVE child
   * is exempted from the hide rule even when it IS the secondary system —
   * e.g. 'OMT' on a Whish-base shop that still parents 'iPick'/'OMT App'.
   * Hiding a card the operator didn't expect is cosmetic; hiding a rolled-up
   * account's real debt is a money error (owner-confirmed: a Whish-base shop
   * can still hold iPick/OMT App accounts). A CHILDLESS secondary-system
   * supplier keeps the exact old (hidden) behaviour — this only widens
   * visibility, never narrows it.
   *
   * Gated on `_suppliersHasAccountLinkColumn()` so a connection/fixture that
   * predates v176 (no `account_supplier_id` column at all) gets the bare,
   * unexempted rule — byte-identical to pre-LIRA-191 behaviour.
   *
   * `tableRef` is the bare table name or alias the caller's FROM clause
   * uses for `suppliers` — `"suppliers"` (no alias, `listSuppliers`) or
   * `"s"` (aliased, `getSupplierBalances` via `_ledgerBalanceQuery`).
   */
  private _secondarySystemHideClause(tableRef: string): string {
    const hideRule = `NOT (COALESCE(${tableRef}.provider, '') IN ('OMT', 'WHISH')
             AND ${tableRef}.provider <> COALESCE(
               (SELECT value FROM system_settings WHERE key_name = 'shop_base_system' AND tenant_id = ${tableRef}.tenant_id),
               'OMT'))`;
    if (!this._suppliersHasAccountLinkColumn()) return hideRule;
    return `(${hideRule}
             OR EXISTS (
               SELECT 1 FROM suppliers c
                WHERE c.account_supplier_id = ${tableRef}.id
                  AND c.tenant_id = ${tableRef}.tenant_id
                  AND c.is_active = 1
             ))`;
  }

  /**
   * OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-187, v176) — same schema-drift-
   * guard shape as `_suppliersHasAccountLinkColumn()`, for the
   * `supplier_ledger.settlement_id` column that migration ALSO adds (one
   * migration, two columns — plan §9.3). Feeds `getAccountLedger` and
   * `getAccountUnsettled`'s settled-batch check.
   */
  private _supplierLedgerHasSettlementIdColumn(): boolean {
    const cols = this.db
      .prepare(`PRAGMA table_info(supplier_ledger)`)
      .all() as { name: string }[];
    return cols.some((c) => c.name === "settlement_id");
  }

  /**
   * Schema-drift guard, same shape as `_hasSupplierSettlementsTable()`
   * above: `service_providers` only exists from its own migration onward
   * (`ServiceProviderRepository`), and many `packages/core` jest fixtures
   * predate it. Feeds `getAccountBalances`' drawer_name enrichment — a
   * fixture without the table gets `drawer_name: null` for every child
   * instead of a `no such table` throw. Memoized like its sibling.
   */
  private _hasServiceProvidersTable(): boolean {
    if (this._hasServiceProvidersTableCache === null) {
      const row = this.db
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'service_providers'`,
        )
        .get();
      this._hasServiceProvidersTableCache = !!row;
    }
    return this._hasServiceProvidersTableCache;
  }

  // Override getColumns() to use explicit columns instead of SELECT *
  //
  // COMMISSION_AT_SETTLEMENT_PLAN.md D8 — reviewer finding #1 (FIX_FIRST):
  // `commission_entry_mode`/`commission_rate` MUST be selected here —
  // `SupplierEntity` documents them and every caller (Settlement UI's
  // LUMP/RATE pre-select, both IPC and REST via this same listSuppliers())
  // reads them off the row this method shapes. Gated on
  // `_suppliersHasCommissionPrefColumns()` (not selected unconditionally)
  // so pre-v150 connected schemas keep working. COALESCE matches the
  // interface doc's contract for pre-v150 ROWS on an upgraded schema (NULL
  // preference reads as the 'LUMP' default rather than undefined).
  //
  // LIRA-112 (v151) — `commission_eligible`/`commission_rate_currency`
  // follow the exact same pattern, gated on their own guard.
  protected getColumns(): string {
    const base =
      "id, name, contact_name, phone, note, is_active, module_key, provider, is_system, created_at";
    const prefCols = this._suppliersHasCommissionPrefColumns()
      ? ", COALESCE(commission_entry_mode, 'LUMP') AS commission_entry_mode, commission_rate"
      : "";
    const eligibilityCols = this._suppliersHasCommissionEligibilityColumns()
      ? ", COALESCE(commission_eligible, 1) AS commission_eligible, COALESCE(commission_rate_currency, 'USD') AS commission_rate_currency"
      : "";
    // OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-187, v176) — same gated-append
    // pattern as the two blocks above.
    const accountLinkCol = this._suppliersHasAccountLinkColumn()
      ? ", account_supplier_id"
      : "";
    return `${base}${prefCols}${eligibilityCols}${accountLinkCol}`;
  }

  listSuppliers(search?: string, includeInactive?: boolean): SupplierEntity[] {
    try {
      const tenantId = getCurrentTenantId();
      // Hide the SECONDARY OMT/WHISH system: it has no direct supplier relationship
      // (its obligations live in partner_ledger), so it shouldn't appear on the
      // suppliers page. The shop's base system is the only legacy system shown.
      // LIRA-191: shared with getSupplierBalances (rule 14) via
      // _secondarySystemHideClause — see that method's doc comment for the
      // active-children exemption this predicate now also carries.
      let sql = includeInactive
        ? `SELECT ${this.getColumns()} FROM suppliers WHERE tenant_id = ?`
        : `SELECT ${this.getColumns()} FROM suppliers WHERE tenant_id = ? AND is_active = 1
             AND ${this._secondarySystemHideClause("suppliers")}`;
      const params: (string | number)[] = [tenantId];
      if (search?.trim()) {
        sql += ` AND name LIKE ?`;
        params.push(`%${search.trim()}%`);
      }
      sql += ` ORDER BY name ASC`;
      return this.query<SupplierEntity>(sql, ...params);
    } catch (e) {
      throw new DatabaseError("Failed to list suppliers", { cause: e });
    }
  }

  createSupplier(data: CreateSupplierData): { id: number } {
    try {
      const baseParams = [
        data.name.trim(),
        data.contact_name ?? null,
        data.phone ?? null,
        data.note ?? null,
        data.module_key ?? null,
        data.provider ?? null,
        getCurrentTenantId(),
      ];

      // LIRA-112 (D12) — a BRAND-NEW supplier row's commission config
      // defaults per its provider (`defaultCommissionConfigForProvider`,
      // this file), not a hardcoded 'LUMP'/eligible=1 for every provider.
      // This is what makes a fresh tenant's iPick/Katsh suppliers correct
      // from the moment they're added (see that function's doc comment).
      // Gated on the same schema-drift guard as getColumns() — no test
      // fixture currently exercises createSupplier() against a minimal
      // schema, but staying consistent costs nothing.
      if (this._suppliersHasCommissionEligibilityColumns()) {
        const defaults = defaultCommissionConfigForProvider(data.provider);
        const stmt = this.db.prepare(`
          INSERT INTO suppliers (
            name, contact_name, phone, note, module_key, provider, is_active, tenant_id, created_at,
            commission_eligible, commission_entry_mode, commission_rate, commission_rate_currency
          )
          VALUES (?, ?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?)
        `);
        const res = stmt.run(
          ...baseParams,
          defaults.commission_eligible,
          defaults.commission_entry_mode,
          defaults.commission_rate,
          defaults.commission_rate_currency,
        );
        return { id: Number(res.lastInsertRowid) };
      }

      const stmt = this.db.prepare(`
        INSERT INTO suppliers (name, contact_name, phone, note, module_key, provider, is_active, tenant_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
      `);
      const res = stmt.run(...baseParams);
      return { id: Number(res.lastInsertRowid) };
    } catch (e) {
      throw new DatabaseError("Failed to create supplier", { cause: e });
    }
  }

  /**
   * LIRA-191 (OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §5) — how many rows would be
   * silently detached from an account's settlement queue if `supplierId`
   * lost its parent right now: this supplier's OWN pending
   * `financial_services` queue (only a provider-bearing supplier — e.g. the
   * OMT counter — has one) plus its own un-settled `supplier_ledger` rows.
   * Same three exclusions `getAccountUnsettled` applies per member
   * (`settlement_id IS NULL`, non-zero, not refunded, not a
   * financial_services auto-sibling), scoped to ONE supplier instead of an
   * account-wide `accountMemberOf` OR — reuses `ledgerNotRefunded()` and the
   * same schema-drift guards rather than re-typing them (rule 14). Returns 0
   * for the ledger half on a connection that predates v176's
   * `settlement_id` column, matching every other guard in this file.
   */
  private _countOpenUnsettledRows(supplierId: number, tenantId: number): number {
    let count = 0;

    const supplierRow = this.db
      .prepare(`SELECT provider FROM suppliers WHERE id = ? AND tenant_id = ?`)
      .get(supplierId, tenantId) as { provider: string | null } | undefined;
    if (supplierRow?.provider) {
      count += getFinancialServiceRepository().getUnsettledBySupplier(
        supplierRow.provider,
      ).length;
    }

    if (this._supplierLedgerHasSettlementIdColumn()) {
      const excludeFsSiblings = this._supplierLedgerHasSourceRefColumns()
        ? "AND COALESCE(source_ref_table, '') <> 'financial_services'"
        : "";
      const row = this.db
        .prepare(
          `SELECT COUNT(*) as cnt FROM supplier_ledger
             WHERE supplier_id = ? AND tenant_id = ?
               AND settlement_id IS NULL
               AND (amount_usd <> 0 OR amount_lbp <> 0)
               AND ${ledgerNotRefunded()}
               ${excludeFsSiblings}`,
        )
        .get(supplierId, tenantId) as { cnt: number };
      count += row.cnt;
    }

    return count;
  }

  /**
   * LIRA-191 (OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §5) — set or clear a
   * supplier's account parent (`suppliers.account_supplier_id`, the
   * read-time rollup link migration v176 added — §2 design principle:
   * ledger rows never move, only this link reshapes what
   * `getAccountBalances`/`getAccountLedger`/`getAccountUnsettled` group
   * together). Hard-validated here, server-side, because a bad link
   * corrupts a ROLLUP silently rather than failing one row:
   *
   *  - a supplier cannot be its own parent;
   *  - the account is exactly ONE level deep — the new parent must not
   *    itself be a child (no A→B→C chains), and the supplier being updated
   *    must not already be a parent of its own children (re-parenting an
   *    existing account parent would create that same chain, one level
   *    down);
   *  - the parent must exist, be in the SAME tenant, and be active;
   *  - detaching (`account_supplier_id: null`) a supplier that currently
   *    HAS a parent and still carries open unsettled rows is refused, not
   *    silently allowed — those rows would otherwise vanish from the
   *    account's settlement queue with no warning. Re-parenting a child
   *    from one valid parent straight to another is NOT subject to this
   *    check: the debt doesn't disappear, it moves to the new account's
   *    rollup, which is the entire point of this ticket.
   *
   * Every rejection throws `DatabaseError` with a message naming exactly
   * which rule failed — never a silent no-op and never a generic "failed to
   * update".
   */
  updateAccountLink(data: UpdateSupplierAccountLinkData): { id: number } {
    if (!this._suppliersHasAccountLinkColumn()) {
      throw new DatabaseError(
        "Supplier account grouping requires migration v176 (suppliers.account_supplier_id), which this connection does not have",
      );
    }

    const tenantId = getCurrentTenantId();
    const supplierId = data.supplier_id;
    const nextParentId = data.account_supplier_id;

    const supplier = this.db
      .prepare(
        `SELECT id, name, account_supplier_id FROM suppliers WHERE id = ? AND tenant_id = ?`,
      )
      .get(supplierId, tenantId) as
      | { id: number; name: string; account_supplier_id: number | null }
      | undefined;
    if (!supplier) {
      throw new DatabaseError(`Supplier #${supplierId} not found`);
    }

    if (nextParentId !== null) {
      if (nextParentId === supplierId) {
        throw new DatabaseError(
          `Supplier "${supplier.name}" cannot be its own account parent`,
        );
      }

      const parent = this.db
        .prepare(
          `SELECT id, name, is_active, account_supplier_id FROM suppliers WHERE id = ? AND tenant_id = ?`,
        )
        .get(nextParentId, tenantId) as
        | {
            id: number;
            name: string;
            is_active: number;
            account_supplier_id: number | null;
          }
        | undefined;
      if (!parent) {
        throw new DatabaseError(
          `Parent supplier #${nextParentId} not found in this tenant`,
        );
      }
      if (!parent.is_active) {
        throw new DatabaseError(
          `"${parent.name}" is inactive and cannot be an account parent`,
        );
      }
      if (parent.account_supplier_id !== null) {
        throw new DatabaseError(
          `"${parent.name}" is itself a child of another account — accounts are one level deep, no chains`,
        );
      }

      const existingChildren = this.db
        .prepare(
          `SELECT COUNT(*) as cnt FROM suppliers WHERE account_supplier_id = ? AND tenant_id = ?`,
        )
        .get(supplierId, tenantId) as { cnt: number };
      if (existingChildren.cnt > 0) {
        throw new DatabaseError(
          `"${supplier.name}" already has its own children — an account parent cannot become a child (no chains)`,
        );
      }
    } else if (supplier.account_supplier_id !== null) {
      // Detaching an ALREADY-linked child — only case the orphan check
      // applies to (a no-op clear on an already-standalone supplier is
      // harmless and skipped).
      const openCount = this._countOpenUnsettledRows(supplierId, tenantId);
      if (openCount > 0) {
        throw new DatabaseError(
          `Cannot detach "${supplier.name}" from its account — it still has ${openCount} unsettled row${openCount === 1 ? "" : "s"}; settle them first`,
        );
      }
    }

    try {
      this.db
        .prepare(
          `UPDATE suppliers SET account_supplier_id = ? WHERE id = ? AND tenant_id = ?`,
        )
        .run(nextParentId, supplierId, tenantId);
      return { id: supplierId };
    } catch (e) {
      throw new DatabaseError("Failed to update supplier account link", {
        cause: e,
        entityId: supplierId,
      });
    }
  }

  getByProvider(provider: string): SupplierEntity | undefined {
    try {
      const rows = this.query<SupplierEntity>(
        `SELECT ${this.getColumns()} FROM suppliers WHERE provider = ? AND is_active = 1 AND tenant_id = ? LIMIT 1`,
        provider,
        getCurrentTenantId(),
      );
      return rows[0];
    } catch (e) {
      throw new DatabaseError("Failed to get supplier by provider", {
        cause: e,
      });
    }
  }

  getByModuleKey(moduleKey: string): SupplierEntity[] {
    try {
      return this.query<SupplierEntity>(
        `SELECT ${this.getColumns()} FROM suppliers WHERE module_key = ? AND is_active = 1 AND tenant_id = ? ORDER BY name ASC`,
        moduleKey,
        getCurrentTenantId(),
      );
    } catch (e) {
      throw new DatabaseError("Failed to get suppliers by module", {
        cause: e,
      });
    }
  }

  /**
   * CQ-8: cheap supplier-name lookup for the `counterparty` metadata
   * contract. Falls back to a placeholder rather than throwing — a
   * missing/deleted supplier must never block a payment/settlement write.
   */
  private _getSupplierName(supplierId: number): string {
    const row = this.db
      .prepare(`SELECT name FROM suppliers WHERE id = ? AND tenant_id = ?`)
      .get(supplierId, getCurrentTenantId()) as { name: string } | undefined;
    return row?.name ?? `Supplier #${supplierId}`;
  }

  /**
   * True when the connected `supplier_ledger` table already carries the v136
   * source_ref_table/source_ref_id columns. `packages/core` jest specs
   * hand-roll a fresh in-memory schema per file (dozens of pre-existing
   * fixtures predate this migration); writing an INSERT that references a
   * column the connected schema doesn't have would throw — and this
   * particular INSERT is wrapped by every caller's own non-critical try/catch
   * (`FinancialServiceRepository`'s "Supplier auto-record is non-critical"),
   * so the whole ledger row would silently vanish instead of erroring loudly.
   * Checked once per call (PRAGMA is cheap; this is not a hot path) rather
   * than cached, mirroring `TransactionRepository`'s identical guard for the
   * void-cascade side of this same migration.
   */
  private _supplierLedgerHasSourceRefColumns(): boolean {
    const cols = this.db
      .prepare(`PRAGMA table_info(supplier_ledger)`)
      .all() as { name: string }[];
    return (
      cols.some((c) => c.name === "source_ref_table") &&
      cols.some((c) => c.name === "source_ref_id")
    );
  }

  /**
   * Schema-drift guard, same shape as `_supplierLedgerHasSourceRefColumns`
   * above: `supplier_settlements` only exists from migration v150 onward, and
   * `packages/core` jest specs hand-roll fresh in-memory schemas per file —
   * many predate this migration. Feeds `getSupplierLedger`'s LEFT JOIN so a
   * pre-v150 fixture (or a fresh install mid-migration) still gets a stable
   * result shape instead of a "no such table" throw. Memoized (unlike the
   * source-ref check) — see the cache field's own doc comment.
   */
  private _hasSupplierSettlementsTable(): boolean {
    if (this._hasSupplierSettlementsTableCache === null) {
      const row = this.db
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'supplier_settlements'`,
        )
        .get();
      this._hasSupplierSettlementsTableCache = !!row;
    }
    return this._hasSupplierSettlementsTableCache;
  }

  addLedgerEntry(data: CreateSupplierLedgerEntryData): { id: number } {
    // CQ-7 dead corner: a drawer_name only ever makes sense on a PAYMENT row
    // (the only branch that has ever consumed it — verified against every
    // caller). Every other combo silently did nothing pre-fix; reject it
    // outright rather than resurrect the silent no-op.
    if (data.drawer_name && data.entry_type !== "PAYMENT") {
      throw new DatabaseError(
        `addLedgerEntry: drawer_name is only valid with entry_type "PAYMENT" (got "${data.entry_type}")`,
      );
    }
    // LIRA-091: link-mode (transaction_id set) means this row shares the
    // CALLER's own transaction — source_ref would make the void cascade call
    // _voidTransactionInternal on that same in-flight parent (self-void).
    // Only is_auto:true, separate-hidden-transaction callers set source_ref.
    if (data.transaction_id != null && data.source_ref_table) {
      throw new DatabaseError(
        `addLedgerEntry: source_ref_table/source_ref_id cannot be combined with link-mode (transaction_id) — link-mode rows already share the parent's own transaction`,
      );
    }

    try {
      const tenantId = getCurrentTenantId();
      // Enforce sign convention: PAYMENT amounts stored as negative
      let amountUsd = data.amount_usd || 0;
      let amountLbp = data.amount_lbp || 0;
      if (data.entry_type === "PAYMENT") {
        amountUsd = -Math.abs(amountUsd);
        amountLbp = -Math.abs(amountLbp);
      }

      const hasSourceRef = this._supplierLedgerHasSourceRefColumns();
      const stmt = hasSourceRef
        ? this.db.prepare(`
        INSERT INTO supplier_ledger (
          supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, is_auto,
          transaction_id, source_ref_table, source_ref_id, tenant_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `)
        : this.db.prepare(`
        INSERT INTO supplier_ledger (
          supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, is_auto,
          transaction_id, tenant_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);
      const res = hasSourceRef
        ? stmt.run(
            data.supplier_id,
            data.entry_type,
            amountUsd,
            amountLbp,
            data.note ?? null,
            data.created_by,
            data.is_auto ? 1 : 0,
            data.transaction_id ?? null,
            data.source_ref_table ?? null,
            data.source_ref_id ?? null,
            tenantId,
          )
        : stmt.run(
            data.supplier_id,
            data.entry_type,
            amountUsd,
            amountLbp,
            data.note ?? null,
            data.created_by,
            data.is_auto ? 1 : 0,
            data.transaction_id ?? null,
            tenantId,
          );
      const entryId = Number(res.lastInsertRowid);

      // Link-mode (CQ-7): the caller's OWN flow already created a unified
      // transaction (and owns any drawer movement) inside the SAME
      // db.transaction() — stamp it and stop. Creating a second transaction
      // row here would double-book the same event.
      if (data.transaction_id) {
        return { id: entryId };
      }

      // If drawer_name is provided, update drawer_balances
      if (data.drawer_name) {
        // Guaranteed entry_type === "PAYMENT" by the guard above (the only
        // combo drawer_name has ever been paired with).
        // Create unified transaction row for supplier payment
        const txnId = getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.SUPPLIER_PAYMENT,
          source_table: "supplier_ledger",
          source_id: entryId,
          user_id: data.created_by,
          amount_usd: Math.abs(amountUsd),
          amount_lbp: Math.abs(amountLbp),
          summary: `Supplier Payment: $${Math.abs(amountUsd)} + ${Math.abs(amountLbp)} LBP — paid to ${this._getSupplierName(data.supplier_id)}`,
          metadata_json: {
            supplier_id: data.supplier_id,
            drawer_name: data.drawer_name,
            // CQ-8 counterparty contract: this branch is guaranteed
            // entry_type === "PAYMENT" (guard above) — the shop always pays
            // OUT of the drawer here.
            counterparty: buildCounterpartyMetadata({
              kind: "supplier",
              id: data.supplier_id,
              name: this._getSupplierName(data.supplier_id),
              flow: "OUT",
              method: data.method ?? "CASH",
              ledgerEntryId: entryId,
            }),
          },
        });

        // Link supplier_ledger row to unified transaction
        this.db
          .prepare(
            `UPDATE supplier_ledger SET transaction_id = ? WHERE id = ? AND tenant_id = ?`,
          )
          .run(txnId, entryId, tenantId);

        if (amountUsd)
          applyDrawerDelta(this.db, {
            drawerName: data.drawer_name,
            currencyCode: "USD",
            delta: amountUsd,
            tenantId,
          });
        if (amountLbp)
          applyDrawerDelta(this.db, {
            drawerName: data.drawer_name,
            currencyCode: "LBP",
            delta: amountLbp,
            tenantId,
          });

        // Log to payments table. `method` defaults to "CASH" (CQ-7: this
        // branch used to hardcode the literal 'CASH' regardless of how the
        // supplier was actually paid).
        insertPaymentRow(this.db, {
          transactionId: txnId,
          method: data.method ?? "CASH",
          drawerName: data.drawer_name,
          currencyCode: amountUsd ? "USD" : "LBP",
          amount: amountUsd || amountLbp,
          note: data.note || `Supplier Payment: ${data.supplier_id}`,
          createdBy: data.created_by,
          tenantId,
        });
      } else {
        // No drawer_name: still create a transaction record for EVERY entry
        // type — including PAYMENT (CQ-7 dead-corner fix: pre-fix a
        // no-drawer PAYMENT wrote a supplier_ledger row with NO transaction
        // row at all) — so it appears in the unified journal.
        const typeMap: Record<string, string> = {
          TOP_UP: TRANSACTION_TYPES.SUPPLIER_PAYMENT,
          SALE_COST: TRANSACTION_TYPES.SUPPLIER_PAYMENT,
          PAYMENT: TRANSACTION_TYPES.SUPPLIER_PAYMENT,
          // LIRA-080: a manual (no-drawer) ADJUSTMENT is a paper (no-cash)
          // supplier_ledger correction — the Suppliers-page "Add Credit / Debt"
          // toggle-OFF entry. It gets its OWN unified type so the Transactions
          // viewer renders NO cash-flow badge (getCashFlowDirection returns
          // null for SUPPLIER_ADJUSTMENT); routing it through SUPPLIER_PAYMENT
          // would paint a misleading green "in" arrow on a row where no cash
          // moved. The cash-moved counterpart never reaches here — it goes
          // through recordSupplierCashflow (→ SUPPLIER_PAYMENT). Sibling of
          // PARTNER_ADJUSTMENT/ACCOUNT_ADJUSTMENT.
          ADJUSTMENT: TRANSACTION_TYPES.SUPPLIER_ADJUSTMENT,
          SETTLEMENT: TRANSACTION_TYPES.SUPPLIER_SETTLEMENT,
        };
        const txnType =
          typeMap[data.entry_type] || TRANSACTION_TYPES.SUPPLIER_PAYMENT;

        // SUPPLIER_PAYS_US through this path is a *cashless credit* — the
        // supplier owes us (e.g. the fixed commission on an iPick/Katsh bill);
        // no drawer moves. The supplier_ledger keeps the signed amount
        // (negative = credit to us, so SUM stays a valid balance), but the
        // unified journal is an event log: store a positive magnitude and flag
        // it as a credit so the UI shows money owed to us, not a negative
        // "payment". (recordSupplierCashflow handles the real cash RECEIVE.)
        const isSupplierCredit = data.entry_type === "SUPPLIER_PAYS_US";
        // PAYMENT's ledger sign is the force-negated bookkeeping convention
        // applied above, not the event's natural value — show the paid
        // magnitude, same as the drawer-based PAYMENT branch above.
        const showMagnitude = isSupplierCredit || data.entry_type === "PAYMENT";
        const journalUsd = showMagnitude ? Math.abs(amountUsd) : amountUsd;
        const journalLbp = showMagnitude ? Math.abs(amountLbp) : amountLbp;

        let summary: string;
        if (isSupplierCredit) {
          const parts: string[] = [];
          if (journalUsd) parts.push(`$${journalUsd.toLocaleString()}`);
          if (journalLbp) parts.push(`${journalLbp.toLocaleString()} LBP`);
          summary = `Supplier credit: ${parts.join(" + ") || "$0"}`;
        } else if (data.entry_type === "PAYMENT" && data.is_auto) {
          // Automatic cashless PAYMENT (e.g. RechargeRepository.cashoutToSupplier's
          // OMT App cashout): the shop returns wallet balance to the provider,
          // so the provider's obligation to the shop grows — no drawer moves
          // and no cash is "paid to" anyone. The caller's own `note` already
          // describes the real event correctly; reuse it instead of asserting
          // a cash payment that didn't happen.
          summary =
            data.note ||
            `Supplier ledger credit: $${journalUsd} + ${journalLbp} LBP — ${this._getSupplierName(data.supplier_id)}`;
        } else if (data.entry_type === "PAYMENT") {
          summary = `Supplier Payment: $${journalUsd} + ${journalLbp} LBP — paid to ${this._getSupplierName(data.supplier_id)}`;
        } else if (data.entry_type === "ADJUSTMENT") {
          // LIRA-080 — paper (no-cash) manual adjustment. Sign carries the
          // direction: CREDIT (+) = shop owes supplier more; DEBIT (−) =
          // reduces what we owe. Mirrors the Accounts-page paper wording.
          const isCredit = (amountUsd || amountLbp) >= 0;
          summary = `Supplier ${
            isCredit ? "Credit" : "Debit"
          } (paper, no cash moved): $${Math.abs(amountUsd)} + ${Math.abs(
            amountLbp,
          )} LBP — ${this._getSupplierName(data.supplier_id)}`;
        } else {
          summary = `Supplier ${data.entry_type}: $${amountUsd} + ${amountLbp} LBP`;
        }

        // CQ-8 counterparty contract flow: a MANUAL PAYMENT always pays cash
        // OUT — that one stays hardcoded because PAYMENT's ledger sign is a
        // force-negated bookkeeping convention (see above), not a real
        // direction signal, so sign-based derivation can't be trusted there.
        // An AUTOMATIC cashless PAYMENT (e.g. OMT App cashout) is the
        // exception: no drawer moves for this row (the wallet leg lives on
        // the caller's own transaction), so it is treated as the non-cash
        // accrual it actually is, same as every other entry_type
        // (TOP_UP/SALE_COST/ADJUSTMENT). SUPPLIER_PAYS_US is the supplier
        // crediting the shop (IN), even when cashless. Everything else
        // follows the same sign the ledger itself uses ("+ = shop owes
        // supplier" reads as the supplier extending value to the shop → IN;
        // a negative amount reads the opposite direction → OUT).
        const counterpartyFlow: "IN" | "OUT" =
          data.entry_type === "PAYMENT" && !data.is_auto
            ? "OUT"
            : isSupplierCredit
              ? "IN"
              : (amountUsd || amountLbp) < 0
                ? "OUT"
                : "IN";

        const txnId = getTransactionRepository().createTransaction({
          type: txnType as TransactionType,
          source_table: "supplier_ledger",
          source_id: entryId,
          user_id: data.created_by,
          amount_usd: journalUsd,
          amount_lbp: journalLbp,
          summary,
          metadata_json: {
            supplier_id: data.supplier_id,
            entry_type: data.entry_type,
            ...(isSupplierCredit ? { is_credit: true } : {}),
            // No `payments` row is ever inserted on this branch (no drawer
            // moves) — method is the journal-only marker, never a real
            // payment/settlement method.
            counterparty: buildCounterpartyMetadata({
              kind: "supplier",
              id: data.supplier_id,
              name: this._getSupplierName(data.supplier_id),
              flow: counterpartyFlow,
              method: "LEDGER",
              ledgerEntryId: entryId,
            }),
            // D2 (owner decision 2026-07-18): manual supplier payments show
            // on the Transactions page by default; auto-generated rows
            // (RechargeRepository/FinancialServiceRepository/Loto auto
            // supplier debt) stay behind the filter. This is the ONLY
            // addLedgerEntry branch that creates its own transaction row for
            // an is_auto:true caller (link-mode callers own their own
            // transaction's metadata and are out of this ticket's scope).
            ...(data.is_auto ? { is_auto: true } : {}),
          },
        });

        // Link supplier_ledger row to unified transaction
        this.db
          .prepare(
            `UPDATE supplier_ledger SET transaction_id = ? WHERE id = ? AND tenant_id = ?`,
          )
          .run(txnId, entryId, tenantId);
      }

      return { id: entryId };
    } catch (e) {
      throw new DatabaseError("Failed to add supplier ledger entry", {
        cause: e,
      });
    }
  }

  /**
   * SUPPLIER_STOCK_INTAKE_PLAN.md: the ONLY write path that books stock
   * intake against a supplier. Writes ONE 'STOCK_INTAKE' supplier_ledger row
   * (+qty * unit cost — the shop now owes the supplier that much more) and
   * its own unified transaction, inside ONE db.transaction(). No payments
   * row, no drawer delta, profit 0 — mirrors the no-drawer ADJUSTMENT branch
   * of addLedgerEntry, but kept as its own method (not routed through
   * addLedgerEntry) because the caller (InventoryService.receiveStock) needs
   * the raw ledgerEntryId/transactionId pair back to stamp the cost batch
   * row (ledger_entry_id/transaction_id), which addLedgerEntry's void {id}
   * shape doesn't carry.
   *
   * Reversal owner (rule 20): voiding the SUPPLIER_STOCK_INTAKE transaction
   * is the generic TransactionRepository void path (source_table
   * 'supplier_ledger' → soft-voids this row) PLUS StockBatchRepository
   * .deleteBatchForVoid, wired by whichever agent owns the void cascade —
   * this method only creates the row that void must find.
   */
  recordStockIntake(data: {
    supplier_id: number;
    product_id: number;
    product_name: string;
    quantity: number;
    unit_cost_usd: number;
    // REQUIRED, not nullable: this value flows straight into
    // createTransaction's user_id, and transactions.user_id is INTEGER NOT
    // NULL — passing null there is a constraint violation at runtime, on the
    // money path. This codebase deliberately stripped actor fallbacks
    // (|| 1 / ?? 1) from SupplierRepository so every method requires a real
    // actor and every caller passes the authenticated user; a missing actor
    // here is the caller's bug and must fail there, not be papered over with
    // an invented id.
    created_by: number;
  }): { ledgerEntryId: number; transactionId: number } {
    try {
      const tenantId = getCurrentTenantId();
      const amountUsd =
        Math.round(data.quantity * data.unit_cost_usd * 100) / 100;

      const run = this.db.transaction(() => {
        const note = `${data.quantity} × ${data.product_name} @ $${data.unit_cost_usd}`;
        // No source_ref_table/id here (this row is never link-mode and
        // never auto-hidden), so the schema-drift guard the other branches
        // need (_supplierLedgerHasSourceRefColumns) doesn't apply — plain
        // INSERT is safe against both column shapes.
        const stmt = this.db.prepare(`
            INSERT INTO supplier_ledger (
              supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, is_auto, tenant_id, created_at
            ) VALUES (?, 'STOCK_INTAKE', ?, 0, ?, ?, 0, ?, CURRENT_TIMESTAMP)
          `);
        const res = stmt.run(
          data.supplier_id,
          amountUsd,
          note,
          data.created_by,
          tenantId,
        );
        const ledgerEntryId = Number(res.lastInsertRowid);

        const txnId = getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.SUPPLIER_STOCK_INTAKE as TransactionType,
          source_table: "supplier_ledger",
          source_id: ledgerEntryId,
          user_id: data.created_by,
          amount_usd: amountUsd,
          amount_lbp: 0,
          profit_usd: 0,
          profit_lbp: 0,
          summary: `Stock received: ${data.quantity} × ${data.product_name} — ${this._getSupplierName(data.supplier_id)}`,
          metadata_json: {
            supplier_id: data.supplier_id,
            product_id: data.product_id,
            entry_type: "STOCK_INTAKE",
          },
        });

        this.db
          .prepare(
            `UPDATE supplier_ledger SET transaction_id = ? WHERE id = ? AND tenant_id = ?`,
          )
          .run(txnId, ledgerEntryId, tenantId);

        return { ledgerEntryId, transactionId: txnId };
      });
      return run();
    } catch (e) {
      throw new DatabaseError("Failed to record supplier stock intake", {
        cause: e,
      });
    }
  }

  getSupplierLedger(
    supplierId: number,
    limit = 200,
  ): SupplierLedgerEntryEntity[] {
    try {
      // LIRA-091: source_ref_table/source_ref_id only selected when present
      // (see _supplierLedgerHasSourceRefColumns) — same schema-drift guard as
      // addLedgerEntry's INSERT, so this stays safe against pre-v136 fixtures.
      const cols = this._supplierLedgerHasSourceRefColumns()
        ? "id, supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, transaction_id, is_auto, is_refunded, refunded_at, source_ref_table, source_ref_id, created_at"
        : "id, supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, transaction_id, is_auto, is_refunded, refunded_at, created_at";
      const prefixedCols = cols
        .split(", ")
        .map((c) => `l.${c}`)
        .join(", ");
      // Display-only enrichment for the Suppliers page Payments table
      // (BILL_COMMISSION_SETTLEMENT_PLAN.md follow-up, owner 2026-08-13): a
      // bills-only settlement's own SETTLEMENT ledger row is CONTRACTUALLY
      // amount_usd = amount_lbp = 0 (see `_bookBillsCommissionDrawerTopUp`'s
      // doc comment — the commission goes straight into the provider's own
      // drawer via a top-up, never through this ledger row's own amount),
      // so without this join the money that DID move (the commission) is
      // invisible in the ledger history — both currency cells read "—" even
      // though a real top-up happened. `supplier_settlements.commission_usd/
      // commission_lbp` is the batch's snapshot of exactly that number,
      // uniquely linked via `ledger_entry_id` (never by time proximity — the
      // LIRA-085 lesson). Deliberately NOT folded into `amount_usd`/
      // `amount_lbp` and NOT summed into any balance — the ledger balance
      // must stay byte-identical (lira-137's e2e guard asserts the delta is
      // 0 for a bills-only settlement); this is purely a read-side label for
      // a row whose real amount is legitimately zero.
      const hasSettlements = this._hasSupplierSettlementsTable();
      const selectSql = hasSettlements
        ? `SELECT ${prefixedCols}, ss.commission_usd AS settlement_commission_usd, ss.commission_lbp AS settlement_commission_lbp
           FROM supplier_ledger l
           LEFT JOIN supplier_settlements ss ON ss.ledger_entry_id = l.id AND ss.tenant_id = l.tenant_id
           WHERE l.supplier_id = ? AND l.tenant_id = ? ORDER BY l.created_at DESC LIMIT ?`
        : `SELECT ${prefixedCols}, NULL AS settlement_commission_usd, NULL AS settlement_commission_lbp
           FROM supplier_ledger l
           WHERE l.supplier_id = ? AND l.tenant_id = ? ORDER BY l.created_at DESC LIMIT ?`;
      return this.query<SupplierLedgerEntryEntity>(
        selectSql,
        supplierId,
        getCurrentTenantId(),
        limit,
      );
    } catch (e) {
      throw new DatabaseError("Failed to get supplier ledger", {
        cause: e,
        entityId: supplierId,
      });
    }
  }

  getManualPaymentPools(supplierId: number): {
    send_pool_usd: number;
    receive_pool_usd: number;
  } {
    try {
      const row = this.db
        .prepare(
          `SELECT
            ABS(COALESCE(SUM(CASE WHEN amount_usd < 0 THEN amount_usd ELSE 0 END), 0)) as send_pool_usd,
            COALESCE(SUM(CASE WHEN amount_usd > 0 THEN amount_usd ELSE 0 END), 0) as receive_pool_usd
          FROM supplier_ledger
          WHERE supplier_id = ? AND is_auto = 0 AND tenant_id = ? AND ${ledgerNotRefunded()}`,
        )
        .get(supplierId, getCurrentTenantId()) as
        | { send_pool_usd: number; receive_pool_usd: number }
        | undefined;
      return row ?? { send_pool_usd: 0, receive_pool_usd: 0 };
    } catch (e) {
      throw new DatabaseError("Failed to get manual payment pools", {
        cause: e,
      });
    }
  }

  /**
   * Rule 14 — the ONE ledger-sum SELECT shared by getProductSupplierBalances
   * and getSupplierBalances: both want "SUM of non-refunded supplier_ledger
   * rows per supplier", differing only in which suppliers are in scope. Never
   * paste this SUM/JOIN a second time — add a new caller by passing a WHERE.
   */
  private _ledgerBalanceQuery(whereClause: string): string {
    return `
        SELECT
          s.id as supplier_id,
          COALESCE(SUM(l.amount_usd), 0) as total_usd,
          COALESCE(SUM(l.amount_lbp), 0) as total_lbp
        FROM suppliers s
        LEFT JOIN supplier_ledger l ON l.supplier_id = s.id AND l.tenant_id = s.tenant_id AND ${ledgerNotRefunded("l.")}
        WHERE ${whereClause}
        GROUP BY s.id
        ORDER BY s.name ASC
      `;
  }

  /**
   * SUPPLIER_STOCK_INTAKE_PLAN.md — LEDGER-ONLY balance, restricted to
   * is_system = 0 suppliers that have a linked product_suppliers row.
   *
   * This REPLACES the old recompute-from-live-inventory query, which had two
   * bugs that die with this rewrite:
   *  (a) it JOINed product_suppliers directly onto suppliers without
   *      aggregating first, then GROUPed BY s.id — so a supplier linked to N
   *      product_suppliers rows had its ledger SUM(l.amount_usd) silently
   *      multiplied by N (the join fans out before the aggregate runs);
   *  (b) it added SUM(live stock_quantity * live cost_price_usd) on top of
   *      the ledger — so a POS sale (lowers stock) shrank what the shop
   *      "owed", a refund raised it, and a cost-price edit re-priced
   *      already-settled history. This is the entire recompute bug the
   *      stock-intake project exists to fix: balance is now the ledger sum
   *      ONLY (event-based booking via recordStockIntake), matching
   *      getSupplierBalances' definition exactly.
   *
   * total_lbp now reflects real LBP payment legs (supplier_ledger.amount_lbp)
   * instead of the old hardcoded 0.
   */
  getProductSupplierBalances(): SupplierBalance[] {
    try {
      const tenantId = getCurrentTenantId();
      return this.query<SupplierBalance>(
        this._ledgerBalanceQuery(`
          s.is_system = 0 AND s.is_active = 1 AND s.tenant_id = ?
          AND EXISTS (
            SELECT 1 FROM product_suppliers ps
            WHERE ps.supplier_id = s.id AND ps.tenant_id = s.tenant_id
          )
        `),
        tenantId,
      );
    } catch (e) {
      throw new DatabaseError("Failed to get product supplier balances", {
        cause: e,
      });
    }
  }

  getSupplierBalances(includeInactive?: boolean): SupplierBalance[] {
    try {
      const tenantId = getCurrentTenantId();
      // Hide the SECONDARY OMT/WHISH system (obligations live in partner_ledger).
      // COALESCE the NULL provider: `NULL IN (...)` is SQL NULL, and
      // `NOT (NULL AND …)` is NULL too — without it, every provider-less
      // supplier was silently dropped from the balances list (latent bug
      // caught by lira-web-015). LIRA-191: shared with listSuppliers (rule
      // 14) via _secondarySystemHideClause, which also carries the
      // active-children exemption (see its own doc comment).
      const filter = includeInactive
        ? "s.tenant_id = ?"
        : `s.tenant_id = ? AND s.is_active = 1
           AND ${this._secondarySystemHideClause("s")}`;
      // OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-188) — an account CHILD
      // (`account_supplier_id` set — 'OMT App' / 'iPick' under 'OMT') no
      // longer appears as its own top-level balance card; it surfaces only
      // inside its account's sub-rows (getAccountBalances below). The
      // account PARENT keeps appearing here unchanged — it's still a real
      // top-level supplier row whose balance also happens to get rolled up
      // elsewhere. Gated on the same schema-drift guard as getColumns() so a
      // connection/fixture that predates v176 keeps returning every
      // supplier, unchanged (zero behaviour change per the plan's LIRA-187
      // acceptance criterion).
      const excludeAccountChildren = this._suppliersHasAccountLinkColumn()
        ? " AND s.account_supplier_id IS NULL"
        : "";
      return this.query<SupplierBalance>(
        this._ledgerBalanceQuery(filter + excludeAccountChildren),
        tenantId,
      );
    } catch (e) {
      throw new DatabaseError("Failed to get supplier balances", { cause: e });
    }
  }

  /**
   * OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-187/188) — the OMT open-credit
   * account, rolled up per parent: every supplier that either IS a parent
   * (some other supplier points at it via `account_supplier_id`) or IS a
   * child (points at one). Reuses `_ledgerBalanceQuery` (rule 14 — never
   * paste its SUM/JOIN) for the per-member currency totals; the roll-up
   * itself (grouping members under `COALESCE(account_supplier_id, id)`) and
   * the `drawer_name` enrichment happen in a second, JS-side pass, because
   * `_ledgerBalanceQuery` only ever returns `supplier_id`/totals, never
   * name/provider metadata.
   *
   * `drawer_name` comes from `service_providers.drawer_name` (joined on
   * provider code, LIRA-188) — never a hardcoded provider→drawer map.
   */
  getAccountBalances(): AccountBalance[] {
    try {
      if (!this._suppliersHasAccountLinkColumn()) return [];
      const tenantId = getCurrentTenantId();

      // Rule 14 — this exact WHERE is used for BOTH the balance projection
      // (_ledgerBalanceQuery) and the metadata projection below; never typed
      // twice.
      const accountMemberWhere = `
        s.tenant_id = ?
        AND (s.account_supplier_id IS NOT NULL
             OR EXISTS (
               SELECT 1 FROM suppliers c
               WHERE c.account_supplier_id = s.id AND c.tenant_id = s.tenant_id
             ))
      `;

      // This DOES exclude refunded rows (via `_ledgerBalanceQuery`'s
      // `ledgerNotRefunded`) — deliberately unlike `getAccountLedger`
      // above: a balance must not count voided money, while the ledger
      // LIST still shows voided history for the "Voided" badge. Don't
      // unify the two predicates.
      const balances = this.query<SupplierBalance>(
        this._ledgerBalanceQuery(accountMemberWhere),
        tenantId,
      );
      const balanceBySupplierId = new Map(
        balances.map((b) => [b.supplier_id, b] as const),
      );

      const hasServiceProviders = this._hasServiceProvidersTable();
      const metaSql = hasServiceProviders
        ? `SELECT s.id AS id, s.name AS name, s.provider AS provider,
                  s.account_supplier_id AS account_supplier_id, sp.drawer_name AS drawer_name
             FROM suppliers s
             LEFT JOIN service_providers sp ON sp.code = s.provider AND sp.tenant_id = s.tenant_id
             WHERE ${accountMemberWhere}`
        : `SELECT s.id AS id, s.name AS name, s.provider AS provider,
                  s.account_supplier_id AS account_supplier_id, NULL AS drawer_name
             FROM suppliers s
             WHERE ${accountMemberWhere}`;
      const members = this.db.prepare(metaSql).all(tenantId) as {
        id: number;
        name: string;
        provider: string | null;
        account_supplier_id: number | null;
        drawer_name: string | null;
      }[];

      const accounts = new Map<number, AccountBalance>();
      for (const member of members) {
        const parentId = member.account_supplier_id ?? member.id;
        const isParent = member.id === parentId;
        let account = accounts.get(parentId);
        if (!account) {
          account = {
            account_supplier_id: parentId,
            account_name: "",
            total_usd: 0,
            total_lbp: 0,
            children: [],
          };
          accounts.set(parentId, account);
        }
        if (isParent) account.account_name = member.name;

        const bal = balanceBySupplierId.get(member.id);
        const total_usd = bal?.total_usd ?? 0;
        const total_lbp = bal?.total_lbp ?? 0;
        account.total_usd += total_usd;
        account.total_lbp += total_lbp;
        account.children.push({
          supplier_id: member.id,
          name: member.name,
          provider: member.provider,
          drawer_name: member.drawer_name,
          total_usd,
          total_lbp,
          is_parent: isParent,
        });
      }

      // Parent sub-row first, then children alphabetically — deterministic,
      // not incidental to whatever order SQLite happened to return.
      for (const account of accounts.values()) {
        account.children.sort((a, b) => {
          if (a.is_parent !== b.is_parent) return a.is_parent ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      }

      return Array.from(accounts.values()).sort((a, b) =>
        a.account_name.localeCompare(b.account_name),
      );
    } catch (e) {
      throw new DatabaseError("Failed to get account balances", { cause: e });
    }
  }

  /**
   * OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-188) — the account's merged
   * `supplier_ledger` history: the parent's rows UNIONed with every child's
   * (ledger rows never move — plan §2), each carrying which member it
   * actually belongs to (`source_provider`/`source_name`) for the Suppliers
   * page's Type column. Newest first.
   *
   * Deliberately does NOT apply `ledgerNotRefunded` — matches
   * `getSupplierLedger`'s precedent: the ledger is a HISTORY view, so a
   * voided row stays in it (still carrying `is_refunded`) so the UI can
   * render it greyed out with a "Voided" badge instead of silently
   * disappearing. This is NOT the same predicate as `getAccountBalances`
   * below, which DOES exclude refunded rows — a balance must not count
   * voided money. See the comment there.
   */
  getAccountLedger(
    accountSupplierId: number,
    limit = 200,
  ): AccountLedgerEntry[] {
    try {
      if (!this._suppliersHasAccountLinkColumn()) return [];
      const tenantId = getCurrentTenantId();
      const settlementCol = this._supplierLedgerHasSettlementIdColumn()
        ? "l.settlement_id AS settlement_id"
        : "NULL AS settlement_id";
      return this.db
        .prepare(
          `SELECT
             l.id AS id, l.supplier_id AS supplier_id,
             s.provider AS source_provider, s.name AS source_name,
             l.entry_type AS entry_type, l.amount_usd AS amount_usd, l.amount_lbp AS amount_lbp,
             l.note AS note, l.created_at AS created_at, l.is_refunded AS is_refunded,
             ${settlementCol}
           FROM supplier_ledger l
           JOIN suppliers s ON s.id = l.supplier_id AND s.tenant_id = l.tenant_id
           WHERE ${accountMemberOf("s.")} AND s.tenant_id = ?
           ORDER BY l.created_at DESC, l.id DESC
           LIMIT ?`,
        )
        .all(
          accountSupplierId,
          accountSupplierId,
          tenantId,
          limit,
        ) as AccountLedgerEntry[];
    } catch (e) {
      throw new DatabaseError("Failed to get account ledger", {
        cause: e,
        entityId: accountSupplierId,
      });
    }
  }

  /** Member suppliers (parent + children) of the account rooted at
   *  `accountSupplierId` — shared by `getAccountUnsettled` to resolve which
   *  provider(s) to ask `FinancialServiceRepository` about. */
  private _getAccountMembers(
    accountSupplierId: number,
    tenantId: number,
  ): { id: number; provider: string | null; name: string }[] {
    return this.db
      .prepare(
        `SELECT id, provider, name FROM suppliers WHERE tenant_id = ? AND ${accountMemberOf(
          "",
        )}`,
      )
      .all(tenantId, accountSupplierId, accountSupplierId) as {
      id: number;
      provider: string | null;
      name: string;
    }[];
  }

  /**
   * OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-188, plan §9.3) — the account's
   * settlement queue, unioning TWO structurally different sources:
   *
   *  (a) `financial_services` rows still pending settlement, per member
   *      provider — reuses `FinancialServiceRepository.getUnsettledBySupplier`
   *      (rule 14: never re-paste its `pendingSettlementSql()`/
   *      `SUPPLIER_OWED_EXPR` logic here). This is the OMT counter's own
   *      queue today.
   *  (b) raw `supplier_ledger` rows with no settlement batch yet
   *      (`settlement_id IS NULL`, non-zero amount) — iPick/OMT App
   *      supplier-credit debt, which has no `financial_services` row at
   *      all. EXCLUDES rows already counted in (a): the OMT counter's own
   *      auto ledger sibling is written with `source_ref_table =
   *      'financial_services'` (LIRA-091) and is already represented by its
   *      financial_services row above — without this exclusion the
   *      counter's debt would be double-counted once its own ledger row is
   *      unioned in too.
   *
   * Ordered oldest-first, matching `getUnsettledBySupplier`'s own
   * convention (and D8's "oldest pre-selected" allocation, built in wave 2).
   */
  getAccountUnsettled(accountSupplierId: number): AccountUnsettledRow[] {
    try {
      const tenantId = getCurrentTenantId();
      const members = this._getAccountMembers(accountSupplierId, tenantId);

      const financialServiceRows: AccountUnsettledRow[] = [];
      const financialServiceRepo = getFinancialServiceRepository();
      for (const member of members) {
        if (!member.provider) continue;
        const rows = financialServiceRepo.getUnsettledBySupplier(
          member.provider,
        );
        for (const row of rows) {
          financialServiceRows.push({
            kind: "FINANCIAL_SERVICE",
            id: row.id,
            supplier_id: member.id,
            source_provider: member.provider,
            source_name: member.name,
            created_at: row.created_at,
            amount_usd: row.currency === "USD" ? row.supplier_owed : 0,
            amount_lbp: row.currency === "LBP" ? row.supplier_owed : 0,
            entry_type: null,
            service_type: row.service_type,
            // A FINANCIAL_SERVICE row is never a WALLET_CASHOUT credit (D14
            // only ever stamps cashout commission onto a raw LEDGER row —
            // see `_cashoutCommissionByLedgerId`'s own doc comment).
            commission_usd: 0,
            commission_lbp: 0,
          });
        }
      }

      let ledgerRows: AccountUnsettledRow[] = [];
      if (this._supplierLedgerHasSettlementIdColumn()) {
        const excludeFsSiblings = this._supplierLedgerHasSourceRefColumns()
          ? "AND COALESCE(l.source_ref_table, '') <> 'financial_services'"
          : "";
        const rows = this.db
          .prepare(
            `SELECT
               l.id AS id, l.supplier_id AS supplier_id,
               s.provider AS source_provider, s.name AS source_name,
               l.created_at AS created_at, l.amount_usd AS amount_usd, l.amount_lbp AS amount_lbp,
               l.entry_type AS entry_type
             FROM supplier_ledger l
             JOIN suppliers s ON s.id = l.supplier_id AND s.tenant_id = l.tenant_id
             WHERE ${accountMemberOf("s.")} AND s.tenant_id = ?
               AND l.settlement_id IS NULL
               AND (l.amount_usd <> 0 OR l.amount_lbp <> 0)
               AND ${ledgerNotRefunded("l.")}
               ${excludeFsSiblings}`,
          )
          .all(accountSupplierId, accountSupplierId, tenantId) as {
          id: number;
          supplier_id: number;
          source_provider: string | null;
          source_name: string;
          created_at: string;
          amount_usd: number;
          amount_lbp: number;
          entry_type: string;
        }[];
        // D14 preview (the bug this method exists to fix) — reads the SAME
        // per-row commission `_sumCashoutCommission` sums for `settleAccount`
        // itself (rule 14: one shared helper, `_cashoutCommissionByLedgerId`,
        // so the sheet's preview and the eventual profit stamp can never
        // diverge). Computed in one batched lookup for every ledger row
        // returned here, not once per row.
        const commissionByLedgerId = this._cashoutCommissionByLedgerId(
          rows.map((r) => r.id),
          tenantId,
        );
        ledgerRows = rows.map((r) => {
          const commission = commissionByLedgerId.get(r.id);
          return {
            kind: "LEDGER" as const,
            id: r.id,
            supplier_id: r.supplier_id,
            source_provider: r.source_provider,
            source_name: r.source_name,
            created_at: r.created_at,
            amount_usd: r.amount_usd,
            amount_lbp: r.amount_lbp,
            entry_type: r.entry_type,
            service_type: null,
            commission_usd: commission?.usd ?? 0,
            commission_lbp: commission?.lbp ?? 0,
          };
        });
      }

      return [...financialServiceRows, ...ledgerRows].sort((a, b) =>
        a.created_at.localeCompare(b.created_at),
      );
    } catch (e) {
      throw new DatabaseError("Failed to get account unsettled transactions", {
        cause: e,
        entityId: accountSupplierId,
      });
    }
  }

  /**
   * LIRA-193 (OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §11.4) — ONE predicate (rule
   * 14) for "this leg can settle/pay a supplier", shared by
   * `settleTransactions` and `recordSupplierCashflow` so their leg
   * reconciliation and their posting loop can never again independently
   * decide which legs count. That drift is the exact defect this ticket
   * closes: on both shipped methods, the amount recorded as settled/paid
   * counted EVERY leg while the posting loop silently `continue`d past any
   * leg `isDrawerAffectingMethod` excludes (CUSTOMER_ACCOUNT, GIFT_CARD) —
   * a $150 CASH leg could "settle" a $100 debt with the $50 difference
   * leaving no ledger row, no profit stamp, no kept-change record; a batch
   * made entirely of CUSTOMER_ACCOUNT legs could stamp fully settled/paid
   * while zero dollars actually moved.
   *
   * Mirrors `settleAccount`'s own local `assertLegMovesADrawer` closure
   * (LIRA-189 — that method is done and is deliberately NOT touched here);
   * this is the identical fix ported to the two shipped methods that
   * predate it. A supplier settlement/cashflow has no customer to charge via
   * CUSTOMER_ACCOUNT and no gift card to redeem, so a non-drawer-affecting
   * method here is meaningless — reject it outright, never silently drop
   * the leg, so the caller learns exactly which method is the problem.
   */
  private _assertSupplierLegMovesADrawer(
    method: string,
    context: string,
  ): void {
    if (!isDrawerAffectingMethod(method)) {
      throw new DatabaseError(
        `${context}: payment method "${method}" does not move a real ` +
          `drawer and cannot settle/pay a supplier (no customer to charge, ` +
          `no gift card to redeem)`,
      );
    }
  }

  /**
   * Same bug class as LIRA-193 above, one branch it didn't reach — a
   * sibling to `_assertSupplierLegMovesADrawer` (kept separate rather than
   * merged into it: the two are independent questions — "does this METHOD
   * move a drawer" vs "is this CURRENCY one we track" — and the Other-
   * payment reconciliation sum below has never called the method-check
   * helper at all, since `_bookBillsCommissionViaPaymentLegs`'s own
   * `isDrawerAffectingMethod` check already guards that further down; adding
   * an unrelated method check to the sum loop here would be scope creep, not
   * a fix). This currency check, by contrast, belongs at BOTH the sum and
   * the posting step, exactly like the method check does for the cash-owed
   * path, so it is pulled out once (rule 14) instead of re-typed at each.
   *
   * Before this helper: `settleTransactions`' Other-payment commission
   * reconciliation sum bucketed ANY `currency_code` that wasn't literally
   * `"LBP"` into the USD bucket — `"usd"` (lowercase), `"EUR"`, a typo, all
   * silently counted as USD and let the sum "reconcile" against the entered
   * commission. `_bookBillsCommissionViaPaymentLegs`'s posting loop then
   * forwarded that same raw, unvalidated `currency_code` straight to
   * `applyDrawerDelta`/`insertPaymentRow`, crediting a phantom
   * `("<drawer>", "usd")` (or `"EUR"`) row that no closing screen or report
   * ever queries — while `supplier_settlements.commission_usd` and the
   * settlement transaction's `profit_usd` both still record the money as
   * real USD collected. The record and the drawer then permanently
   * disagree. Reject outright, exactly like the `owesCash` leg loop and
   * `settleAccount` already do (never silently coerce or bucket an
   * unrecognised code) — also reused there in place of each method's own
   * hand-typed `!== "USD" && !== "LBP"` check, so this is the only place
   * that decision is written.
   */
  private _assertSupplierLegCurrencyIsValid(
    currencyCode: string,
    context: string,
  ): void {
    if (currencyCode !== "USD" && currencyCode !== "LBP") {
      throw new DatabaseError(
        `${context}: payment leg currency "${currencyCode}" is not USD or LBP`,
      );
    }
  }

  /**
   * Atomically settle a batch of financial_services transactions with a supplier.
   *
   * Primary Cash Drawer model (docs/plans/todo_plans/PRIMARY_CASH_DRAWER_PLAN.md
   * §1/§8.3 — supersedes PR #66's float model): `supplier_ledger` TOP_UP rows
   * for OMT/WHISH are booked GROSS (`grossOwedDelta`,
   * FinancialServiceRepository.ts) — principal + fee − commission — so the
   * shop's commission is embedded in what's owed, not carved out separately.
   * Settlement pays off that same gross figure and marks the rows settled;
   * there is no separate "realize the commission" step (no
   * `SUPPLIER_PAYS_US` credit row) — the commission simply stays behind as
   * the difference between what was collected and what's remitted.
   * `OMT_System`/`Whish_System` is no longer a provider float — it IS the
   * shop's physical primary cash drawer (PCD), so a settlement paid in CASH
   * against the shop's PRIMARY-system supplier now resolves that leg to the
   * PCD (decision #10, via `resolveServiceCashDrawer`); a non-primary
   * supplier's settlement is unaffected and keeps its existing drawer
   * (General / the method's own wallet drawer).
   *
   * COMMISSION_AT_SETTLEMENT_PLAN.md D2/D3/D4/D5/D6 — the batch's commission
   * MODEL is derived server-side from the selected rows' own
   * `commission_model` (never trusted from the caller): a batch mixing model
   * 0 (EMBEDDED, legacy) and model 1 (AT_SETTLEMENT) rows is hard-rejected
   * (D4) — entering one commission figure across rows whose payable was
   * computed two different ways would double-net the legacy rows' already-
   * embedded cut. A LEGACY batch (every row model 0, or the connected schema
   * predates migration v150) runs byte-for-byte the same steps 1-4 below as
   * before this plan. A NEW-MODEL batch (every eligible row model 1) runs
   * steps 1-4 unchanged AND an additional step 5: the real commission record
   * (D5 `supplier_settlements` + D6 `settlement_commission_allocations`,
   * largest-remainder proportional split) and the commission credit itself
   * (a `SUPPLIER_PAYS_US` ledger row).
   *
   * In a single DB transaction:
   * 1. Insert a SETTLEMENT-typed supplier_ledger entry (negative = shop
   *    paying out `amount_usd`/`amount_lbp`, the gross amount already
   *    owed — nets the ledger to 0 against the TOP_UP rows being settled)
   * 2. Mark all specified financial_services rows as is_settled = 1
   * 3. Create unified transactions row for audit trail (commission stamped
   *    as informational metadata only — no separate drawer effect for a
   *    legacy batch)
   * 4. Debit the net payment through real payment-method legs (`payments[]`,
   *    same mechanism as `recordSupplierCashflow`, resolved through
   *    `resolveServiceCashDrawer`) — never a bare named drawer (see
   *    `SettleTransactionsData.drawer_name`'s deprecation)
   * 5. NEW-MODEL batches only — book the commission (see
   *    `_bookCommissionAtSettlement`'s own doc comment)
   */
  settleTransactions(data: SettleTransactionsData): { id: number } {
    if (!data.financial_service_ids.length) {
      throw new DatabaseError("No transactions selected for settlement");
    }
    // Reviewer finding #3 (harden) — same throw-before-try tier as the
    // mixed-model-batch guard below: reject BEFORE any write when the
    // caller's financial_service_ids don't actually belong to
    // data.supplier_id. See _verifySupplierOwnership's own doc comment.
    //
    // Moved AHEAD of the two cash-owed guards below (was previously AFTER
    // them) — the commission-collection-mode follow-up needs
    // `isBillsOnlyBatch` resolved before it can decide whether the reverse
    // hazard guard's exception (a bills-only "Other payment" leg-set) even
    // applies, and ownership/batch-model resolution is read-only either way,
    // so reordering it changes no committed behavior for any single-guard
    // violation — only which of several SIMULTANEOUS violations a caller
    // sees first, which no existing test depends on.
    this._verifySupplierOwnership(
      data.financial_service_ids,
      data.supplier_id,
      getCurrentTenantId(),
    );

    // COMMISSION_AT_SETTLEMENT_PLAN.md D2/D3/D4 — resolve BEFORE the generic
    // try/catch below (same tier as the two validations above, deliberately
    // NOT wrapped into "Failed to settle transactions" — the shared contract
    // names this exact error string, so a caller pattern-matching on it must
    // see it verbatim): which of the caller's IDs are still eligible (mirrors
    // the UPDATE's own WHERE clause exactly) and their shared commission
    // model. Throws before any write if the batch is mixed.
    const { model: batchModel, rows: eligibleRows } =
      this._resolveSettlementBatchModel(
        data.financial_service_ids,
        getCurrentTenantId(),
      );
    // BILL_COMMISSION_SETTLEMENT_PLAN.md — narrow scope (owner, 2026-08-11):
    // the drawer-top-up-and-profit treatment applies ONLY when every
    // eligible row is a BILL. `commission_model = 1` is NO LONGER
    // BILL-exclusive: commit 43948a35 (LIRA-095) widened the stamp so
    // OMT/WHISH SEND/RECEIVE are ALSO born model-1 (FinancialServiceRepository's
    // own comment on that stamp), so `isBillsOnlyBatch` and `batchModel === 1`
    // are genuinely DIFFERENT today — gating on service_type is what keeps
    // an OMT/WHISH new-model batch OFF the bills' drawer-top-up-and-profit
    // path and on the cashless SUPPLIER_PAYS_US path below. That split is
    // load-bearing twice over: it is the ONLY thing separating "real money
    // arrived" from "nothing arrived", and per LIRA-158 owner decision D17
    // (docs/plans/done_plans/LIRA-158_COMMISSION_REPORTING_PLAN.md §8) it is
    // now also what decides immediate vs deferred commission recognition —
    // bills recognise immediately (real money in the drawer), OMT/WHISH
    // defers until the row's own client debt is covered. LIRA-138 still
    // tracks generalising the MONEY treatment itself (the drawer top-up)
    // past bills-only; that part remains genuinely unbuilt — a non-bills
    // model-1 batch still always takes the cashless path below, it never
    // silently inherits "top up a drawer" semantics that were never decided
    // for it.
    const isBillsOnlyBatch =
      batchModel === 1 &&
      eligibleRows.length > 0 &&
      eligibleRows.every((r) => r.service_type === "BILL");

    const owesCash =
      Math.abs(data.amount_usd) > 0.005 || Math.abs(data.amount_lbp) > 0.005;
    if (owesCash && !data.payments?.length) {
      throw new DatabaseError(
        "Settlement requires at least one payment-method leg to pay the net amount owed",
      );
    }
    // BILL_COMMISSION_SETTLEMENT_PLAN.md (LIRA-137 Q2) — the REVERSE hazard:
    // a $0/0-LBP-owed batch (the bills-only shape — a bill's principal never
    // touches the ledger, so gross owed is structurally 0) has no
    // contractual cash amount for a payment-method leg to pay. Before this
    // guard, a forced leg here would debit a real drawer with NO matching
    // ledger/gross entry — the settlement's own SETTLEMENT row still nets to
    // $0.00/0 LBP.
    //
    // Follow-up (owner, 2026-08-13) — this guard must now distinguish TWO
    // reasons a bills-only batch can carry legs while owing $0/0 LBP net:
    //   (a) legs because the operator chose "Other payment" for HOW the
    //       commission is collected (`commission_collection_mode ===
    //       "OTHER_PAYMENT"`, server-verified `isBillsOnlyBatch === true`) —
    //       these are not a net-pay tender at all, they ARE the commission
    //       collection, and are accepted ONLY once their sum (per currency)
    //       matches the entered commission — a leg total that disagreed
    //       would credit a drawer with a different amount than the profit/
    //       allocation records claim, the same class of hazard this guard
    //       exists to catch, just inverted.
    //   (b) every other shape — the original hazard, still rejected exactly
    //       as before: a legacy/OMT batch with nothing owed, a bills-only
    //       batch left in (default) "Top-up" mode, or ANY batch where the
    //       mode flag is absent/mistyped.
    // The frontend only ever offers a tender form for shape (a) — no
    // MultiPaymentInput renders for "Top-up" mode or a non-bills-only batch
    // (Suppliers/index.tsx's isBillsOnlyBatch/mode gates) — but this
    // repository is the single source of truth for every caller (raw IPC/
    // REST, a future script), so both branches are enforced here too.
    const isOtherPaymentCommission =
      isBillsOnlyBatch && data.commission_collection_mode === "OTHER_PAYMENT";
    if (!owesCash && data.payments?.length) {
      if (!isOtherPaymentCommission) {
        throw new DatabaseError(
          "Settlement has no cash owed — payment-method legs are not accepted (a bills-only commission books as a provider-drawer credit, never a cash payment)",
        );
      }
      // Sum the Other-payment legs per currency and require an EXACT match
      // (same 0.005 tolerance as every other cash-owed check in this
      // method) against the entered commission — never a cross-currency
      // conversion here (this payload carries no exchange rate to convert
      // at; the UI always offers the leg sheet in the SAME currency the
      // commission was entered in).
      const legSum = data.payments.reduce(
        (acc, p) => {
          // LIRA-193 follow-up — reject before bucketing (see
          // `_assertSupplierLegCurrencyIsValid`'s own doc comment): without
          // this, any currency_code that wasn't literally "LBP" (a
          // lowercase "usd", "EUR", a typo) fell into the `else` and was
          // silently counted as USD here, then posted verbatim by
          // `_bookBillsCommissionViaPaymentLegs` below.
          this._assertSupplierLegCurrencyIsValid(
            p.currency_code,
            "Other-payment commission leg",
          );
          const amt = Math.abs(p.amount);
          if (p.currency_code === "LBP") acc.lbp += amt;
          else acc.usd += amt;
          return acc;
        },
        { usd: 0, lbp: 0 },
      );
      if (
        Math.abs(legSum.usd - data.commission_usd) > 0.005 ||
        Math.abs(legSum.lbp - data.commission_lbp) > 0.005
      ) {
        throw new DatabaseError(
          `Other-payment commission legs must sum to the entered commission exactly ` +
            `(entered $${data.commission_usd.toFixed(2)} + ${data.commission_lbp} LBP, ` +
            `legs summed to $${legSum.usd.toFixed(2)} + ${legSum.lbp} LBP)`,
        );
      }
    }

    // ── LIRA-193 (OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §11.4) ───────────────────
    // Before this guard, the ONLY check on the normal cash-owed path was "at
    // least one leg exists" (above) — `data.payments` was never reconciled
    // against `amount_usd`/`amount_lbp` at all, and the posting loop (step 4
    // below) silently `continue`d past any leg `isDrawerAffectingMethod`
    // excludes. A $100 debt paid with a $150 CASH leg reconciled clean (the
    // drawer would drop the full $150 while the ledger only nets $100 — a
    // $50 leak with no ledger row, no profit stamp, no kept-change record);
    // a batch paid entirely in CUSTOMER_ACCOUNT/GIFT_CARD legs passed the
    // "at least one leg" check and was stamped fully settled while the
    // posting loop skipped every leg — zero dollars moving. Same bug class
    // `settleAccount`'s step 4b/E closes (LIRA-189) — ported here, not
    // reinvented (rule 14): the SAME shared predicate
    // (`_assertSupplierLegMovesADrawer`) decides which legs count here AND
    // in the posting loop below, so the two can never again independently
    // drift.
    //
    // `owesCash` and `isOtherPaymentCommission` are contractually mutually
    // exclusive in every shape the UI can produce (Other-payment mode only
    // ever appears for a $0/0-LBP-owed bills-only batch — see the reverse-
    // hazard guard above) — but unlike `settleAccount` (which recomputes the
    // net owed from `selections` server-side), `amount_usd`/`amount_lbp` are
    // trusted verbatim from the caller here, so nothing structurally stops a
    // caller from claiming BOTH a nonzero net owed AND Other-payment
    // commission collection in the same request. Left unguarded, that
    // combination would reach the write transaction, skip BOTH the net-pay
    // debit loop (gated `!isOtherPaymentCommission`, step 4 below) AND this
    // reconciliation, and stamp a nonzero `amount_usd`/`amount_lbp` as
    // settled while no leg ever paid it — the same "stamped settled, zero
    // dollars moved" leak this ticket closes, reached from a different
    // angle. Rejected outright: this repository is the trust boundary
    // (reachable over raw IPC/REST), never something to leave to the UI
    // alone to prevent.
    if (owesCash && isOtherPaymentCommission) {
      throw new DatabaseError(
        "Settlement cannot combine a nonzero net amount owed with an " +
          "Other-payment commission collection — the Other-payment legs are " +
          "reserved for the commission and cannot also pay the settled amount",
      );
    }
    if (owesCash) {
      // No IN/OUT partition needed, by construction: a leg carrying
      // `direction: "OUT"` is rejected outright immediately below, exactly
      // like `settleAccount`'s own blanket ban (Finding A) — a supplier
      // settlement has no customer to hand change back to. Verified before
      // adding this: neither this method nor any of its existing callers
      // (electron-app/handlers/supplierHandlers.ts, backend/src/api/
      // suppliers.ts, the Suppliers settle UI) ever sends one — the field
      // exists on the shared leg shape only because the runtime validator
      // schema is shared with `settleAccount`/`recordSupplierCashflow` (see
      // `SettleTransactionsData.payments`'s own doc comment) — so rejecting
      // it here closes an untested capability gap with no legitimate sender
      // to accommodate, the same conclusion LIRA-189 reached for
      // `settleAccount`.
      let legSumUsd = 0;
      let legSumLbp = 0;
      for (const leg of data.payments!) {
        if (leg.direction === "OUT") {
          throw new DatabaseError(
            "Settlement does not accept OUT (change/return) legs — a " +
              "supplier settlement has no customer to hand change back to; " +
              "pay exactly the net amount owed",
          );
        }
        this._assertSupplierLegMovesADrawer(leg.method, "Settlement");
        this._assertSupplierLegCurrencyIsValid(leg.currency_code, "Settlement");
        const amt = Math.abs(leg.amount);
        if (leg.currency_code === "USD") legSumUsd += amt;
        else legSumLbp += amt;
      }
      if (
        Math.abs(legSumUsd - data.amount_usd) > 0.005 ||
        Math.abs(legSumLbp - data.amount_lbp) > 0.005
      ) {
        throw new DatabaseError(
          `Settlement payment legs do not reconcile to the net amount owed — ` +
            `expected $${data.amount_usd.toFixed(2)} + ${data.amount_lbp} LBP, ` +
            `got $${legSumUsd.toFixed(2)} + ${legSumLbp} LBP`,
        );
      }
    }

    try {
      const tenantId = getCurrentTenantId();
      // Primary Cash Drawer plan §1/§8.2 (decision #10): resolve once,
      // read-only, before the write transaction below — a settlement whose
      // supplier IS the shop's primary provider (shop_base_system) pays its
      // CASH legs out of the PCD, not General.
      const supplier = this.findById(data.supplier_id);
      const drawerCtx: ServiceCashDrawerContext = {
        provider: supplier?.provider ?? "",
        baseSystem: getSettingsService().getShopBaseSystem(),
      };
      const settle = this.db.transaction(() => {
        // Timestamps are stamped by SQLite (datetime('now')) so they share the
        // 'YYYY-MM-DD HH:MM:SS' format of every CURRENT_TIMESTAMP column. A JS
        // toISOString() here ('...T...Z') string-sorts ABOVE all space-format
        // rows of the same day, pinning settlement rows to the top of every
        // ORDER BY created_at DESC list (A6).

        // ── 1. Insert SETTLEMENT ledger entry (net paid to supplier, stored negative) ──
        const netUsd = -Math.abs(data.amount_usd);
        const netLbp = -Math.abs(data.amount_lbp);
        const ledgerRes = this.db
          .prepare(
            `INSERT INTO supplier_ledger
               (supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, tenant_id, created_at)
             VALUES (?, 'SETTLEMENT', ?, ?, ?, ?, ?, datetime('now'))`,
          )
          .run(
            data.supplier_id,
            netUsd,
            netLbp,
            data.note ?? null,
            data.created_by,
            tenantId,
          );
        const ledgerEntryId = Number(ledgerRes.lastInsertRowid);

        // ── 2. Mark financial_services rows as settled ─────────────────────
        // Extracted to `_markFinancialServicesSettled` (rule 14) — LIRA-189's
        // `settleAccount` calls the SAME helper once per account member
        // instead of pasting this UPDATE a second time. Byte-identical SQL/
        // params to the pre-extraction inline version.
        this._markFinancialServicesSettled(
          data.financial_service_ids,
          ledgerEntryId,
          tenantId,
        );

        // ── 3. Create unified transaction for audit trail ──────────────────
        // CQ-7: funneled through the single createTransaction() gate instead
        // of a raw INSERT — the row now gains the funnel's completeness
        // guards and exchange-rate snapshot (previously always NULL here).
        //
        // Primary Cash Drawer model (plan §8.3): NO separate "realize the
        // commission" step exists for a LEGACY/OMT-shaped batch.
        // `commission_usd`/`commission_lbp` are stamped below purely as
        // audit metadata for that shape — under the GROSS model the shop's
        // cut is already embedded in `amount_usd`/`amount_lbp` (and in the
        // TOP_UP rows being settled) via `grossOwedDelta`, so there is
        // nothing left to fund/credit here; there is no separate
        // `drawer += commission` pair or `SUPPLIER_PAYS_US` ledger row — that
        // would double-count money already reflected in the gross TOP_UP/
        // SETTLEMENT pair.
        //
        // BILL_COMMISSION_SETTLEMENT_PLAN.md — for a bills-only batch this IS
        // the money-bearing event: `_bookCommissionAtSettlement` (step 5)
        // posts the entered commission straight into the Katsh/iPick provider
        // drawer as a real payment leg on THIS SAME transaction — never a
        // supplier_ledger row (rule 20's "one obligation, one owner": there is
        // no debt for it to net against; Katsh funds it directly). It is
        // profit, entirely (owner, 2026-08-11) — stamped here via the SAME
        // `profit_usd`/`profit_lbp` mechanism every other commission-earning
        // flow in this codebase uses (FinancialServiceRepository's SEND/
        // RECEIVE commission, LotoTicketRepository's ticket commission),
        // never a bespoke field. Exactly 0 for every other batch shape
        // (byte-for-byte unchanged from before this plan).
        // Audit-visibility fix (found while investigating LIRA-137's own e2e
        // fallout, lira-transactions-hidden-types.spec.ts): the commission
        // drawer-top-up leg `_bookBillsCommissionDrawerTopUp` posts (step 5,
        // below) targets the Katsh/iPick drawer — which
        // `TransactionRepository`'s `PROVIDER_STOCK_DRAWERS` set ALSO uses to
        // hide a bill's own creation-time cost leg from the customer-facing
        // "payment legs" subtext (rule 14, the SAME predicate). That hiding
        // rule is correct for a bill's cost leg (a walk-in customer's receipt
        // shouldn't show the shop's internal provider-stock movement) but
        // this settlement transaction has no customer at all — the provider
        // drawer credit IS the entire point of the row, not an internal
        // aside. Reusing the shared predicate therefore also hid the ONE
        // number (the commission amount) that made this row auditable:
        // amount_usd/amount_lbp are contractually 0/0 for this batch shape
        // (no bill principal is owed — see the doc comment above), and the
        // `payments` leg itself is filtered out of `row.payments` by that
        // same predicate, so nothing on the row showed how much arrived —
        // only the IN direction (cashFlow.ts). Fixed at the summary-text
        // level instead of touching the shared predicate (which also guards
        // every sale/recharge/financial-service cost leg — far too broad a
        // lever for a one-row problem): `summary` is never filtered, and
        // TransactionsViewer renders it unconditionally under the cash-flow
        // badge, so the commission is now visible in the DEFAULT table view.
        // Owner follow-up (2026-08-13): the old builder above ALWAYS printed
        // both currencies ("$0.00 + 40,000 LBP") even when one side was
        // genuinely zero, and appended "(drawer top-up)" — a parenthetical
        // that is now misleading for the Other-payment mode, since the
        // payment-detail subtext (driven by the real `payments` leg this
        // method posts below) already says how the money actually arrived.
        // `formatCommissionMoneyForSummary` drops whichever currency is ~0
        // and never appends the mode; `settlementSummary` itself handles the
        // (should-be-unreachable — both booking branches below skip a $0/0
        // commission entirely) both-zero case defensively by omitting the
        // "credited ..." clause rather than rendering a dangling "credited".
        const commissionMoney = this._formatCommissionMoneyForSummary(
          data.commission_usd,
          data.commission_lbp,
        );
        // Owner follow-up (2026-08-15) — "either method picked, should
        // appear in the payment detail in the transaction metadata": for a
        // bills-only batch in the DEFAULT drawer top-up mode
        // (`isBillsOnlyBatch && !isOtherPaymentCommission`), `data.payments`
        // is empty (there is no net-pay tender at all for this batch shape —
        // the reverse-hazard guard above refuses one) so the branch below
        // would fall through to the literal "CASH", which is FALSE: no cash
        // moves for this batch shape. The real leg
        // `_bookBillsCommissionDrawerTopUp` posts below (step 5) uses
        // `method: supplierProvider` (e.g. "Katsh") — read the SAME source
        // here (`supplier?.provider`, rule 14) rather than inventing a
        // second parallel string. Every other shape is untouched: a legacy/
        // OMT batch and an ordinary net-pay settlement both have
        // `isBillsOnlyBatch === false`, and the OTHER_PAYMENT mode's
        // `data.payments` genuinely IS the real collection leg (already
        // correctly derived by the branch below) — this override only ever
        // replaces the otherwise-meaningless "CASH" fallback, never a
        // genuinely-derived value.
        const settlementMethod =
          isBillsOnlyBatch && !isOtherPaymentCommission
            ? (supplier?.provider ?? "CASH")
            : data.payments && data.payments.length > 0
              ? data.payments.length === 1
                ? data.payments[0].method
                : "SPLIT"
              : "CASH";
        const settlementSummary = isBillsOnlyBatch
          ? `Settlement: ${data.financial_service_ids.length} txns — ${this._getSupplierName(data.supplier_id)}${
              commissionMoney ? ` credited ${commissionMoney} commission` : ""
            }`
          : `Settlement: ${data.financial_service_ids.length} txns, net $${data.amount_usd.toFixed(2)}`;
        const txnId = getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.SUPPLIER_SETTLEMENT,
          source_table: "supplier_ledger",
          source_id: ledgerEntryId,
          user_id: data.created_by,
          amount_usd: data.amount_usd,
          amount_lbp: data.amount_lbp,
          // LIRA-158_COMMISSION_REPORTING_PLAN.md §2/§3 Phase 1 (D14, option
          // C) — widened from `isBillsOnlyBatch` to `batchModel === 1` so
          // EVERY new-model settlement (not just a bills-only one) stamps the
          // operator's ENTERED commission onto this SUPPLIER_SETTLEMENT
          // transaction, dated to the settlement day and read by
          // `ProfitRepository.getSupplierCommissionTotals` (D7 — recognition
          // moves to the settlement's own period). This is one half of an
          // interlock with `FinancialServiceRepository.ts`'s profit stamp,
          // which zeroes the commission TERM for the same `commissionModel
          // === 1` rows at creation time — widening this half alone, without
          // that zeroing, would double-count (the FS row's stale estimate
          // stamp AND this settlement stamp both landing in the same total).
          //
          // `batchModel === 1`, not `isBillsOnlyBatch`: a LEGACY (model-0)
          // batch already has its commission embedded in `fs.commission` and
          // stamped at CREATION time (D3 cutover) — stamping it again here
          // would double-count a legacy batch's own commission against
          // itself. `isBillsOnlyBatch` keeps gating everything it gated
          // before this change (`settlementSummary`, `flow`, the metadata
          // block, and — above all — which branch of
          // `_bookCommissionAtSettlement` runs below): that MONEY path
          // (provider-drawer top-up / OTHER_PAYMENT legs vs. the legacy
          // cashless SUPPLIER_PAYS_US ledger credit) is untouched by this
          // change — generalising it past bills-only is LIRA-138, a
          // different ticket (see the doc comment at :1178-1185). LIRA-158 is
          // a reporting fix, not a money fix.
          //
          // This cannot double-count against the SUPPLIER_PAYS_US cashless
          // credit for a non-bills-only new-model batch either:
          // `addLedgerEntry`'s own `createTransaction` call above (see the
          // ORIGINAL cashless-credit path a few lines down) passes no
          // `profit_usd`/`profit_lbp` — they default to 0 — and its
          // transaction `type` is not SUPPLIER_SETTLEMENT, so the two rows
          // never sum into the same bucket.
          //
          // Not fixed here, deliberately: the validator allows a NEGATIVE
          // `commission_usd`/`commission_lbp` (`validators/supplier.ts`'s
          // `commission_usd: z.number()` carries no `.nonnegative()`), and
          // the SUPPLIER_PAYS_US ledger credit below normalises with
          // `-Math.abs(...)` while this stamp uses the raw entered value.
          // Not reachable through the UI today, and using the raw value here
          // keeps ONE convention shared with the bills-only path that already
          // ships — silently "fixing" it would change shipped behaviour.
          profit_usd: batchModel === 1 ? data.commission_usd : 0,
          profit_lbp: batchModel === 1 ? data.commission_lbp : 0,
          summary: settlementSummary,
          metadata_json: {
            supplier_id: data.supplier_id,
            financial_service_ids: data.financial_service_ids,
            // Informational for a LEGACY batch (audit/display only); for a
            // NEW-MODEL batch these are the real money-bearing totals also
            // recorded on supplier_settlements (D5) — see doc comment above
            // and on SettleTransactionsData.commission_usd/commission_lbp.
            commission_usd: data.commission_usd,
            commission_lbp: data.commission_lbp,
            // COMMISSION_AT_SETTLEMENT_PLAN.md D3 — which model this batch
            // settled under (0 = legacy EMBEDDED, 1 = AT_SETTLEMENT); D8 —
            // how commission_usd/commission_lbp were entered for a
            // new-model batch. Purely informational (the authoritative
            // record for a new-model batch is `supplier_settlements`).
            commission_model: batchModel,
            entry_mode: data.entry_mode ?? "LUMP",
            // Owner follow-up (2026-08-13) — HOW a bills-only batch's
            // commission arrived: 'TOP_UP' (provider-drawer credit) or
            // 'OTHER_PAYMENT' (real payment-method legs, see `payments`
            // below and `settlementMethod` above). Stamped only when it has
            // a real meaning (isBillsOnlyBatch) — omitted for every other
            // batch shape rather than a meaningless 'TOP_UP' default.
            ...(isBillsOnlyBatch
              ? {
                  commission_collection_mode:
                    data.commission_collection_mode ?? "TOP_UP",
                }
              : {}),
            // CQ-8 counterparty contract: a settlement pays the supplier's
            // net amount OUT of the drawer — EXCEPT a bills-only batch, where
            // the only money that moves is the commission arriving IN (the
            // provider drawer top-up, step 5). `getCashFlowDirection`
            // (frontend/src/features/audit/cashFlow.ts) reads this field for
            // the transactions-table badge, same pattern as SUPPLIER_PAYMENT.
            counterparty: buildCounterpartyMetadata({
              kind: "supplier",
              id: data.supplier_id,
              name: this._getSupplierName(data.supplier_id),
              flow: isBillsOnlyBatch ? "IN" : "OUT",
              method: settlementMethod,
              ledgerEntryId: ledgerEntryId,
            }),
          },
        });

        // Link ledger entry to unified transaction
        this.db
          .prepare(
            `UPDATE supplier_ledger SET transaction_id = ? WHERE id = ? AND tenant_id = ?`,
          )
          .run(txnId, ledgerEntryId, tenantId);

        // ── 4. Debit the net payment through real payment-method legs ─────
        // (same mechanism recordSupplierCashflow uses) — the ONLY way money
        // moves here. No bare `drawer_name` fallback: the constructor guard
        // above already refused a nonzero amount with no legs, so this loop
        // is the sole payer whenever cash actually changes hands.
        //
        // `!isOtherPaymentCommission` (rule 16 — a shared end-of-transaction
        // loop must consume only the legs it OWNS): when a bills-only batch's
        // operator chose "Other payment", `data.payments` above is NOT a
        // net-pay tender at all — the whole reason the reverse-hazard guard
        // let it through despite `owesCash === false` is that these ARE the
        // commission-collection legs (money arriving IN, credited by step 5's
        // `_bookBillsCommissionViaPaymentLegs` below). Without this guard,
        // THIS loop would ALSO run over the SAME legs and debit them as if
        // paying the supplier — a double-post that nets the drawer back to
        // zero and writes a second, contradictory `payments` row on the same
        // transaction. Every other shape is unaffected: `owesCash` is true
        // exactly when `data.payments` really is the net-pay tender.
        if (
          data.payments &&
          data.payments.length > 0 &&
          !isOtherPaymentCommission
        ) {
          for (const p of data.payments) {
            // LIRA-193 — no `continue`-skip for a non-drawer-affecting
            // method: the reconciliation guard above already rejected any
            // such leg via the SAME `_assertSupplierLegMovesADrawer`
            // predicate (rule 14) before this transaction ever opened, so
            // every leg reaching this loop is guaranteed drawer-affecting.
            // Asserted again here — not a second independent decision, the
            // identical function — purely as defense-in-depth (mirrors
            // `settleAccount`'s own step E) so this loop can never again
            // silently bank a leg the reconciliation counted as paid, even
            // if a future change altered the guard above.
            this._assertSupplierLegMovesADrawer(p.method, "Settlement");
            // Primary Cash Drawer plan §1/§8.2 (decision #10): a CASH leg
            // paid to the shop's primary-system supplier resolves to the
            // PCD; every other supplier/method falls through unchanged.
            const drawerName = resolveServiceCashDrawer(p.method, drawerCtx);
            applyDrawerDelta(this.db, {
              drawerName,
              currencyCode: p.currency_code,
              delta: -Math.abs(p.amount),
              tenantId,
            });
            insertPaymentRow(this.db, {
              transactionId: txnId,
              method: p.method,
              drawerName,
              currencyCode: p.currency_code,
              amount: -Math.abs(p.amount),
              note: data.note ?? "Settlement payment",
              createdBy: data.created_by,
              tenantId,
            });
          }
        }

        // ── 5. NEW-MODEL batches only — book the real commission ──────────
        // (D5/D6 audit/allocation record, plus EITHER the bills-only drawer
        // top-up (BILL_COMMISSION_SETTLEMENT_PLAN.md) OR the legacy
        // SUPPLIER_PAYS_US credit — see the method's own doc comment for the
        // branch). No-op for a legacy batch or an empty eligible set (e.g.
        // every selected id was already settled).
        if (batchModel === 1 && eligibleRows.length > 0) {
          this._bookCommissionAtSettlement({
            settlementLedgerId: ledgerEntryId,
            settlementTxnId: txnId,
            supplierId: data.supplier_id,
            supplierProvider: supplier?.provider ?? null,
            isBillsOnlyBatch,
            rows: eligibleRows,
            data,
            tenantId,
            drawerCtx,
          });
        }

        return { id: ledgerEntryId };
      });

      return settle();
    } catch (e) {
      throw new DatabaseError("Failed to settle transactions", { cause: e });
    }
  }

  /**
   * True when the connected schema is FULLY v150-upgraded: `financial_services
   * .commission_model` AND both `supplier_settlements` and
   * `settlement_commission_allocations` all exist. Migration v150 adds all
   * three atomically (§3) — a real, fully-migrated database always has every
   * one of them together, or none. Checking all three (not just the column)
   * matters because `commission_model` CAN be stamped 1 on a new
   * `financial_services` row by `FinancialServiceRepository.createTransaction`
   * (COMMISSION_AT_SETTLEMENT_PLAN.md §3/Phase 0 — currently only BILL rows;
   * see that stamp's own comment for why OMT/WHISH stay 0 until Phase 2's
   * gross flip ships) — including on the dozens of pre-existing
   * `packages/core` jest fixtures that added the bare column (for that
   * INSERT to succeed) without also adding the two new tables (their own
   * tests never write to them). Treating "column present, tables absent" as
   * legacy — rather than attempting the new booking and throwing
   * `no such table` — mirrors the same schema-drift-guard shape as
   * `_supplierLedgerHasSourceRefColumns`: an incomplete v150 upgrade on any
   * ONE connection means "settle exactly as before this plan", never a
   * half-written commission record.
   */
  private _hasCommissionAtSettlementSchema(): boolean {
    const tableExists = (name: string): boolean =>
      !!this.db
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`,
        )
        .get(name);
    const cols = this.db
      .prepare(`PRAGMA table_info(financial_services)`)
      .all() as { name: string }[];
    return (
      cols.some((c) => c.name === "commission_model") &&
      tableExists("supplier_settlements") &&
      tableExists("settlement_commission_allocations")
    );
  }

  /**
   * COMMISSION_AT_SETTLEMENT_PLAN.md reviewer finding #3 (harden) —
   * `settleTransactions` must never book money against a supplier that
   * doesn't own the rows being settled. A `financial_services` row has NO
   * `supplier_id` FK — system suppliers are keyed by their `provider`
   * string instead (`FinancialServiceRepository.getUnsettledBySupplier
   * (provider)`; the Settlement UI always fetches unsettled rows by
   * `selectedSupplier.provider`) — so "belongs to `supplierId`" means "its
   * own `provider` matches that supplier's `provider`".
   *
   * Selects only `id, provider` — columns `financial_services` has had
   * since before v150 — and looks up the supplier's `provider` with a raw
   * query rather than `findById()`, so this check runs independently of
   * `_hasCommissionAtSettlementSchema()` and on every connected schema, not
   * just a fully-upgraded one. Mirrors the eligibility predicate
   * (`settlement_id IS NULL` + tenant) so it only ever flags rows the write
   * transaction would actually touch.
   *
   * Throws BEFORE any write — same tier as the mixed-model-batch guard in
   * `_resolveSettlementBatchModel` — so the message surfaces unwrapped over
   * IPC instead of being swallowed into "Failed to settle transactions".
   *
   * A supplier with no `provider` (a product supplier) can never own a
   * `financial_services` row (every row's `provider` is a non-null system
   * string), so every id in that case correctly gets rejected as foreign.
   */
  private _verifySupplierOwnership(
    financialServiceIds: number[],
    supplierId: number,
    tenantId: number,
  ): void {
    const supplierRow = this.db
      .prepare(`SELECT provider FROM suppliers WHERE id = ? AND tenant_id = ?`)
      .get(supplierId, tenantId) as { provider: string | null } | undefined;
    const supplierProvider = supplierRow?.provider ?? null;

    const placeholders = financialServiceIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT id, provider FROM financial_services
         WHERE id IN (${placeholders}) AND settlement_id IS NULL AND tenant_id = ?`,
      )
      .all(...financialServiceIds, tenantId) as {
      id: number;
      provider: string;
    }[];

    const foreign = rows.filter((r) => r.provider !== supplierProvider);
    if (foreign.length > 0) {
      throw new DatabaseError(
        `Cannot settle financial_service_ids [${foreign
          .map((r) => r.id)
          .join(", ")}] — they belong to a different supplier than ` +
          `supplier_id ${supplierId} (provider "${supplierProvider ?? "none"}")`,
      );
    }
  }

  /**
   * COMMISSION_AT_SETTLEMENT_PLAN.md D2/D3/D4 — read-only, called BEFORE the
   * write transaction in `settleTransactions` (same pattern as its own
   * `supplier`/`drawerCtx` resolve): finds which of the caller's
   * `financial_service_ids` are still eligible to be settled — id exists,
   * tenant-scoped, `settlement_id IS NULL` — the EXACT predicate the UPDATE
   * inside the write transaction applies, so `rows` here is always exactly
   * the set that UPDATE will actually touch — and reads their shared
   * `commission_model`.
   *
   * Hard-rejects (D4) a batch whose eligible rows don't share ONE model —
   * entering a single commission figure across rows whose payable was
   * computed two different ways (embedded vs at-settlement) would
   * double-net the legacy rows' already-embedded cut.
   *
   * Returns `{ model: 0, rows: [] }` (the legacy no-op shape) when: the
   * connected schema isn't fully v150-upgraded
   * (`_hasCommissionAtSettlementSchema`), or no id in the caller's list is
   * currently eligible (nothing new to book either way — mirrors the
   * existing "does NOT re-settle already-settled rows" no-op).
   */
  private _resolveSettlementBatchModel(
    financialServiceIds: number[],
    tenantId: number,
  ): { model: 0 | 1; rows: EligibleSettlementRow[] } {
    if (!this._hasCommissionAtSettlementSchema()) {
      return { model: 0, rows: [] };
    }
    const placeholders = financialServiceIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT id, provider, service_type, commission, commission_model, currency
         FROM financial_services
         WHERE id IN (${placeholders}) AND settlement_id IS NULL AND tenant_id = ?`,
      )
      .all(...financialServiceIds, tenantId) as EligibleSettlementRow[];

    if (rows.length === 0) return { model: 0, rows: [] };

    const distinctModels = new Set(rows.map((r) => r.commission_model));
    if (distinctModels.size > 1) {
      throw new DatabaseError(
        "Cannot settle mixed commission-model transactions in one batch",
      );
    }
    const model: 0 | 1 = rows[0].commission_model === 1 ? 1 : 0;
    return { model, rows: model === 1 ? rows : [] };
  }

  /**
   * COMMISSION_AT_SETTLEMENT_PLAN.md D5/D6 — called ONLY for a
   * `commission_model` = 1 (AT_SETTLEMENT) batch, from inside
   * `settleTransactions`' own `db.transaction()` (step 5). Books the real
   * commission this settlement represents:
   *
   * 1. `supplier_settlements` (D5) — one row per settlement batch: the
   *    entered commission total, its per-currency gross (each eligible
   *    row's own `supplier_owed` — FinancialServiceRepository's
   *    `SUPPLIER_OWED_EXPR`, read via `findById` so this NEVER re-derives
   *    that expression, rule 14), the entry mode/rate/unit-count snapshot
   *    (D8), and the model — uniquely linked to THIS settlement's own
   *    `supplier_ledger` row via `ledger_entry_id` (never by time
   *    proximity — the LIRA-085 lesson).
   * 2. `settlement_commission_allocations` (D6) — one row per eligible
   *    `financial_services` row, per-currency share of the entered
   *    commission via largest-remainder proportional allocation
   *    (`utils/largestRemainder.ts`) so Σ = the entered commission exactly,
   *    per currency. Weighted by each row's own `supplier_owed` magnitude,
   *    bucketed by that row's OWN currency; falls back to an EQUAL split
   *    across every eligible row when a currency's total weight is 0 — the
   *    plan's "bills settlement note": a bill's principal reaches the
   *    supplier via the provider-drawer cost leg, never the ledger, so
   *    every bill row's gross weight is 0 and an equal per-bill split is
   *    the only sane default.
   * 3. The commission credit itself — the money-bearing step, which BRANCHES
   *    on `isBillsOnlyBatch` (BILL_COMMISSION_SETTLEMENT_PLAN.md, owner
   *    decision 2026-08-11):
   *
   *    - **Bills-only batch** (every eligible row is a BILL — today this is
   *      exactly Katsh; iPick is `commission_eligible = 0` so it never earns
   *      a nonzero commission here): the entered commission is a REAL
   *      top-up into the Katsh/iPick provider drawer, funded BY the
   *      provider — "Katsh owes us X, they pay it to us via top-up to our
   *      Katsh account" (owner, verbatim). Posted as a `payments` leg on
   *      THIS settlement's own transaction (`_bookBillsCommissionDrawerTopUp`)
   *      — no `supplier_ledger` row at all for this money (rule 20 "one
   *      obligation, one owner": there is no debt for it to net against).
   *      Reversal is FREE via the generic `_reversePayments` step every
   *      other transaction already gets (rule 20) — no bespoke code needed.
   *    - **Every other new-model batch** — since commit 43948a35 (LIRA-095)
   *      widened `commission_model = 1` past BILL-only to also cover
   *      OMT/WHISH SEND/RECEIVE, this is NO LONGER a forward-compat stub:
   *      it is the NORMAL branch for every cashless (OMT/WHISH, or mixed
   *      bills+OMT) settlement. Unchanged from before this plan — a
   *      cashless `SUPPLIER_PAYS_US` `supplier_ledger` credit row
   *      (negative = the supplier owes the shop), `is_auto`, linked to THIS
   *      settlement's own ledger row via `source_ref_table`/`source_ref_id`
   *      — the EXACT shape `TransactionRepository`'s existing LIRA-091
   *      sibling-void cascade already scans for (`_cascadeSupplierSiblingVoid`,
   *      keyed off the SUPPLIER_SETTLEMENT transaction's own
   *      `source_table`/`source_id`, which IS this ledger row) — so voiding/
   *      refunding the settlement finds and soft-voids this row for free.
   *      This row is also the anchor LIRA-158 owner decision D17
   *      (docs/plans/done_plans/LIRA-158_COMMISSION_REPORTING_PLAN.md §8)
   *      builds on: because no drawer is topped up here, the commission it
   *      credits is not yet real money, so downstream reporting DEFERS its
   *      recognition until this row's own client debt is covered — do not
   *      read this branch as unreachable and do not delete it as dead code.
   *
   *    Both branches skip entirely when the entered commission is $0/0 LBP
   *    (nothing to credit).
   *
   *    Owner follow-up (2026-08-13) — the bills-only branch itself now has
   *    TWO shapes, selected by `data.commission_collection_mode`:
   *    `_bookBillsCommissionDrawerTopUp` (mode `'TOP_UP'`, default, unchanged
   *    from the above) or `_bookBillsCommissionViaPaymentLegs` (mode
   *    `'OTHER_PAYMENT'` — credits whatever drawer(s) the operator's chosen
   *    payment method(s) map to instead of the provider's own drawer). Both
   *    are equally "one obligation, one owner": neither ever touches
   *    `supplier_ledger` for this money.
   */
  private _bookCommissionAtSettlement(args: {
    settlementLedgerId: number;
    settlementTxnId: number;
    supplierId: number;
    supplierProvider: string | null;
    isBillsOnlyBatch: boolean;
    rows: EligibleSettlementRow[];
    data: SettleTransactionsData;
    tenantId: number;
    drawerCtx: ServiceCashDrawerContext;
  }): void {
    const {
      settlementLedgerId,
      settlementTxnId,
      supplierId,
      supplierProvider,
      isBillsOnlyBatch,
      rows,
      data,
      tenantId,
      drawerCtx,
    } = args;

    // Gross (supplier_owed) per row, reused verbatim via findById() —
    // getColumns() already embeds SUPPLIER_OWED_EXPR, so this never
    // re-derives that CASE expression a second time (rule 14).
    const grossByRow = new Map<number, { gross: number; currency: string }>();
    let grossUsd = 0;
    let grossLbp = 0;
    for (const row of rows) {
      const fs = getFinancialServiceRepository().findById(row.id);
      const gross = fs?.supplier_owed ?? 0;
      const currency = row.currency === "LBP" ? "LBP" : "USD";
      grossByRow.set(row.id, { gross, currency });
      if (currency === "LBP") grossLbp += gross;
      else grossUsd += gross;
    }

    // Reviewer finding #2 (PLAUSIBLE, fixed defensively) — each currency
    // bucket's weight array must be built from ONLY the rows actually
    // denominated in that currency, not from every eligible row mapped to a
    // 0 weight when foreign. `allocateProportional`'s equal-weight fallback
    // triggers whenever ITS OWN weight array sums to 0 and then spreads the
    // total EQUALLY ACROSS EVERY ROW IN THAT ARRAY — so passing the full
    // `rows` list (with foreign-currency rows pinned to weight 0) meant a
    // batch mixing e.g. USD OMT rows with $0-gross LBP BILL rows spread the
    // LBP commission across the USD rows too the moment the LBP bucket's
    // real weights were all zero. Filtering to same-currency rows FIRST
    // means the equal-weight fallback (still needed for the bills
    // settlement note) only ever spreads across that currency's own rows;
    // `usdShareById`/`lbpShareById` default to 0 via `?? 0` below for any
    // row absent from its own currency's map (rows of the OTHER currency),
    // so no behavior changes for a single-currency batch.
    const usdRows = rows.filter(
      (r) => grossByRow.get(r.id)!.currency === "USD",
    );
    const lbpRows = rows.filter(
      (r) => grossByRow.get(r.id)!.currency === "LBP",
    );
    const usdWeights = usdRows.map((r) => ({
      id: r.id,
      weight: Math.abs(grossByRow.get(r.id)!.gross),
    }));
    const lbpWeights = lbpRows.map((r) => ({
      id: r.id,
      weight: Math.abs(grossByRow.get(r.id)!.gross),
    }));
    const usdShareById = new Map(
      allocateProportional(usdWeights, data.commission_usd, 0.01).map((s) => [
        s.id,
        s.amount,
      ]),
    );
    const lbpShareById = new Map(
      allocateProportional(lbpWeights, data.commission_lbp, 1).map((s) => [
        s.id,
        s.amount,
      ]),
    );

    // D5 — the real commission storage for this settlement batch.
    this.db
      .prepare(
        `INSERT INTO supplier_settlements
           (tenant_id, supplier_id, ledger_entry_id, gross_usd, gross_lbp,
            commission_usd, commission_lbp, entry_mode, rate, unit_count,
            model, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now'), datetime('now'))`,
      )
      .run(
        tenantId,
        supplierId,
        settlementLedgerId,
        grossUsd,
        grossLbp,
        data.commission_usd,
        data.commission_lbp,
        data.entry_mode ?? "LUMP",
        data.commission_rate ?? null,
        data.commission_unit_count ?? null,
        data.created_by,
      );

    // D6 — one allocation row per settled fs row, per-currency share.
    const insertAllocation = this.db.prepare(
      `INSERT INTO settlement_commission_allocations
         (tenant_id, settlement_ledger_id, financial_service_id, service_type,
          provider, commission_usd, commission_lbp, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    );
    for (const row of rows) {
      insertAllocation.run(
        tenantId,
        settlementLedgerId,
        row.id,
        row.service_type,
        row.provider,
        usdShareById.get(row.id) ?? 0,
        lbpShareById.get(row.id) ?? 0,
      );
    }

    // The commission credit itself — see the method's own doc comment for
    // the branch.
    if (isBillsOnlyBatch) {
      if (data.commission_collection_mode === "OTHER_PAYMENT") {
        this._bookBillsCommissionViaPaymentLegs({
          settlementTxnId,
          payments: data.payments ?? [],
          createdBy: data.created_by,
          settlementLedgerId,
          tenantId,
          drawerCtx,
        });
      } else {
        this._bookBillsCommissionDrawerTopUp({
          settlementTxnId,
          supplierProvider,
          commissionUsd: data.commission_usd,
          commissionLbp: data.commission_lbp,
          createdBy: data.created_by,
          settlementLedgerId,
          tenantId,
        });
      }
      return;
    }

    // ORIGINAL cashless-credit path — unchanged. Skipped for a $0/0-LBP
    // entered commission (nothing to credit); addLedgerEntry creates its own
    // separate hidden transaction (no drawer_name/transaction_id) and, via
    // source_ref_table/source_ref_id, is found for free by
    // TransactionRepository's existing LIRA-091 sibling-void cascade on this
    // settlement's own void/refund.
    if (
      Math.abs(data.commission_usd) > 0.005 ||
      Math.abs(data.commission_lbp) > 0.005
    ) {
      this.addLedgerEntry({
        supplier_id: supplierId,
        entry_type: "SUPPLIER_PAYS_US",
        amount_usd: -Math.abs(data.commission_usd),
        amount_lbp: -Math.abs(data.commission_lbp),
        note: `Auto: commission credit from settlement #${settlementLedgerId}`,
        created_by: data.created_by,
        is_auto: true,
        source_ref_table: "supplier_ledger",
        source_ref_id: settlementLedgerId,
      });
    }
  }

  /**
   * BILL_COMMISSION_SETTLEMENT_PLAN.md (LIRA-137) — Katsh/iPick bills-only
   * commission at settlement is a REAL top-up into the provider's OWN
   * drawer, funded BY the provider ("Katsh owes you 100,000 LBP... they pay
   * it to us via top-up to our Katsh account", owner 2026-08-11) — not a
   * `supplier_ledger` receivable.
   *
   * Deliberately does NOT reuse `RechargeRepository.topUpFromSupplier`'s
   * debt-booking half: that method books a `TOP_UP` `supplier_ledger` row
   * because the SHOP is extending its own credit line (the shop now owes the
   * supplier for the stock it just received). Here it is the OPPOSITE
   * direction — KATSH funds this top-up as a reward/commission — so the shop
   * owes nothing back for it; posting a `TOP_UP` row here would fabricate a
   * debt that was never incurred. This method therefore calls ONLY the
   * drawer-credit half (`applyDrawerDelta` + a `payments` leg on the
   * settlement's own transaction), never `addLedgerEntry`/`supplier_ledger`
   * at all — the two methods are kept apart by construction, not by a
   * runtime flag: this method has no code path that can reach
   * `supplier_ledger`.
   *
   * The leg posts on `settlementTxnId` (the SAME transaction step 3 of
   * `settleTransactions` already created) rather than a separate hidden
   * transaction — so reversal is FREE via the generic `_reversePayments`
   * step every void/refund already runs (rule 20): it mirrors every
   * `payments` row for the original transaction with the negated amount,
   * sign-agnostic, no bespoke code needed here. The transaction's own
   * `profit_usd`/`profit_lbp` (stamped by the caller, `settleTransactions`
   * step 3) net to 0 the same generic way every other transaction's profit
   * does on void (status flips to VOIDED, excluded from every ACTIVE-only
   * profit sum) or refund (the REFUND row carries `-profit_usd`/`-profit_lbp`).
   *
   * `method`/`drawerName` mirror the EXACT convention
   * `FinancialServiceRepository`'s cost/price-flow cost leg already uses for
   * a provider-drawer movement (`insertPayment.run(txnId, data.provider,
   * providerDrawer, ...)`) — the provider name IS the method, which is also
   * why `PROVIDER_STOCK_DRAWERS` (`TransactionRepository.ts`) already
   * excludes a Katsh-drawer leg from the customer-facing in/out legs
   * subtext, exactly like that cost leg.
   *
   * Skips entirely when both currencies are ~0 (nothing to credit — mirrors
   * the old SUPPLIER_PAYS_US guard it replaces for this batch shape).
   */
  private _bookBillsCommissionDrawerTopUp(args: {
    settlementTxnId: number;
    supplierProvider: string | null;
    commissionUsd: number;
    commissionLbp: number;
    createdBy: number;
    settlementLedgerId: number;
    tenantId: number;
  }): void {
    const {
      settlementTxnId,
      supplierProvider,
      commissionUsd,
      commissionLbp,
      createdBy,
      settlementLedgerId,
      tenantId,
    } = args;
    if (Math.abs(commissionUsd) <= 0.005 && Math.abs(commissionLbp) <= 0.005) {
      return;
    }
    // Defensive — every BILL row's provider is Katsh or iPick today (the
    // only two BILL-capable providers), both real top-up providers. Refuses
    // rather than silently dropping real money into nowhere if that
    // invariant is ever violated.
    if (!supplierProvider || !isTopUpProvider(supplierProvider)) {
      throw new DatabaseError(
        `Cannot book bills commission drawer top-up — provider "${supplierProvider ?? "null"}" has no configured top-up drawer`,
      );
    }
    const destDrawer = TOP_UP_PROVIDER_DRAWERS[supplierProvider];

    const post = (amount: number, currencyCode: "USD" | "LBP") => {
      if (Math.abs(amount) <= 0.005) return;
      applyDrawerDelta(this.db, {
        drawerName: destDrawer,
        currencyCode,
        delta: amount,
        tenantId,
      });
      insertPaymentRow(this.db, {
        transactionId: settlementTxnId,
        method: supplierProvider,
        drawerName: destDrawer,
        currencyCode,
        amount,
        note: `Commission from settlement #${settlementLedgerId}: +${amount} ${currencyCode} → ${destDrawer}`,
        createdBy,
        tenantId,
      });
    };
    post(commissionUsd, "USD");
    post(commissionLbp, "LBP");
  }

  /**
   * Owner follow-up (2026-08-13) — the "Other payment" sibling of
   * `_bookBillsCommissionDrawerTopUp` above. Same money fact (a bills-only
   * batch's commission is profit, entirely, credited IN), different
   * destination: instead of topping up the Katsh/iPick provider's OWN
   * drawer, the commission arrives via the SAME real payment-method legs
   * the operator picked in the modal (`MultiPaymentInput`, autofilled with
   * the entered commission) — genuine CASH into the till (General or the
   * PCD, via `resolveServiceCashDrawer`, same resolution step 4 above uses),
   * or a wallet method into its own drawer.
   *
   * `settleTransactions`'s reverse-hazard guard already verified `payments`
   * sums to `commission_usd`/`commission_lbp` (per currency, within
   * tolerance) before this method ever runs, and skipped step 4's net-pay
   * debit loop for these SAME legs (`!isOtherPaymentCommission`) — so this
   * is the ONLY place they post. Money lands exactly where the legs say:
   * this posts the legs' OWN amounts, not a re-derived `commission_usd`/
   * `commission_lbp` figure, so a legitimate cross-method split (e.g. two
   * CASH legs of different currencies) credits precisely what was entered
   * per leg.
   *
   * Deliberately does NOT reuse `postPayoutLegs` (`moneyPosting.ts`): that
   * helper posts NEGATIVE (payout) legs and reconciles against an
   * `ExpectedTotals`/`exchangeRate` this payload doesn't carry (the
   * commission is entered in a SINGLE currency, never split across both by
   * this UI) — reconciliation already happened, currency-by-currency, in
   * `settleTransactions` itself. This method's own job is narrower: post
   * each already-validated leg as a CREDIT (the mirror image of step 4's
   * debit), same `applyDrawerDelta`/`insertPaymentRow` primitives.
   *
   * Reversal is FREE via the generic `_reversePayments` step every
   * void/refund already runs (rule 20) — identical reasoning to
   * `_bookBillsCommissionDrawerTopUp`'s own doc comment: these legs live on
   * `settlementTxnId`, sign-agnostic, no bespoke reversal code needed.
   *
   * A non-drawer-affecting leg (CUSTOMER_ACCOUNT/GIFT_CARD — neither is ever
   * offered by this sheet's `paymentMethods`, but this is the single source
   * of truth for every caller) throws rather than silently dropping it,
   * mirroring `postPayoutLegs`'s own "no phantom leg" guard: a leg the
   * reverse-hazard sum-check already counted toward the entered commission
   * MUST actually land in a drawer, or the drawer would under-credit
   * relative to the profit/allocation records this same settlement stamps.
   */
  private _bookBillsCommissionViaPaymentLegs(args: {
    settlementTxnId: number;
    payments: Array<{ method: string; currency_code: string; amount: number }>;
    createdBy: number;
    settlementLedgerId: number;
    tenantId: number;
    drawerCtx: ServiceCashDrawerContext;
  }): void {
    const {
      settlementTxnId,
      payments,
      createdBy,
      settlementLedgerId,
      tenantId,
      drawerCtx,
    } = args;
    for (const p of payments) {
      const amount = Math.abs(p.amount);
      if (amount <= 0.005) continue;
      if (!isDrawerAffectingMethod(p.method)) {
        throw new DatabaseError(
          `Other-payment commission leg: "${p.method}" is not a valid drawer-affecting payment method`,
        );
      }
      // LIRA-193 follow-up — defense-in-depth, not a second independent
      // decision (identical helper the reconciliation sum above already
      // called): guarantees this loop can never post a leg to a phantom
      // ("<drawer>", "usd"/"EUR"/...) row even if a future change altered
      // the sum-side guard.
      this._assertSupplierLegCurrencyIsValid(
        p.currency_code,
        "Other-payment commission leg",
      );
      const drawerName = resolveServiceCashDrawer(p.method, drawerCtx);
      applyDrawerDelta(this.db, {
        drawerName,
        currencyCode: p.currency_code,
        delta: amount,
        tenantId,
      });
      insertPaymentRow(this.db, {
        transactionId: settlementTxnId,
        method: p.method,
        drawerName,
        currencyCode: p.currency_code,
        amount,
        note: `Commission from settlement #${settlementLedgerId} via ${p.method}: +${amount} ${p.currency_code} → ${drawerName}`,
        createdBy,
        tenantId,
      });
    }
  }

  /**
   * Owner follow-up (2026-08-13) — the ONE place the settlement summary's
   * commission-money fragment is composed (rule 14): drops whichever
   * currency is ~0 instead of always printing both ("$0.00 + 40,000 LBP"),
   * and never appends a collection-mode parenthetical — the payment-detail
   * subtext (driven by the real `payments` leg the booking step posts) now
   * carries that. Returns "" when BOTH are ~0 (should be unreachable — both
   * booking branches skip a $0/0 commission entirely) so the caller can omit
   * the whole "credited ..." clause rather than render a dangling "credited"
   * with nothing after it.
   */
  private _formatCommissionMoneyForSummary(
    commissionUsd: number,
    commissionLbp: number,
  ): string {
    const parts: string[] = [];
    if (Math.abs(commissionUsd) > 0.005)
      parts.push(`$${commissionUsd.toFixed(2)}`);
    if (Math.abs(commissionLbp) > 0.005) {
      parts.push(`${Math.round(commissionLbp).toLocaleString()} LBP`);
    }
    return parts.join(" + ");
  }

  /**
   * Rule 14 — extracted out of `settleTransactions`' own step 2 (byte-
   * identical SQL/params) so `settleAccount` (LIRA-189) can call the SAME
   * marking logic once per account member instead of pasting the UPDATE a
   * second time. No-ops on an empty id list (a member may have LEDGER
   * selections only). Guard on `settlement_id IS NULL` (not `is_settled =
   * 0`) — see the original call site's comment: cost/price-flow SALE_COST
   * rows are already `is_settled = 1` at creation yet still carry
   * outstanding supplier debt until `settlement_id` is stamped here; both
   * shapes share `settlement_id IS NULL` as the "supplier debt
   * outstanding" marker.
   *
   * Finding B (third hardening round) — the WHERE clause now also requires
   * `ledgerNotRefunded()` (reused generically: same "is_refunded is falsy"
   * predicate `getAccountUnsettled`'s LEDGER branch already applies to
   * `supplier_ledger`, kept as one shared fragment per rule 14 rather than a
   * second hand-typed `COALESCE(is_refunded, 0) = 0` literal) — a row voided
   * between `settleAccount`'s step-0 read and this write must never be
   * silently stamped settled just because `settlement_id` still reads NULL.
   * Returns the actual `.run().changes` count (was `void`) so a caller that
   * computed a member's balance assuming ALL of `financialServiceIds` would
   * be stamped can detect a partial/zero write and abort instead of treating
   * silence as success — `settleTransactions` (this method's other caller)
   * ignores the return value, unchanged behavior there.
   */
  private _markFinancialServicesSettled(
    financialServiceIds: number[],
    settlementLedgerId: number,
    tenantId: number,
  ): number {
    if (!financialServiceIds.length) return 0;
    const placeholders = financialServiceIds.map(() => "?").join(",");
    const result = this.db
      .prepare(
        `UPDATE financial_services
         SET is_settled = 1,
             settled_at = datetime('now'),
             settlement_id = ?
         WHERE id IN (${placeholders})
           AND settlement_id IS NULL
           AND ${ledgerNotRefunded()}
           AND tenant_id = ?`,
      )
      .run(settlementLedgerId, ...financialServiceIds, tenantId);
    return result.changes;
  }

  /**
   * OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-189, plan §9.3/§1.1) — the
   * `supplier_ledger.settlement_id` sibling of
   * `_markFinancialServicesSettled` above, for raw LEDGER selections (iPick/
   * OMT App supplier-credit debt, or a WALLET_CASHOUT credit row) that have
   * no `financial_services` row at all. Migration v176 added the column;
   * this is its first writer (CONTRACT_W2.md §1.1) — gated on the same
   * schema-drift guard `getAccountUnsettled`/`getAccountLedger` already use
   * so a connection/fixture that predates v176 degrades to a no-op instead
   * of throwing `no such column`.
   *
   * Finding B (third hardening round) — same `ledgerNotRefunded()` addition
   * and `void` → `number` (`.run().changes`) return as
   * `_markFinancialServicesSettled` above, so `settleAccount` can assert it
   * actually stamped every row it expected to. The pre-existing schema-drift
   * no-op (`!this._supplierLedgerHasSettlementIdColumn()`) returns
   * `ledgerIds.length` rather than 0 — it is NOT a race, it's an expected
   * degrade on a pre-v176 connection, and `getAccountUnsettled`'s LEDGER
   * branch is gated on the SAME column check, so a caller can only ever
   * select a LEDGER-kind row when the column exists — `ledgerIds` is always
   * empty here on the branch this comment describes. Returning its own
   * length keeps that a legitimate match for the caller's assertion instead
   * of a false "row went missing" alarm.
   */
  private _markLedgerRowsSettled(
    ledgerIds: number[],
    settlementLedgerId: number,
    tenantId: number,
  ): number {
    if (!ledgerIds.length) return 0;
    if (!this._supplierLedgerHasSettlementIdColumn()) return ledgerIds.length;
    const placeholders = ledgerIds.map(() => "?").join(",");
    const result = this.db
      .prepare(
        `UPDATE supplier_ledger
         SET settlement_id = ?
         WHERE id IN (${placeholders})
           AND settlement_id IS NULL
           AND ${ledgerNotRefunded()}
           AND tenant_id = ?`,
      )
      .run(settlementLedgerId, ...ledgerIds, tenantId);
    return result.changes;
  }

  /**
   * Finding B (third hardening round, rule 17) — live re-check of every
   * selected row's eligibility, called from INSIDE `settleAccount`'s write
   * transaction, immediately before any row is written there. Step 0's own
   * validation (`getAccountUnsettled`) runs BEFORE that transaction opens; a
   * row voided/refunded in the window between that read and this write would
   * previously still be counted in its member's negation (computed from the
   * now-stale `selectedRows`) and stamped settled — `_markFinancialServicesSettled`/
   * `_markLedgerRowsSettled` used to guard only on `settlement_id IS NULL`,
   * never `is_refunded`, and never inspected `.run().changes` — leaving that
   * member's balance permanently wrong with no open row left to explain it.
   *
   * Re-runs the SAME "is this row still open" predicate live, right here,
   * against every selected id and aborts the WHOLE transaction (nothing
   * committed — this throw propagates straight out of `this.db.transaction()`)
   * on any mismatch, rather than letting a stale member's write silently
   * proceed. Deliberately redundant with the `ledgerNotRefunded()` guard now
   * on both marking helpers (and their own affected-row assertion in
   * `settleAccount` step D below) — two independent checks of the same fact,
   * so neither one regressing alone reopens this hole.
   *
   * Finding 1 (fourth hardening round) — this used to re-verify ONLY "open,
   * unsettled, not refunded", never the actual MEMBERSHIP predicate
   * (`accountMemberOf`) `getAccountUnsettled` used, at step 0, to decide each
   * row belongs to THIS account in the first place. A row's owning supplier
   * (`memberSupplierIds`, one entry per distinct `byMember` key) could be
   * re-parented — its `account_supplier_id` pointed at a different account,
   * or cleared entirely — in the exact same race window Finding B closes for
   * "is this row open", and the row would still sail through this check
   * (nothing about is_settled/is_refunded changed) while actually belonging
   * to a different account than the one this batch is settling. Re-runs
   * `accountMemberOf` (rule 14 — the SAME predicate `_getAccountMembers`/
   * `getAccountLedger`/`getAccountUnsettled` all share, never re-typed) live
   * against every member supplier id this batch touches, and aborts the
   * whole transaction on any mismatch, same as the row-eligibility checks
   * above.
   */
  private _assertSelectionsStillEligible(
    financialServiceIds: number[],
    ledgerIds: number[],
    memberSupplierIds: number[],
    accountSupplierId: number,
    tenantId: number,
  ): void {
    if (financialServiceIds.length) {
      const placeholders = financialServiceIds.map(() => "?").join(",");
      const stillOpen = this.db
        .prepare(
          `SELECT id FROM financial_services
           WHERE id IN (${placeholders})
             AND tenant_id = ?
             AND is_settled = 0
             AND settlement_id IS NULL
             AND ${ledgerNotRefunded()}`,
        )
        .all(...financialServiceIds, tenantId) as { id: number }[];
      if (stillOpen.length !== financialServiceIds.length) {
        const openIds = new Set(stillOpen.map((r) => r.id));
        const stale = financialServiceIds.filter((id) => !openIds.has(id));
        throw new DatabaseError(
          `Account settlement aborted: financial_service row(s) [${stale.join(", ")}] ` +
            `were settled, refunded, or voided after this batch was validated — ` +
            `re-open the settle sheet and try again`,
        );
      }
    }
    if (ledgerIds.length) {
      const placeholders = ledgerIds.map(() => "?").join(",");
      const stillOpen = this.db
        .prepare(
          `SELECT id FROM supplier_ledger
           WHERE id IN (${placeholders})
             AND tenant_id = ?
             AND settlement_id IS NULL
             AND ${ledgerNotRefunded()}`,
        )
        .all(...ledgerIds, tenantId) as { id: number }[];
      if (stillOpen.length !== ledgerIds.length) {
        const openIds = new Set(stillOpen.map((r) => r.id));
        const stale = ledgerIds.filter((id) => !openIds.has(id));
        throw new DatabaseError(
          `Account settlement aborted: supplier_ledger row(s) [${stale.join(", ")}] ` +
            `were settled, refunded, or voided after this batch was validated — ` +
            `re-open the settle sheet and try again`,
        );
      }
    }
    // Finding 1 — membership re-check, live, against the SAME predicate step
    // 0 used to admit each selected row's owning supplier onto this account.
    if (memberSupplierIds.length) {
      const placeholders = memberSupplierIds.map(() => "?").join(",");
      const stillMembers = this.db
        .prepare(
          `SELECT id FROM suppliers
           WHERE id IN (${placeholders})
             AND tenant_id = ?
             AND ${accountMemberOf("")}`,
        )
        .all(
          ...memberSupplierIds,
          tenantId,
          accountSupplierId,
          accountSupplierId,
        ) as { id: number }[];
      if (stillMembers.length !== memberSupplierIds.length) {
        const stillIds = new Set(stillMembers.map((r) => r.id));
        const stale = memberSupplierIds.filter((id) => !stillIds.has(id));
        throw new DatabaseError(
          `Account settlement aborted: supplier(s) [${stale.join(", ")}] are no ` +
            `longer members of account ${accountSupplierId} — re-parented, ` +
            `deleted, or the account changed after this batch was validated — ` +
            `re-open the settle sheet and try again`,
        );
      }
    }
  }

  /**
   * OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-189, D14/§8.3a) — the ONE place
   * that reads back the commission `RechargeRepository.cashoutToSupplier`
   * stamped into `transactions.metadata_json.commission` (there is no
   * dedicated column — plan §10.2), per LEDGER row. Rule 14: shared by BOTH
   * `_sumCashoutCommission` (settlement's real profit stamp) and
   * `getAccountUnsettled` (the settle sheet's PREVIEW of that same figure,
   * before this fix always 0 — the UX bug this helper closes) so the two can
   * never disagree — one predicate, read twice. The figure is COMPUTED at
   * cashout time and must never be re-derived from the rate constant here
   * (that would silently diverge the moment the rate constant changes for
   * future cashouts while old rows keep their stamped value).
   *
   * A ledger row reaches a cashout via `source_ref_table: "recharges"` /
   * `source_ref_id: <recharges id>` (`RechargeRepository.cashoutToSupplier`
   * step 6) — `getBySourceId` then finds that recharge's OWN unified
   * transaction (`source_table: "recharges"`), filtered `status = 'ACTIVE'`
   * so an already-voided cashout (which could not have stayed in the
   * unsettled queue anyway — its ledger row would be `is_refunded = 1`) can
   * never double-count. Anything else (a plain TOP_UP/PAYMENT row, a
   * missing/malformed metadata blob) is simply ABSENT from the returned map
   * (both callers treat a missing entry as 0) rather than throwing — a
   * settlement/preview must never fail because ONE row's audit metadata is
   * unreadable; the money itself (the ledger row being settled) is
   * unaffected either way. Ids with nothing to report are omitted, not
   * zero-filled, so callers can cheaply tell "no cashout" apart from "cashout
   * with a stamped $0 commission" if they ever need to.
   */
  private _cashoutCommissionByLedgerId(
    ledgerIds: number[],
    tenantId: number,
  ): Map<number, { usd: number; lbp: number }> {
    const byId = new Map<number, { usd: number; lbp: number }>();
    if (!ledgerIds.length || !this._supplierLedgerHasSourceRefColumns()) {
      return byId;
    }
    const placeholders = ledgerIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT id, source_ref_table, source_ref_id
         FROM supplier_ledger
         WHERE id IN (${placeholders}) AND tenant_id = ?`,
      )
      .all(...ledgerIds, tenantId) as {
      id: number;
      source_ref_table: string | null;
      source_ref_id: number | null;
    }[];

    const txnRepo = getTransactionRepository();
    for (const row of rows) {
      if (row.source_ref_table !== "recharges" || row.source_ref_id == null) {
        continue;
      }
      const txn = txnRepo.getBySourceId("recharges", row.source_ref_id);
      if (!txn || txn.type !== TRANSACTION_TYPES.WALLET_CASHOUT) continue;
      let meta: Record<string, unknown> = {};
      try {
        meta = txn.metadata_json
          ? (JSON.parse(txn.metadata_json) as Record<string, unknown>)
          : {};
      } catch {
        continue;
      }
      const commission =
        typeof meta.commission === "number" ? meta.commission : 0;
      byId.set(row.id, {
        usd: meta.currency === "LBP" ? 0 : commission,
        lbp: meta.currency === "LBP" ? commission : 0,
      });
    }
    return byId;
  }

  /**
   * Sums {@link _cashoutCommissionByLedgerId} across every selected LEDGER
   * row, per currency — `settleAccount`'s own read-only step 5. See that
   * helper's doc comment for the shared predicate both it and
   * `getAccountUnsettled`'s preview rely on.
   */
  private _sumCashoutCommission(
    ledgerIds: number[],
    tenantId: number,
  ): { usd: number; lbp: number } {
    const byId = this._cashoutCommissionByLedgerId(ledgerIds, tenantId);
    let usd = 0;
    let lbp = 0;
    for (const v of byId.values()) {
      usd += v.usd;
      lbp += v.lbp;
    }
    return { usd, lbp };
  }

  /**
   * OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-189, CONTRACT_W2.md §1/§2.1) —
   * settle the WHOLE OMT open-credit account (the parent + every account
   * child) in ONE `SUPPLIER_SETTLEMENT` transaction, one `supplier_ledger`
   * row PER MEMBER TOUCHED (§4's worked example — never one lump row on the
   * parent, which would leave one member overpaid and another unpaid).
   *
   * Algorithm:
   *
   * 0. Re-validate EVERY `data.selections` entry against
   *    `getAccountUnsettled(data.account_supplier_id)` — the SAME
   *    membership + open/not-refunded predicate the settlement queue itself
   *    uses (rule 14) — rather than trusting the caller's ids. A selection
   *    that doesn't resolve (foreign, already settled, refunded, duplicate)
   *    throws before any write.
   * 1. Group the validated rows by the member supplier that actually OWNS
   *    each one (`row.supplier_id` — a child's rows stay on the child, the
   *    parent's stay on the parent; ledger rows never move, plan §2) and
   *    sum each member's own subtotal, per currency. The ACCOUNT net is the
   *    sum of every member's subtotal.
   * 2. Cross-check `data.direction`/`data.amount_usd`/`data.amount_lbp`
   *    against that server-recomputed net (never trust the client with a
   *    money-moving direction) — §8.4: a cashout-heavy batch can flip the
   *    net negative, which is exactly when COLLECT applies.
   * 3. EVERY member with a nonzero subtotal gets its OWN new
   *    `supplier_ledger` row valued at the EXACT NEGATION of its own
   *    subtotal — so that member's balance always nets to precisely 0,
   *    independent of which way the ACCOUNT's overall net moves (a member
   *    can go the "wrong way" relative to the account's chosen direction,
   *    e.g. a cashout-only child inside an overall PAY batch, and still
   *    nets correctly: negating a negative subtotal yields a positive
   *    `SUPPLIER_PAYS_US` row). One of these rows anchors the settlement
   *    transaction (`source_table: 'supplier_ledger', source_id`) — the
   *    member with the (unique) commission-eligible FINANCIAL_SERVICE group
   *    when one exists, else the account parent when it has a row, else the
   *    lowest supplier id — so a batch whose parent has no debt of its own
   *    still has a real row to anchor to (CONTRACT_W2.md §1.1). Every OTHER
   *    member's row is written LINK-MODE, sharing the SAME
   *    `transaction_id` — the mechanism this ticket chose (§1.1) so every
   *    row this settlement touched is findable from the settlement
   *    transaction alone: `supplier_ledger WHERE transaction_id = ?`.
   * 4. Each member's ORIGINAL selected rows are stamped settled AGAINST
   *    that member's OWN new row id: `financial_services.settlement_id`/
   *    `is_settled` (`_markFinancialServicesSettled`, unchanged mechanism)
   *    and `supplier_ledger.settlement_id` (`_markLedgerRowsSettled`, v176's
   *    first writer) — never a single shared id, so
   *    `getAccountUnsettled`'s per-row exclusion keeps working per member.
   * 5. The net cash — ONE set of `payments[]` legs, resolved through
   *    `resolveServiceCashDrawer` with the PARENT's provider context (D3,
   *    so a CASH leg always lands in the OMT Cash Drawer regardless of
   *    which child the debt came from) — moves through the SAME
   *    `applyDrawerDelta`/`insertPaymentRow` pair `settleTransactions`/
   *    `recordSupplierCashflow` use, sign flipped for COLLECT (cash IN)
   *    exactly like `recordSupplierCashflow`'s RECEIVE branch (reused
   *    mechanics, not a second copy — §8.4).
   * 6. Settlement-day commission (the ONE eligible member, resolved in step
   *    3) books through the EXISTING, UNMODIFIED
   *    `_resolveSettlementBatchModel`/`_bookCommissionAtSettlement` pair —
   *    same audit trail (`supplier_settlements`/
   *    `settlement_commission_allocations`), same bills-only-drawer-topup
   *    vs cashless-`SUPPLIER_PAYS_US` branch as a standalone
   *    `settleTransactions` call would take for that member alone (rule
   *    14). Because that member is ALWAYS the settlement's anchor when one
   *    exists (step 3), the credit row's existing `source_ref_table`/
   *    `source_ref_id` cascade-void (LIRA-091) and the audit-record
   *    reversal (`_reverseCommissionAtSettlementRecords`) both key off the
   *    anchor's own id — i.e. `TransactionRepository._reverseSupplierSettlement`
   *    reverses this piece TODAY, unmodified, with NO change needed in W2.
   * 7. D14/§8.3a — the commission ALREADY stored (not re-derived) on every
   *    selected WALLET_CASHOUT ledger row is summed (`_sumCashoutCommission`)
   *    and ADDED to whatever step 6 stamped, per currency, as the
   *    settlement transaction's OWN `profit_usd`/`profit_lbp` — the ONE
   *    place this ticket recognises a cashout's deferred profit.
   * 8. LIRA-203 (owner D18 follow-up) — when `data.surplus_usd`/
   *    `surplus_lbp` is nonzero (PAY only), `payments[]` must ALSO cover
   *    that surplus on top of the rows' own net (step 4b), and ONE extra
   *    negative `PAYMENT` `supplier_ledger` row is written on the account
   *    PARENT, link-moded onto this settlement's `transaction_id` but
   *    deliberately left `settlement_id IS NULL` — an open credit row
   *    `getAccountUnsettled` will surface for a LATER settlement to tick
   *    and apply (never auto-applied). See {@link SettleAccountData
   *    .surplus_usd}'s own doc comment for the full design and step G
   *    below for the write.
   *
   * Third hardening round (rule 17, two reviewer-reproduced leaks closed):
   *   Finding A — OUT (change/return) legs are now rejected outright before
   *     step 4a: this method has no customer to hand change back to, and an
   *     IN/OUT pair used to pass the per-currency net-reconciliation guard
   *     while `resolveServiceCashDrawer` (step E) could route each leg to a
   *     DIFFERENT real drawer — a cross-drawer wash with no ledger fact.
   *   Finding B — every selected row's eligibility (open, not settled, not
   *     refunded) is re-checked LIVE inside this write transaction
   *     (`_assertSelectionsStillEligible`, right below), and both marking
   *     helpers (`_markFinancialServicesSettled`/`_markLedgerRowsSettled`)
   *     now also guard on `is_refunded` and return their real
   *     `.run().changes` count, which step D asserts against the expected
   *     id-list length — a row voided in the window between step 0's read
   *     and this write can no longer be silently stamped settled anyway.
   *
   * Fourth hardening round (rule 17, three narrower findings closed):
   *   Finding 1 — `_assertSelectionsStillEligible` now ALSO re-checks
   *     `accountMemberOf` (rule 14) live, for every member supplier this
   *     batch touches — Finding B's re-check covered row-level eligibility
   *     (open/settled/refunded) but never membership itself, so a row whose
   *     owning supplier was re-parented off this account in the same race
   *     window still sailed through. Separately, the account PARENT
   *     (`freshParent`, whose `.provider` feeds `drawerCtx` and routes EVERY
   *     cash leg) is now re-read live inside the transaction rather than
   *     once, before this method's whole validation pipeline, so a provider
   *     edit in that window can no longer silently misroute a leg.
   *   Finding 2 — the two self-stamp
   *     `UPDATE supplier_ledger SET transaction_id = …, settlement_id = …`
   *     statements (the anchor row, and each non-anchor member's own row)
   *     now inspect `.run().changes`, matching
   *     `_markFinancialServicesSettled`/`_markLedgerRowsSettled` — a stamp
   *     that silently affects zero rows aborts the transaction instead of
   *     being treated as success.
   *   Finding 3 (latent, not reachable through today's account membership —
   *     see the guard's own comment) — a commission-eligible member whose
   *     selected rows are ALL `service_type = 'BILL'` is rejected outright
   *     before any write: such a member's gross owed is structurally 0, so
   *     this method's generic per-member ledger-negation would otherwise
   *     read the entered commission back as phantom cash owed and demand a
   *     payment leg for it, double-booking the SAME commission this method's
   *     step F separately credits via the provider-drawer top-up path.
   *
   * Reversal shape for W2 (TransactionRepository, CONTRACT_W2.md §1.1/§9.4):
   * the anchor member's own row/FS-stamps/commission-credit/audit-records
   * ALL already reverse via the existing, UNCHANGED
   * `_reverseSupplierSettlement` (its `settlement_id = original.source_id`
   * / `source_ref_id = original.source_id` keys resolve to the anchor by
   * construction). The generic `_reversePayments` step already reverses
   * EVERY payment row on the settlement transaction (any count) for free,
   * and the transaction's own single `profit_usd`/`profit_lbp` field nets
   * to 0 the same generic way every other transaction's profit does — no
   * new code needed for either. The ONE genuinely new piece: for every
   * NON-anchor member, iterate `supplier_ledger WHERE transaction_id =
   * <this settlement's txn id>`, soft-void each such row
   * (`is_refunded = 1`, `refunded_at`), and — for whichever ORIGINAL rows
   * carry `settlement_id` = that non-anchor row's own id — un-stamp them
   * exactly like the anchor branch already does (both
   * `financial_services.settlement_id`/`is_settled` and
   * `supplier_ledger.settlement_id`). This is §9.4's "single highest-risk
   * piece of the epic," and it is scoped exactly to that one loop.
   */
  settleAccount(data: SettleAccountData): { id: number } {
    if (!this._suppliersHasAccountLinkColumn()) {
      throw new DatabaseError(
        "Account settlement requires the account schema (migration v176)",
      );
    }
    if (!data.selections?.length) {
      throw new DatabaseError("No rows selected for account settlement");
    }

    const tenantId = getCurrentTenantId();
    const parent = this.findById(data.account_supplier_id);
    if (!parent) {
      throw new DatabaseError(
        `Supplier account ${data.account_supplier_id} not found`,
      );
    }

    // ── 0. Re-validate every selection against the account's own queue ────
    // Never trust the client's ids — reuses getAccountUnsettled (rule 14)
    // rather than re-deriving membership/eligibility a second time.
    const unsettled = this.getAccountUnsettled(data.account_supplier_id);
    const unsettledByKey = new Map<string, AccountUnsettledRow>(
      unsettled.map((r) => [`${r.kind}:${r.id}`, r]),
    );
    const seen = new Set<string>();
    const selectedRows: AccountUnsettledRow[] = [];
    for (const sel of data.selections) {
      const key = `${sel.kind}:${sel.id}`;
      if (seen.has(key)) {
        throw new DatabaseError(`Duplicate selection: ${key}`);
      }
      seen.add(key);
      const row = unsettledByKey.get(key);
      if (!row) {
        throw new DatabaseError(
          `Selected ${sel.kind} row ${sel.id} is not an open row on account ` +
            `${data.account_supplier_id} (already settled, refunded, voided, ` +
            `or not a member of this account)`,
        );
      }
      selectedRows.push(row);
    }

    // ── 1. Group by the member that actually OWNS each row (§4) ───────────
    const byMember = new Map<number, AccountUnsettledRow[]>();
    for (const row of selectedRows) {
      const list = byMember.get(row.supplier_id);
      if (list) list.push(row);
      else byMember.set(row.supplier_id, [row]);
    }

    const EPS_USD = 0.005;
    const EPS_LBP = 1;

    const rawMemberNet = new Map<number, { usd: number; lbp: number }>();
    for (const [supplierId, rows] of byMember) {
      let usd = 0;
      let lbp = 0;
      for (const row of rows) {
        usd += row.amount_usd;
        lbp += row.amount_lbp;
      }
      rawMemberNet.set(supplierId, { usd, lbp });
    }

    // ── 2. Commission scope — at most ONE member's FS group (plan §1) ─────
    // Resolved BEFORE the account net (below) because a new-model member's
    // OWN neutralizing row must be NET of its commission — the SAME relation
    // `settleTransactions` documents on `SettleTransactionsData.amount_usd`
    // ("the caller is expected to compute this figure as gross owed −
    // commission_usd/commission_lbp"): the commission is credited back via
    // its OWN separate row (step F below), so the amount still needing a
    // cash-paying neutralizing row is the gross MINUS that credit.
    const fsSelectionsByMember = new Map<number, AccountUnsettledRow[]>();
    for (const row of selectedRows) {
      if (row.kind !== "FINANCIAL_SERVICE") continue;
      const list = fsSelectionsByMember.get(row.supplier_id);
      if (list) list.push(row);
      else fsSelectionsByMember.set(row.supplier_id, [row]);
    }
    const fsMemberIds = Array.from(fsSelectionsByMember.keys());
    const enteredCommission =
      Math.abs(data.commission_usd) > EPS_USD ||
      Math.abs(data.commission_lbp) > EPS_LBP;
    if (enteredCommission && fsMemberIds.length > 1) {
      throw new DatabaseError(
        `Cannot enter one commission figure for a batch spanning multiple ` +
          `financial_service-owning members [${fsMemberIds.join(", ")}] — ` +
          `settle them in separate batches`,
      );
    }
    const commissionSupplierId =
      fsMemberIds.length === 1 ? fsMemberIds[0] : null;
    let commissionModel: 0 | 1 = 0;
    let commissionEligibleRows: EligibleSettlementRow[] = [];
    let commissionFsIds: number[] = [];
    if (commissionSupplierId != null) {
      commissionFsIds = fsSelectionsByMember
        .get(commissionSupplierId)!
        .map((r) => r.id);
      const resolved = this._resolveSettlementBatchModel(
        commissionFsIds,
        tenantId,
      );
      commissionModel = resolved.model;
      commissionEligibleRows = resolved.rows;
    }
    if (enteredCommission && commissionModel !== 1) {
      throw new DatabaseError(
        "Entered commission has no commission_model=1 financial_service rows to apply to in this batch",
      );
    }
    // Finding 3 (fourth hardening round, latent) — a BILLS-ONLY commission
    // member has NO ledger-based gross to net against: `SUPPLIER_OWED_EXPR`
    // is structurally 0 for a BILL row (its principal reaches the supplier
    // via the provider-drawer cost leg, never the ledger — same "bills
    // settlement note" `_bookCommissionAtSettlement`'s own doc comment
    // documents). `settleTransactions` handles this by construction: a
    // bills-only batch's `amount_usd`/`amount_lbp` are contractually $0/0
    // and its commission is funded EITHER by a real provider-drawer top-up
    // (`_bookBillsCommissionDrawerTopUp`) or by dedicated "Other payment"
    // legs verified to sum to the commission exactly — never through the
    // generic net-owed/payment-leg reconciliation.
    //
    // `settleAccount` has no such special case: step 3 below computes this
    // member's net as `raw (= 0 for an all-BILL group) − commission`, so the
    // account's generic per-member ledger-negation would read the entered
    // commission back as if it were real cash OWED, and go on to demand a
    // `payments[]` leg for it (step 4b) — a leg that would then ALSO get
    // credited to a drawer, on top of whatever `_bookCommissionAtSettlement`
    // separately books for the SAME commission in step F. That double-books
    // one commission as two credits with no matching second obligation.
    //
    // Unreachable in production today: the only account members are OMT (no
    // BILL rows — SEND/RECEIVE only) and its children OMT App (no BILL rows
    // either) and iPick, whose BILL rows are born ALREADY settled
    // (`FinancialServiceRepository`'s `isPendingSupplierSettlement` reads
    // `commission_eligible = 0` for iPick and marks the row `is_settled = 1`
    // at creation) — such a row never reaches `getAccountUnsettled`'s queue,
    // so it can never be selected here. But `commission_eligible` is a
    // runtime-mutable per-supplier setting (LIRA-112 D12), not a compile-time
    // constant, and a future account child could submit BILL rows too — so
    // this is guarded explicitly, live, rather than left to that fragile
    // external invariant staying true forever.
    if (enteredCommission && commissionModel === 1) {
      const commissionMemberIsBillsOnly = commissionEligibleRows.every(
        (r) => r.service_type === "BILL",
      );
      if (commissionMemberIsBillsOnly) {
        throw new DatabaseError(
          `Account settlement: supplier ${commissionSupplierId}'s selected ` +
            `financial_service rows are ALL BILL type — a bills-only commission ` +
            `has no ledger-based gross to net against here and cannot be booked ` +
            `through settleAccount (it would demand a phantom cash payment leg ` +
            `for the commission on top of its real provider-drawer top-up). ` +
            `Settle this supplier's BILL rows directly via settleTransactions instead.`,
        );
      }
    }

    // ── 3. Member nets, ADJUSTED for the one commission-bearing member ────
    // Every OTHER member's adjusted net is byte-identical to its raw net.
    const memberNet = new Map<number, { usd: number; lbp: number }>();
    let netUsd = 0;
    let netLbp = 0;
    for (const [supplierId, raw] of rawMemberNet) {
      const net =
        commissionModel === 1 && supplierId === commissionSupplierId
          ? {
              usd: raw.usd - data.commission_usd,
              lbp: raw.lbp - data.commission_lbp,
            }
          : raw;
      memberNet.set(supplierId, net);
      netUsd += net.usd;
      netLbp += net.lbp;
    }

    // ── 4. Direction / amount cross-check — never trust the client ────────
    const wantsPay = data.direction === "PAY";
    if (netUsd > EPS_USD && !wantsPay) {
      throw new DatabaseError(
        "Direction mismatch: the selected rows net to a POSITIVE USD balance (shop owes the account) — use PAY",
      );
    }
    if (netUsd < -EPS_USD && wantsPay) {
      throw new DatabaseError(
        "Direction mismatch: the selected rows net to a NEGATIVE USD balance (the account owes the shop) — use COLLECT",
      );
    }
    if (netLbp > EPS_LBP && !wantsPay) {
      throw new DatabaseError(
        "Direction mismatch: the selected rows net to a POSITIVE LBP balance (shop owes the account) — use PAY",
      );
    }
    if (netLbp < -EPS_LBP && wantsPay) {
      throw new DatabaseError(
        "Direction mismatch: the selected rows net to a NEGATIVE LBP balance (the account owes the shop) — use COLLECT",
      );
    }
    if (Math.abs(Math.abs(netUsd) - data.amount_usd) > EPS_USD) {
      throw new DatabaseError(
        `amount_usd ($${data.amount_usd.toFixed(2)}) does not match the selected rows' net, ` +
          `commission applied ($${Math.abs(netUsd).toFixed(2)})`,
      );
    }
    if (Math.abs(Math.abs(netLbp) - data.amount_lbp) > EPS_LBP) {
      throw new DatabaseError(
        `amount_lbp (${data.amount_lbp}) does not match the selected rows' net, ` +
          `commission applied (${Math.abs(netLbp)})`,
      );
    }

    // ── LIRA-203 — overpayment surplus (owner D18 follow-up) ───────────────
    // See `SettleAccountData.surplus_usd`'s own doc comment for the full
    // design. Validated here, BEFORE the transaction opens, alongside every
    // other direction/amount guard above — a bad request must never open a
    // write transaction just to be rolled back.
    const surplusUsd = data.surplus_usd ?? 0;
    const surplusLbp = data.surplus_lbp ?? 0;
    if (surplusUsd < 0 || surplusLbp < 0) {
      throw new DatabaseError(
        "Account settlement: surplus_usd/surplus_lbp cannot be negative",
      );
    }
    const hasSurplus = surplusUsd > EPS_USD || surplusLbp > EPS_LBP;
    if (hasSurplus && !wantsPay) {
      throw new DatabaseError(
        "Account settlement: an overpayment surplus is only valid when " +
          "PAYING the account (direction: PAY) — collecting more than the " +
          "selected rows' net is not a supported flow here",
      );
    }
    // The rows' own net (validated above, UNCHANGED) plus the declared
    // surplus — this combined figure, never `data.amount_usd`/`amount_lbp`
    // alone, is what `payments[]` must reconcile to from here on.
    const totalAmountUsd = data.amount_usd + surplusUsd;
    const totalAmountLbp = data.amount_lbp + surplusLbp;

    const owesCash =
      Math.abs(totalAmountUsd) > EPS_USD || Math.abs(totalAmountLbp) > EPS_LBP;
    if (owesCash && !data.payments?.length) {
      throw new DatabaseError(
        "Account settlement requires at least one payment-method leg to move the net amount owed",
      );
    }
    if (!owesCash && data.payments?.length) {
      throw new DatabaseError(
        "Account settlement has no net cash to move — payment-method legs are not accepted",
      );
    }

    // ── OUT legs are rejected outright (Finding A, third hardening round) ──
    // Rule 16's OUT legs exist for a flow where a CUSTOMER overpaid and gets
    // change back. A supplier settlement has no customer — the shop either
    // pays exactly what it owes or collects exactly what it's owed.
    // AccountSettleSheet.tsx's own `handleSubmit` comment documents why the
    // UI deliberately never wires a return/kept-change leg here. Before this
    // guard, step 4b's reconciliation checked only the per-currency NET of
    // IN minus OUT against the settled amount, with no bound on gross volume
    // and no requirement that the legs resolve to the same drawer — so a
    // caller could append an equal-and-opposite IN/OUT pair (even in a
    // currency the settled rows never touch), routing the IN leg to one real
    // drawer and the OUT leg to another via `resolveServiceCashDrawer`
    // (step E). The net still passed the guard; real money moved between two
    // of the shop's drawers with no ledger fact and no audit trail — a wash
    // that also desyncs the closing count. Verified before adding this: no
    // caller sends an OUT leg here today — the IPC handler
    // (`electron-app/handlers/supplierHandlers.ts`) and REST route
    // (`backend/src/api/suppliers.ts`) both pass the validated payload
    // through unmodified, and `AccountSettleSheet.tsx` never sets
    // `direction` on a payment line it builds (see its comment above) — so
    // rejecting OUT legs outright closes this completely with no legitimate
    // sender to accommodate. `direction` stays in the shared schema/type
    // (`supplierPaymentLegSchema`) — `settleTransactions`/
    // `recordSupplierCashflow` still use it for their own real change-return
    // legs.
    //
    // Because this check runs unconditionally and throws before either step
    // 4b's leg reconciliation or step E's posting loop is reached, neither
    // of those steps can ever see an OUT leg — their OUT-side branches
    // (an `outLegs`/`outSum` computation in 4b, a second oppositely signed
    // posting loop in E) were removed as dead code (fourth hardening
    // round). Do not re-add OUT-leg handling downstream of this guard: it
    // would be unreachable by construction. If a legitimate need for
    // supplier-settlement change/return legs ever arises, it starts HERE,
    // by relaxing this ban — not by resurrecting the removed branches.
    if (data.payments?.some((p) => p.direction === "OUT")) {
      throw new DatabaseError(
        "Account settlement does not accept OUT (change/return) legs — a " +
          "supplier settlement has no customer to hand change back to; pay " +
          "or collect the exact net amount owed",
      );
    }

    // ── 4a. ONE predicate for "this leg can settle a supplier account" ────
    // Rule 14 — shared by the leg-reconciliation sum immediately below AND
    // the posting loop (step E) so the two can never again independently
    // decide which legs count. THIS is the second leak found in this
    // method: the reconciliation summed EVERY leg (drawer-affecting or not)
    // into its total while the posting loop silently `continue`d past any
    // leg whose method `isDrawerAffectingMethod` excludes (CUSTOMER_ACCOUNT,
    // GIFT_CARD, ...) — `payments = [{CASH, 70}, {CUSTOMER_ACCOUNT, 30}]`
    // against a $100 debt reconciled clean at 70+30=100, stamped the
    // supplier fully settled, and only $70 actually left the drawer. A
    // supplier settlement pays or collects real money from a counterparty:
    // there is no customer to charge via CUSTOMER_ACCOUNT and no gift card
    // to redeem here, so a non-drawer-affecting method is meaningless in
    // this flow — reject it outright, never silently drop the leg, so the
    // caller learns exactly which method is the problem.
    const assertLegMovesADrawer = (method: string): void => {
      if (!isDrawerAffectingMethod(method)) {
        throw new DatabaseError(
          `Account settlement: payment method "${method}" does not move a ` +
            `real drawer and cannot settle a supplier account (no customer ` +
            `to charge, no gift card to redeem)`,
        );
      }
    };

    // ── 4b. Leg reconciliation (rule 16 + the leak this ticket fixes) ─────
    // `data.amount_usd`/`amount_lbp` were already cross-checked above (step
    // 4) against the RE-COMPUTED net of `selections` — but that says nothing
    // about whether `data.payments` (the legs that actually move the
    // drawer, step E below) agree with that figure. Before this check, the
    // posting loop applied EVERY leg verbatim: a supplier owed $100 could be
    // "settled" with a $150 CASH leg and the drawer would drop the full
    // $150 while the ledger only nets $100 — a $50 leak with no ledger row,
    // no profit stamp, and no kept-change record. Symmetric with the
    // Other-payment commission check above (settleTransactions' own
    // per-currency sum comparison), NOT `reconcileLegs`/`moneyPosting.ts`'s
    // USD-equivalent conversion — this flow has no exchange rate to convert
    // at (`SettleAccountData.exchange_rate`'s own doc: "no exchange rate is
    // involved anywhere in this flow"), so legs are reconciled PER CURRENCY,
    // same EPS_USD/EPS_LBP tolerance as every other check in this method.
    //
    // No IN/OUT partition needed: every leg reaching this point IS an IN
    // leg — the ban just above already hard-rejects any leg carrying
    // `direction: "OUT"`, so `data.payments` can never contain one here.
    // Sum every leg verbatim as money actually paid/collected.
    //
    // A mismatch in EITHER direction (overpay or underpay) is a hard reject,
    // never silently absorbed or auto-corrected: a supplier settlement has
    // no customer to hand change to and no "the shop keeps the difference"
    // concept like a sale's kept-change — the operator's legs must describe
    // exactly the amount being settled, or the batch doesn't post. Money
    // must never move without a matching ledger fact.
    if (data.payments && data.payments.length > 0) {
      let legSumUsd = 0;
      let legSumLbp = 0;
      for (const leg of data.payments) {
        assertLegMovesADrawer(leg.method);
        const amt = Math.abs(leg.amount);
        if (leg.currency_code === "USD") legSumUsd += amt;
        else if (leg.currency_code === "LBP") legSumLbp += amt;
        else {
          throw new DatabaseError(
            `Account settlement: payment leg currency "${leg.currency_code}" is not USD or LBP`,
          );
        }
      }
      if (
        Math.abs(legSumUsd - totalAmountUsd) > EPS_USD ||
        Math.abs(legSumLbp - totalAmountLbp) > EPS_LBP
      ) {
        throw new DatabaseError(
          `Account settlement payment legs do not reconcile to the settled amount ` +
            `${hasSurplus ? "(selected rows + overpayment surplus) " : ""}— ` +
            `expected $${totalAmountUsd.toFixed(2)} + ${totalAmountLbp} LBP, ` +
            `got $${legSumUsd.toFixed(2)} + ${legSumLbp} LBP`,
        );
      }
    }

    // ── 6. Drawer context — PARENT's provider (D3) ─────────────────────────
    // Finding 1 (fourth hardening round) — NOT built here. `parent` was read
    // ONCE, before this whole validation pipeline ran; a provider edit
    // landing in the window between that read and the write transaction
    // would silently route every cash leg through the OLD provider's drawer
    // context. Re-read live, inside the transaction, right below.

    // ── 7. Anchor selection (§1.1 — "no parent row to anchor to") ─────────
    const memberIds = Array.from(byMember.keys());
    let anchorSupplierId: number;
    if (commissionSupplierId != null && memberIds.includes(commissionSupplierId)) {
      anchorSupplierId = commissionSupplierId;
    } else if (memberIds.includes(data.account_supplier_id)) {
      anchorSupplierId = data.account_supplier_id;
    } else {
      anchorSupplierId = Math.min(...memberIds);
    }

    // Pure — picks the entry_type/signed amounts that negate a member's own
    // subtotal to exactly 0 (recordSupplierCashflow's PAY/RECEIVE sign
    // convention, generalized to a POSITIVE-or-NEGATIVE starting subtotal).
    const resolveEntry = (
      supplierId: number,
      net: { usd: number; lbp: number },
    ): {
      entryType: SupplierLedgerEntryType;
      amountUsd: number;
      amountLbp: number;
    } => {
      const amountUsd = -net.usd;
      const amountLbp = -net.lbp;
      const usdSign = amountUsd > EPS_USD ? 1 : amountUsd < -EPS_USD ? -1 : 0;
      const lbpSign = amountLbp > EPS_LBP ? 1 : amountLbp < -EPS_LBP ? -1 : 0;
      if (usdSign !== 0 && lbpSign !== 0 && usdSign !== lbpSign) {
        throw new DatabaseError(
          `Cannot settle account member ${supplierId}: its USD and LBP ` +
            `balances net in opposite directions within this batch — settle ` +
            `currencies separately`,
        );
      }
      const overallSign = usdSign || lbpSign;
      const entryType: SupplierLedgerEntryType =
        overallSign < 0 ? "PAYMENT" : "SUPPLIER_PAYS_US";
      return { entryType, amountUsd, amountLbp };
    };

    try {
      const settle = this.db.transaction(() => {
        // ── 0b. Live re-check INSIDE the write transaction (Finding B) ─────
        // Step 0's `getAccountUnsettled` validation ran BEFORE this
        // transaction opened — re-run the same "still open" predicate live,
        // now, against every selected id and abort the WHOLE transaction
        // (nothing committed) if anything changed underneath this batch.
        const ledgerSelectionIds = selectedRows
          .filter((r) => r.kind === "LEDGER")
          .map((r) => r.id);
        this._assertSelectionsStillEligible(
          selectedRows
            .filter((r) => r.kind === "FINANCIAL_SERVICE")
            .map((r) => r.id),
          ledgerSelectionIds,
          memberIds,
          data.account_supplier_id,
          tenantId,
        );

        // Finding 1 (fourth hardening round) — re-read the account PARENT
        // live, inside the transaction, rather than trusting the pre-
        // validation `parent` read from before this method's whole
        // selections/commission/direction pipeline ran. `freshParent.provider`
        // is what `drawerCtx` (below) routes EVERY cash leg through
        // (`resolveServiceCashDrawer`) — a provider edit landing in that
        // window must never silently apply to this settlement's legs.
        const freshParent = this.findById(data.account_supplier_id);
        if (!freshParent) {
          throw new DatabaseError(
            `Account settlement aborted: supplier account ${data.account_supplier_id} ` +
              `no longer exists — re-open the settle sheet and try again`,
          );
        }
        const drawerCtx: ServiceCashDrawerContext = {
          provider: freshParent.provider ?? "",
          baseSystem: getSettingsService().getShopBaseSystem(),
        };

        // ── 5. D14 — sum the ALREADY-STAMPED cashout commission ────────────
        // Fourth-hole hunt (third hardening round): this used to run BEFORE
        // the transaction opened, from a `transactions`/`supplier_ledger`
        // read (`_cashoutCommissionByLedgerId` → `getBySourceId(...).status
        // === 'ACTIVE'`) that is a DIFFERENT row than the one
        // `_assertSelectionsStillEligible` just re-checked above — a
        // cashout's OWN `WALLET_CASHOUT` transaction could be voided in the
        // very same window Finding B closed for the ledger/financial_service
        // rows themselves, while the `supplier_ledger` row being settled
        // here stays perfectly open the whole time (voiding a cashout does
        // NOT touch its ledger row's `is_refunded`/`settlement_id` — see
        // `_reverseSupplierCashflow`/the cashout's own reversal path). A
        // stale pre-transaction read would then stamp this settlement's
        // `profit_usd`/`profit_lbp` with a commission credit that no longer
        // has an ACTIVE cashout behind it — phantom profit, not a drawer
        // leak, but still a real ledger-integrity bug (rule 20 cares about
        // exactly this class of figure). Moved here, live, inside the write
        // transaction, right after the eligibility re-check above, so both
        // reads land in the same narrow window.
        const cashoutCommission = this._sumCashoutCommission(
          ledgerSelectionIds,
          tenantId,
        );
        const profitUsd =
          (commissionModel === 1 ? data.commission_usd : 0) +
          cashoutCommission.usd;
        const profitLbp =
          (commissionModel === 1 ? data.commission_lbp : 0) +
          cashoutCommission.lbp;

        const otherMemberIds = memberIds.filter(
          (id) => id !== anchorSupplierId,
        );
        const memberLedgerRowId = new Map<number, number>();
        const note =
          data.note ?? `Account settlement: ${freshParent.name} (${data.direction})`;

        // ── A. Anchor member's own row (transaction_id linked after create) ──
        const anchorNet = memberNet.get(anchorSupplierId)!;
        const anchorEntry = resolveEntry(anchorSupplierId, anchorNet);
        const anchorRes = this.db
          .prepare(
            `INSERT INTO supplier_ledger
               (supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, tenant_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
          )
          .run(
            anchorSupplierId,
            anchorEntry.entryType,
            anchorEntry.amountUsd,
            anchorEntry.amountLbp,
            note,
            data.created_by,
            tenantId,
          );
        const anchorLedgerId = Number(anchorRes.lastInsertRowid);
        memberLedgerRowId.set(anchorSupplierId, anchorLedgerId);

        // ── B. ONE SUPPLIER_SETTLEMENT transaction, anchored on row A ──────
        const totalMembers = memberIds.length;
        const settlementMethod =
          data.payments && data.payments.length > 0
            ? data.payments.length === 1
              ? data.payments[0].method
              : "SPLIT"
            : "CASH";
        const summary =
          `Account Settlement: ${freshParent.name} — ${data.direction} ` +
          `$${data.amount_usd.toFixed(2)}` +
          `${data.amount_lbp ? ` + ${data.amount_lbp.toLocaleString()} LBP` : ""}` +
          ` across ${totalMembers} member${totalMembers === 1 ? "" : "s"}` +
          (hasSurplus
            ? ` (+ $${surplusUsd.toFixed(2)}` +
              `${surplusLbp ? ` / ${surplusLbp.toLocaleString()} LBP` : ""}` +
              ` overpayment credit)`
            : "");
        const txnId = getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.SUPPLIER_SETTLEMENT,
          source_table: "supplier_ledger",
          source_id: anchorLedgerId,
          user_id: data.created_by,
          amount_usd: data.amount_usd,
          amount_lbp: data.amount_lbp,
          profit_usd: profitUsd,
          profit_lbp: profitLbp,
          summary,
          metadata_json: {
            account_supplier_id: data.account_supplier_id,
            direction: data.direction,
            selections: data.selections,
            commission_usd: data.commission_usd,
            commission_lbp: data.commission_lbp,
            entry_mode: data.entry_mode ?? "LUMP",
            cashout_commission_usd: cashoutCommission.usd,
            cashout_commission_lbp: cashoutCommission.lbp,
            // LIRA-203 — 0/0 for every pre-existing caller, so this key is
            // purely additive audit context, never read by any reversal or
            // balance logic (the credit ROW itself, not this metadata, is
            // what the account balance/queue actually reflect).
            surplus_usd: surplusUsd,
            surplus_lbp: surplusLbp,
            members: memberIds,
            counterparty: buildCounterpartyMetadata({
              kind: "supplier",
              id: data.account_supplier_id,
              name: freshParent.name,
              flow: wantsPay ? "OUT" : "IN",
              method: settlementMethod,
              ledgerEntryId: anchorLedgerId,
            }),
          },
        });
        // Self-stamp settlement_id too (in the SAME statement as the
        // transaction_id link) — a settlement's OWN neutralizing row must
        // never re-enter `getAccountUnsettled`'s LEDGER-kind scan as a
        // phantom open row (that scan's only exclusion is `settlement_id IS
        // NULL`). Gated on the same v176 schema-drift guard as every other
        // `supplier_ledger.settlement_id` write in this file.
        const hasSettlementIdCol = this._supplierLedgerHasSettlementIdColumn();
        // Finding 2 (fourth hardening round) — inspect `.changes` on this
        // self-stamp exactly like `_markFinancialServicesSettled`/
        // `_markLedgerRowsSettled` already do: a stamp that silently affects
        // ZERO rows (the anchor row somehow gone, or `tenant_id` mismatched)
        // must never be treated as success — the row it was just inserted as
        // would be left un-linked to its own settlement transaction with no
        // error raised.
        const anchorStampRes = this.db
          .prepare(
            hasSettlementIdCol
              ? `UPDATE supplier_ledger SET transaction_id = ?, settlement_id = ? WHERE id = ? AND tenant_id = ?`
              : `UPDATE supplier_ledger SET transaction_id = ? WHERE id = ? AND tenant_id = ?`,
          )
          .run(
            ...(hasSettlementIdCol
              ? [txnId, anchorLedgerId, anchorLedgerId, tenantId]
              : [txnId, anchorLedgerId, tenantId]),
          );
        if (anchorStampRes.changes !== 1) {
          throw new DatabaseError(
            `Account settlement aborted: failed to stamp the anchor ` +
              `supplier_ledger row ${anchorLedgerId} with its transaction/settlement id`,
          );
        }

        // ── C. Every OTHER member's own row — link-mode, same transaction ──
        for (const supplierId of otherMemberIds) {
          const net = memberNet.get(supplierId)!;
          const entry = resolveEntry(supplierId, net);
          const res = this.db
            .prepare(
              `INSERT INTO supplier_ledger
                 (supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, transaction_id, tenant_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
            )
            .run(
              supplierId,
              entry.entryType,
              entry.amountUsd,
              entry.amountLbp,
              note,
              data.created_by,
              txnId,
              tenantId,
            );
          const memberLedgerId = Number(res.lastInsertRowid);
          memberLedgerRowId.set(supplierId, memberLedgerId);
          // Self-stamp — see the anchor row's identical comment above
          // (Finding 2: same `.changes` check, never a silent no-op).
          if (hasSettlementIdCol) {
            const memberStampRes = this.db
              .prepare(
                `UPDATE supplier_ledger SET settlement_id = ? WHERE id = ? AND tenant_id = ?`,
              )
              .run(memberLedgerId, memberLedgerId, tenantId);
            if (memberStampRes.changes !== 1) {
              throw new DatabaseError(
                `Account settlement aborted: failed to stamp member ${supplierId}'s ` +
                  `own settlement row ${memberLedgerId} with its settlement id`,
              );
            }
          }
        }

        // ── D. Stamp every ORIGINAL selected row settled, per member ───────
        for (const [supplierId, rows] of byMember) {
          const newRowId = memberLedgerRowId.get(supplierId)!;
          const fsIds = rows
            .filter((r) => r.kind === "FINANCIAL_SERVICE")
            .map((r) => r.id);
          const ledgerIds = rows
            .filter((r) => r.kind === "LEDGER")
            .map((r) => r.id);
          // Finding B — a stamp that silently affects fewer rows than
          // expected must never be treated as success (it means a selected
          // row was settled/refunded/voided out from under this batch in the
          // window since step 0, and slipped past the live re-check above
          // too — e.g. a second concurrent settlement stamping the SAME row
          // between that check and this exact UPDATE). Abort the WHOLE
          // transaction rather than let this member's balance go wrong with
          // no open row left to explain it.
          const fsChanges = this._markFinancialServicesSettled(
            fsIds,
            newRowId,
            tenantId,
          );
          if (fsChanges !== fsIds.length) {
            throw new DatabaseError(
              `Account settlement aborted: expected to stamp ${fsIds.length} ` +
                `financial_service row(s) for supplier ${supplierId}, but ` +
                `${fsChanges} were actually affected`,
            );
          }
          const ledgerChanges = this._markLedgerRowsSettled(
            ledgerIds,
            newRowId,
            tenantId,
          );
          if (ledgerChanges !== ledgerIds.length) {
            throw new DatabaseError(
              `Account settlement aborted: expected to stamp ${ledgerIds.length} ` +
                `supplier_ledger row(s) for supplier ${supplierId}, but ` +
                `${ledgerChanges} were actually affected`,
            );
          }
        }

        // ── E. The net cash leg(s) — sign per D3/§8.4 ──────────────────────
        // Every leg here is an IN leg — OUT (change/return) legs are
        // rejected outright before this transaction ever opens (the ban
        // above), so there is no counterpart OUT-debiting loop to run: a
        // supplier settlement has no customer to hand change back to. PAY
        // (cashSign -1): cash leaves the drawer. COLLECT (cashSign +1): cash
        // arrives. Contrast SalesRepository/DebtRepository, whose flows DO
        // accept genuine change-return legs and need a second, oppositely
        // signed loop for them.
        //
        // No `continue`-skip for a non-drawer-affecting method: step 4b
        // already rejected any such leg via the SAME `assertLegMovesADrawer`
        // (rule 14) before this transaction ever opened, so every leg
        // reaching this loop is guaranteed drawer-affecting. Asserted again
        // here — not a second independent decision, the identical function —
        // purely as defense-in-depth so this loop can never again silently
        // bank a leg the reconciliation counted as paid, even if a future
        // change altered step 4b's gate.
        const cashSign = wantsPay ? -1 : 1;
        for (const p of data.payments ?? []) {
          assertLegMovesADrawer(p.method);
          const drawerName = resolveServiceCashDrawer(p.method, drawerCtx);
          const delta = cashSign * Math.abs(p.amount);
          applyDrawerDelta(this.db, {
            drawerName,
            currencyCode: p.currency_code,
            delta,
            tenantId,
          });
          insertPaymentRow(this.db, {
            transactionId: txnId,
            method: p.method,
            drawerName,
            currencyCode: p.currency_code,
            amount: delta,
            note: data.note ?? summary,
            createdBy: data.created_by,
            tenantId,
          });
        }

        // ── F. NEW-MODEL commission — unmodified settleTransactions machinery ──
        if (
          commissionSupplierId != null &&
          commissionModel === 1 &&
          commissionEligibleRows.length > 0
        ) {
          const commissionSupplier = this.findById(commissionSupplierId);
          const isBillsOnlyBatch = commissionEligibleRows.every(
            (r) => r.service_type === "BILL",
          );
          this._bookCommissionAtSettlement({
            settlementLedgerId: memberLedgerRowId.get(commissionSupplierId)!,
            settlementTxnId: txnId,
            supplierId: commissionSupplierId,
            supplierProvider: commissionSupplier?.provider ?? null,
            isBillsOnlyBatch,
            rows: commissionEligibleRows,
            data: {
              supplier_id: commissionSupplierId,
              financial_service_ids: commissionFsIds,
              amount_usd: data.amount_usd,
              amount_lbp: data.amount_lbp,
              commission_usd: data.commission_usd,
              commission_lbp: data.commission_lbp,
              entry_mode: data.entry_mode,
              commission_rate: data.commission_rate,
              commission_unit_count: data.commission_unit_count,
              created_by: data.created_by,
            },
            tenantId,
            drawerCtx,
          });
        }

        // ── G. Overpayment surplus row (LIRA-203, owner D18 follow-up) ─────
        // ONE standalone `supplier_ledger` row on the account PARENT
        // (never merged into any member's own negating row from step A/C —
        // it isn't settling anything, so it has no "member" of its own),
        // negative (credit — same sign convention `resolveEntry` uses for
        // "the account owes the shop"), sharing this settlement's
        // `transaction_id` (link mode, exactly like step C) so
        // `_reverseSupplierSettlement`'s existing
        // `supplier_ledger WHERE transaction_id = ?` scan finds and
        // soft-voids it for free on void/refund — no new reversal code.
        //
        // Deliberately NOT self-stamped with `settlement_id` (contrast the
        // anchor/member self-stamps above): it must stay OPEN
        // (`settlement_id IS NULL`) so `getAccountUnsettled` keeps listing
        // it as a selectable credit row until an operator ticks it in a
        // future settlement — that tick IS the entire "apply credit
        // manually" mechanism (D18), reusing steps 0-3's existing
        // mixed-sign selection/negation unchanged.
        if (hasSurplus) {
          const surplusNote =
            `Overpayment credit: ${freshParent.name} — paid ` +
            `$${surplusUsd.toFixed(2)}` +
            `${surplusLbp ? ` + ${surplusLbp.toLocaleString()} LBP` : ""}` +
            ` beyond the ${totalMembers} selected row${totalMembers === 1 ? "" : "s"}`;
          this.db
            .prepare(
              `INSERT INTO supplier_ledger
                 (supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, transaction_id, tenant_id, created_at)
               VALUES (?, 'PAYMENT', ?, ?, ?, ?, ?, ?, datetime('now'))`,
            )
            .run(
              data.account_supplier_id,
              -surplusUsd,
              -surplusLbp,
              surplusNote,
              data.created_by,
              txnId,
              tenantId,
            );
        }

        // Return the ANCHOR ledger row id — same convention as
        // `settleTransactions`'s own `{ id: ledgerEntryId }` (never the
        // transaction id).
        return { id: anchorLedgerId };
      });

      return settle();
    } catch (e) {
      throw new DatabaseError("Failed to settle account", { cause: e });
    }
  }

  /**
   * Record a direct supplier cash flow that is NOT tied to settling specific
   * transactions — paying a supplier down, or a supplier paying us back.
   *
   * Uses real payment-method legs so the cash hits the CORRECT drawer (General
   * for CASH, the wallet drawer for WHISH/OMT, etc.) — never the provider's own
   * stock drawer. When the supplier IS the shop's primary provider
   * (`shop_base_system`), a CASH leg resolves to the primary cash drawer
   * (PCD) instead of General (Primary Cash Drawer plan §1/§8.2, decision
   * #10). Works with zero pending transactions.
   *
   *   PAY     → ledger −amount (we owe less), drawer −amount (cash out)
   *   RECEIVE → ledger +amount (their debt to us settled), drawer +amount (cash in)
   */
  recordSupplierCashflow(data: SupplierCashflowData): { id: number } {
    if (!data.payments?.length) {
      throw new DatabaseError("No payment legs provided");
    }
    // CQ-10: a discount only makes sense on a PAY-direction cashflow (we owe
    // them, they forgive part of it) — RECEIVE means the supplier is paying
    // US, so "they also forgive what we owe" is a contradiction in the same
    // call. Guarded here (not just at the schema/service layer) so no caller
    // can bypass it.
    if (data.discount && data.direction !== "PAY") {
      throw new DatabaseError(
        `recordSupplierCashflow: discount is only valid on PAY-direction cashflow (got "${data.direction}")`,
      );
    }

    // ── LIRA-193 (OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §11.4) ───────────────────
    // `recordSupplierCashflow` has no separate "target" field the way
    // `settleTransactions`/`settleAccount` do — the amount posted to
    // `supplier_ledger` and the unified transaction below IS the sum of
    // `data.payments` (see the sum loop inside the transaction), so there is
    // no separate total to reconcile a leg sum AGAINST. The leak here is the
    // same shape in a narrower form: that sum used to include EVERY leg
    // (drawer-affecting or not), while the posting loop silently `continue`d
    // past any leg `isDrawerAffectingMethod` excludes — a $100
    // CUSTOMER_ACCOUNT leg would stamp `supplier_ledger`/the transaction
    // with $100 paid/received while the posting loop skipped it and NO
    // drawer moved at all. Rejecting a non-drawer-affecting leg outright,
    // here, BEFORE the sum is ever computed, guarantees the two can never
    // again diverge — every leg that reaches the sum loop below is
    // guaranteed to also reach the posting loop. Same shared predicate
    // `settleTransactions` uses (rule 14), and the same OUT-leg rejection
    // `settleAccount` established (LIRA-189): no code in this method has
    // ever read a per-leg `direction` (verified — grepped this method body),
    // so there is no legitimate change-return sender to accommodate here
    // either. Also validates currency here, for the identical reason: the
    // sum loop below only buckets USD/LBP and silently drops any other
    // currency code from the total while the posting loop would still post
    // it to a real drawer — the same sum-vs-post divergence, just via an
    // unrecognised currency instead of a non-drawer method.
    for (const p of data.payments) {
      if (p.direction === "OUT") {
        throw new DatabaseError(
          "Supplier cashflow does not accept OUT (change/return) legs — " +
            "there is no customer to hand change back to; pay or collect " +
            "the exact amount",
        );
      }
      this._assertSupplierLegMovesADrawer(p.method, "Supplier cashflow");
      this._assertSupplierLegCurrencyIsValid(
        p.currency_code,
        "Supplier cashflow",
      );
    }

    try {
      const tenantId = getCurrentTenantId();
      // Primary Cash Drawer plan §1/§8.2 (decision #10) — same resolution as
      // settleTransactions, read-only before the write transaction below.
      const supplier = this.findById(data.supplier_id);
      const drawerCtx: ServiceCashDrawerContext = {
        provider: supplier?.provider ?? "",
        baseSystem: getSettingsService().getShopBaseSystem(),
      };
      const run = this.db.transaction(() => {
        // SQLite-side timestamps — see settleTransactions (A6 ordering).
        const isPay = data.direction === "PAY";
        const entryType: SupplierLedgerEntryType = isPay
          ? "PAYMENT"
          : "SUPPLIER_PAYS_US";
        // PAY: cash out + reduce what we owe (−). RECEIVE: cash in + settle their
        // debt to us (+). Ledger and drawer share the same sign here.
        const sign = isPay ? -1 : 1;
        const rate =
          data.exchange_rate && data.exchange_rate > 0
            ? data.exchange_rate
            : 89000;

        let usd = 0;
        let lbp = 0;
        for (const p of data.payments) {
          const amt = Math.abs(p.amount);
          if (p.currency_code === "USD") usd += amt;
          else if (p.currency_code === "LBP") lbp += amt;
        }

        const ledgerRes = this.db
          .prepare(
            `INSERT INTO supplier_ledger
               (supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, tenant_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
          )
          .run(
            data.supplier_id,
            entryType,
            sign * usd,
            sign * lbp,
            data.note ?? null,
            data.created_by,
            tenantId,
          );
        const ledgerEntryId = Number(ledgerRes.lastInsertRowid);

        const money = `$${usd.toFixed(2)}${lbp ? ` + ${lbp.toLocaleString()} LBP` : ""}`;
        // note 14 — thin-summary enrichment: append the supplier's name
        // (paid TO them vs received FROM them), after the existing prefix.
        const supplierName = this._getSupplierName(data.supplier_id);
        const summary = isPay
          ? `Supplier Payment: ${money} — paid to ${supplierName}`
          : `Supplier Payment Received: ${money} — received from ${supplierName}`;
        // CQ-7: funneled through createTransaction() instead of a raw INSERT
        // — gains the completeness guards and exchange-rate snapshot.
        const cashflowMethod =
          data.payments.length === 1 ? data.payments[0].method : "SPLIT";
        const txnId = getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.SUPPLIER_PAYMENT,
          source_table: "supplier_ledger",
          source_id: ledgerEntryId,
          user_id: data.created_by,
          amount_usd: usd,
          amount_lbp: lbp,
          summary,
          metadata_json: {
            supplier_id: data.supplier_id,
            direction: data.direction,
            entry_type: entryType,
            // CQ-8 counterparty contract: PAY = shop pays the supplier
            // (OUT); RECEIVE = supplier pays the shop (IN). CQ-10: a bundled
            // discount is annotated onto THIS transaction's metadata
            // (informational — the money-and-profit effect lives on the
            // separate COUNTERPARTY_DISCOUNT row posted below).
            counterparty: buildCounterpartyMetadata({
              kind: "supplier",
              id: data.supplier_id,
              name: this._getSupplierName(data.supplier_id),
              flow: isPay ? "OUT" : "IN",
              method: cashflowMethod,
              ledgerEntryId: ledgerEntryId,
              discount: data.discount
                ? {
                    amount_usd: Math.abs(data.discount.amount_usd || 0),
                    amount_lbp: Math.abs(data.discount.amount_lbp || 0),
                    reason: data.discount.reason,
                  }
                : undefined,
            }),
          },
        });
        this.db
          .prepare(
            `UPDATE supplier_ledger SET transaction_id = ? WHERE id = ? AND tenant_id = ?`,
          )
          .run(txnId, ledgerEntryId, tenantId);

        for (const p of data.payments) {
          // LIRA-193 — defense-in-depth assertion (rule 14), mirroring
          // settleTransactions/settleAccount: the guard above already
          // rejected any non-drawer-affecting leg via the SAME predicate
          // before this transaction ever opened, so this loop can never
          // again silently skip a leg the sum above (usd/lbp) already
          // counted toward the amount stamped on supplier_ledger.
          this._assertSupplierLegMovesADrawer(p.method, "Supplier cashflow");
          // Primary Cash Drawer plan §1/§8.2 (decision #10): a CASH leg to
          // the shop's primary-system supplier resolves to the PCD.
          const drawerName = resolveServiceCashDrawer(p.method, drawerCtx);
          const delta = sign * Math.abs(p.amount);
          applyDrawerDelta(this.db, {
            drawerName,
            currencyCode: p.currency_code,
            delta,
            tenantId,
          });
          insertPaymentRow(this.db, {
            transactionId: txnId,
            method: p.method,
            drawerName,
            currencyCode: p.currency_code,
            amount: delta,
            note: data.note ?? summary,
            createdBy: data.created_by,
            tenantId,
          });
        }

        // Apply FIFO coverage to supplier_purchases for PAY direction.
        // LBP legs are converted to USD at the payment's exchange rate.
        if (isPay) {
          this._applyPurchaseFifoCoverage(
            data.supplier_id,
            usd + lbp / rate,
            tenantId,
          );
        }

        // CQ-10 — bundled discount: posted AFTER the cashflow's own FIFO
        // coverage so the discount's budget only touches whatever the cash
        // portion left open (same open purchases, a second/remaining pass).
        if (
          data.discount &&
          (data.discount.amount_usd > 0 || data.discount.amount_lbp > 0)
        ) {
          this._postSupplierDiscount(
            data.supplier_id,
            data.discount,
            data.created_by,
            tenantId,
            rate,
          );
        }

        return { id: ledgerEntryId };
      });

      return run();
    } catch (e) {
      throw new DatabaseError("Failed to record supplier cashflow", {
        cause: e,
      });
    }
  }

  /**
   * Rule 14 — the ONE FIFO allocator for supplier_purchases (shared by
   * recordSupplierCashflow's PAY branch and _postSupplierDiscount; CQ-10
   * extracted this out of recordSupplierCashflow rather than pasting the
   * same allocation loop a third time). Oldest-open-first, clamped at each
   * purchase's outstanding balance. `usdEquivalent` is already converted
   * (LBP legs pre-converted by the caller at the transaction's exchange rate).
   */
  private _applyPurchaseFifoCoverage(
    supplierId: number,
    usdEquivalent: number,
    tenantId: number,
  ): void {
    if (usdEquivalent <= 0) return;
    const unpaid = this.db
      .prepare(
        `SELECT id, total_usd, paid_usd
         FROM supplier_purchases
         WHERE supplier_id = ? AND paid_usd < total_usd - 0.005 AND tenant_id = ?
         ORDER BY created_at ASC`,
      )
      .all(supplierId, tenantId) as {
      id: number;
      total_usd: number;
      paid_usd: number;
    }[];

    const updatePurchase = this.db.prepare(
      `UPDATE supplier_purchases
       SET paid_usd = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND tenant_id = ?`,
    );

    // CQ-2 — shared FIFO allocator; epsilon 0 matches this site's original
    // exact tolerance (the SQL filter above already guarantees every open
    // row has more than 0.005 outstanding, so the allocator's own epsilon
    // only needs to gate the remaining-budget stop condition).
    const takes = allocateFifo(
      unpaid.map((row) => ({
        id: row.id,
        outstanding: row.total_usd - row.paid_usd,
      })),
      usdEquivalent,
      0,
    );
    const unpaidById = new Map(unpaid.map((row) => [row.id, row]));
    for (const t of takes) {
      const row = unpaidById.get(t.id as number)!;
      updatePurchase.run(
        Math.min(row.paid_usd + t.take, row.total_usd),
        row.id,
        tenantId,
      );
    }
  }

  /**
   * CQ-10 — post ONE COUNTERPARTY_DISCOUNT transaction (+ its owning
   * 'DISCOUNT' supplier_ledger row) for a supplier forgiving part of what the
   * shop owes them. D8: the standalone write-off caller was removed — this is
   * now called ONLY from recordSupplierCashflow's PAY-direction branch
   * (bundled discount), inside that flow's own db.transaction().
   *
   * amount_usd/amount_lbp = 0 (no cash moved); profit_usd/profit_lbp =
   * POSITIVE the forgiven amount (D1: a supplier discount is a gain — the
   * shop no longer has to pay that cost).
   */
  private _postSupplierDiscount(
    supplierId: number,
    discount: SupplierDiscountData,
    createdBy: number,
    tenantId: number,
    rate = 89000,
  ): number {
    const amountUsd = Math.abs(discount.amount_usd || 0);
    const amountLbp = Math.abs(discount.amount_lbp || 0);

    const ledgerRes = this.db
      .prepare(
        `INSERT INTO supplier_ledger
           (supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, tenant_id, created_at)
         VALUES (?, 'DISCOUNT', ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        supplierId,
        -amountUsd,
        -amountLbp,
        discount.reason ?? null,
        createdBy,
        tenantId,
      );
    const ledgerEntryId = Number(ledgerRes.lastInsertRowid);

    const label = this._getSupplierName(supplierId);
    const money = `$${amountUsd.toFixed(2)}${amountLbp ? ` + ${amountLbp.toLocaleString()} LBP` : ""}`;
    // CQ-5: the signed profit + counterparty metadata shape (D1 — a supplier
    // forgiving a payable is booked "as if paid", flow OUT) is now the ONE
    // shared helper every counterparty discount posts through (moneyPosting.ts).
    const posting = buildCounterpartyDiscountPosting({
      kind: "supplier",
      ledgerEntryId,
      counterpartyId: supplierId,
      counterpartyName: label,
      amountUsd,
      amountLbp,
      discountDirection: "received",
      reason: discount.reason,
      extraMetadata: { supplier_id: supplierId, entry_type: "DISCOUNT" },
    });
    const txnId = getTransactionRepository().createTransaction({
      type: TRANSACTION_TYPES.COUNTERPARTY_DISCOUNT,
      source_table: "supplier_ledger",
      source_id: ledgerEntryId,
      user_id: createdBy,
      amount_usd: 0,
      amount_lbp: 0,
      profit_usd: posting.profit_usd,
      profit_lbp: posting.profit_lbp,
      summary: `Supplier discount received: ${money} — ${label}`,
      metadata_json: posting.metadata_json,
    });

    this.db
      .prepare(
        `UPDATE supplier_ledger SET transaction_id = ? WHERE id = ? AND tenant_id = ?`,
      )
      .run(txnId, ledgerEntryId, tenantId);

    const usdEquivalent = amountUsd + amountLbp / rate;
    this._applyPurchaseFifoCoverage(supplierId, usdEquivalent, tenantId);

    return txnId;
  }

  /**
   * Per-supplier net balance (+ = shop owes supplier). D8: the standalone
   * write-off that used to be this method's only production caller
   * (SupplierService.writeOffSupplierDebt) was removed — this now exists as
   * the "nets to 0 across void/reverse cycles" oracle asserted directly by
   * `FinancialServiceRepository.partner.test.ts` and
   * `TransactionRepository.supplierSiblingVoidCascade.test.ts` (rule 17/20).
   */
  getSupplierBalance(supplierId: number): {
    balance_usd: number;
    balance_lbp: number;
  } {
    const tenantId = getCurrentTenantId();
    const row = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(amount_usd), 0) as balance_usd,
          COALESCE(SUM(amount_lbp), 0) as balance_lbp
         FROM supplier_ledger
         WHERE supplier_id = ? AND tenant_id = ? AND ${ledgerNotRefunded()}`,
      )
      .get(supplierId, tenantId) as
      | { balance_usd: number; balance_lbp: number }
      | undefined;
    return {
      balance_usd: row?.balance_usd ?? 0,
      balance_lbp: row?.balance_lbp ?? 0,
    };
  }

  // D8: writeOffSupplierDebt (standalone write-off, its own transaction) was
  // REMOVED — the owner decided the bundled Pay-form discount is the only
  // supported path. `_postSupplierDiscount` above stays; it is also called
  // from recordSupplierCashflow's PAY-direction branch.
}

let supplierRepositoryInstance: SupplierRepository | null = null;
export function getSupplierRepository(): SupplierRepository {
  if (!supplierRepositoryInstance)
    supplierRepositoryInstance = new SupplierRepository();
  return supplierRepositoryInstance;
}
export function resetSupplierRepository(): void {
  supplierRepositoryInstance = null;
}
