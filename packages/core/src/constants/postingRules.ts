/**
 * Posting rules — `docs/POSTING_MAP.md` §4 as a typed table
 * (POSTING_INTEGRITY_PLAN.md §7, phase 5 "option B", owner-approved 2026-10-07).
 *
 * One business action writes postings into several ledgers at once. This
 * table declares, per transaction type × mode, which ledgers MUST move, which
 * must NOT, and — where the posting map gives a formula — by how much. Tests
 * read it through `expectPostingsMatchRule` (repositories/testHelpers/
 * postingAssert.ts), so the expected numbers live in ONE place instead of in
 * hand-written lambdas per test (CLAUDE.md rules 14 and 24).
 *
 * This is a TEST/GUARD layer. Production code does not read it, and it is
 * deliberately NOT re-exported from `constants/index.ts`: it must stay a pure
 * leaf (rule 29 — its only import is a type) and out of the shipped surface.
 *
 * Shape:
 *   - every rule names ALL FOUR snapshot ledgers (drawers, supplier, partner,
 *     debt). Each entry is `post` (with its lines), `none` (must not move at
 *     all), or `unchecked` (with the reason the table does not yet pin it).
 *     "Forgot to say" is not representable — a new rule has to decide.
 *   - a line names a ROLE ("providerSupplier", "partner", "pcd", …), never a
 *     concrete id or drawer name; the test maps roles to keys.
 *   - amounts are functions of `PostingInputs` (x, f, c …), signed in each
 *     ledger's own convention (POSTING_MAP.md §2):
 *       drawers  > 0 = money into the drawer
 *       supplier > 0 = shop owes the supplier
 *       partner  > 0 = partner owes the shop (Σ DEBIT − Σ CREDIT)
 *       debt     > 0 = client owes the shop
 *
 * A transaction type with no rule must sit in `POSTING_RULE_EXCLUSIONS` with
 * a reason — `constants/__tests__/postingRules.guard.test.ts` fails CI for a
 * type in neither.
 */
import type { TransactionType } from "./transactionTypes.js";

/** The four ledgers `snapshotLedgers` measures. Mirrors postingAssert's `LedgerName`. */
export type PostingLedger = "drawers" | "supplier" | "partner" | "debt";

/** Money facts a rule's amount functions read. Unused fields are 0 / absent. */
export interface PostingInputs {
  /** Principal / face value (`x` in POSTING_MAP.md), in `currency`. */
  x: number;
  /** Customer-facing provider fee (`f`), in `currency`. 0 for a RECEIVE. */
  f: number;
  /** Shop commission (`c`) — e.g. the Loto retailer cut. */
  c: number;
  /** The transaction's own currency (the currency of `x`). */
  currency: string;
  /**
   * MTC/Alfa credit stock (USD) the carrier drawer gives up or gains —
   * face value of a credit sale, the DAYS cost, the credits bought back or
   * self-charged, a line edit's delta. Recharge & carrier rules only (§4.3).
   */
  carrierUsd?: number;
  /** SMS transfer fee (USD) a CREDIT_TRANSFER books as its auto expense. */
  smsUsd?: number;
  /**
   * Payout kept change (owner decisions 2026-10-07, FEATURE_GUIDE §4.1): the
   * shop owes the customer a payout, hands out a round figure a little
   * short and keeps the leftover as profit — in the payout (transaction)
   * currency. Payout rules only. Absent = 0, the exact payout, so a test
   * that does not pass it asserts exactly what it asserted before.
   */
  kept?: number;
  /**
   * Change a vendor handed BACK into the drawer on a manual expense (an OUT
   * leg on the same EXPENSE transaction), in the transaction currency.
   * EXPENSE rule only. Absent = 0 (paid exactly).
   */
  returned?: number;
}

/** `kept` with its documented default (0 = the exact payout). */
const keptOf = (i: PostingInputs): number => i.kept ?? 0;

/**
 * Reads an optional input a rule depends on. Throws instead of defaulting to
 * 0, so a test that forgets to pass it fails loudly rather than asserting a
 * smaller posting by accident.
 */
function need(v: number | undefined, name: keyof PostingInputs): number {
  if (v === undefined) {
    throw new Error(`posting rule needs input "${String(name)}"`);
  }
  return v;
}

/** Who a posting lands on. The test resolves each role to a ledger key. */
export type DrawerRole =
  /** Primary Cash Drawer: OMT_System / Whish_System, whichever is the base system. */
  | "pcd"
  /** The General drawer (physical till). */
  | "general"
  /** The drawer the customer's tender legs land in (test supplies it). */
  | "tender"
  /** The MTC or Alfa drawer (always USD credit stock). */
  | "carrier"
  /** A provider's own drawer — OMT_App, Whish_App, iPick, Katsh: the
   *  destination of a top-up, the source of a cash-out or a self-charge. */
  | "wallet"
  /** The drawer the operator picked to fund a drawer-to-drawer top-up. */
  | "source"
  /** The drawer a drawer-to-drawer transfer pays INTO (its `toDrawer`). */
  | "destination"
  /** The drawer a checkpoint counted (reconciled to its physical count). */
  | "counted";
export type SupplierRole =
  /** The supplier row the operation targets: the provider's own row (OMT,
   *  WHISH, LOTO …) on module flows, or the supplier the operator picked on
   *  the Suppliers page (payment, adjustment, settlement, stock intake). */
  "providerSupplier";
export type PartnerRole = "partner";
export type DebtRole = "client";

/** Currency of a line: the transaction's own, or a fixed one. */
export type PostingCurrency = "txn" | "USD" | "LBP";

export type PostingAmount = (i: PostingInputs) => number;

export interface PostingLine<R extends string> {
  role: R;
  currency: PostingCurrency;
  amount: PostingAmount;
}

export type LedgerExpectation<R extends string> =
  | { post: "post"; lines: readonly PostingLine<R>[] }
  | { post: "none" }
  | { post: "unchecked"; reason: string };

export interface PostingLedgers {
  drawers: LedgerExpectation<DrawerRole>;
  supplier: LedgerExpectation<SupplierRole>;
  partner: LedgerExpectation<PartnerRole>;
  debt: LedgerExpectation<DebtRole>;
}

/**
 * A figure a rule pins OUTSIDE the four snapshot ledgers (a profit stamp, a
 * stored expense amount). Same shape as a ledger line minus the role: tests
 * check it beside `expectPostingsMatchRule` via {@link stampAmount}.
 */
export interface PostingStampLine {
  currency: PostingCurrency;
  amount: PostingAmount;
}

export interface PostingRule {
  transactionType: TransactionType;
  /** Human label of the mode, e.g. "walk-in SEND", "FOR partner RECEIVE". */
  mode: string;
  /** Where in POSTING_MAP.md this row comes from. */
  mapRef: string;
  ledgers: PostingLedgers;
  /**
   * Payout rules: what the kept change adds to the transaction's own profit
   * stamp, compared with the same payout handed out exactly (the rest of the
   * stamp — commission, fee, credits spread — is the rule's business, not
   * this line's).
   */
  keptProfit?: PostingStampLine;
  /** EXPENSE rules: the stored expense amount (`expenses.amount_*`), i.e.
   *  the cost Profits and the day close sum. */
  expenseAmount?: PostingStampLine;
  notes?: string;
}

/**
 * The per-currency value of a {@link PostingStampLine} for these inputs,
 * keyed "USD"/"LBP"/… (a `txn` line resolves to `inputs.currency`).
 */
export function stampAmount(
  line: PostingStampLine,
  inputs: PostingInputs,
): Record<string, number> {
  const currency = line.currency === "txn" ? inputs.currency : line.currency;
  return { [currency]: Math.round(line.amount(inputs) * 1e6) / 1e6 };
}

/** Payout kept change lands in the profit stamp, payout currency (§4.1). */
const KEPT_PROFIT = {
  currency: "txn",
  amount: keptOf,
} as const satisfies PostingStampLine;

const PAYOUT_NO_OUT_LEGS_NOTE =
  "A payout never carries change (OUT) legs: an OUT leg on a non-catalog " +
  "RECEIVE is refused before anything is written (POSTING_MAP G43; " +
  "FinancialServiceRepository.receiveKeptChange.test.ts).";

const NONE = { post: "none" } as const;

// ─── OMT / WHISH system transfers — POSTING_MAP.md §4.1 ─────────────────────
// Supplier amounts are `grossOwedDelta`: SEND +(x+f), RECEIVE −x (the
// commission is entered later, at settlement). Partner amounts follow D1/D7:
// FOR = x+f (SEND, DEBIT) / x (RECEIVE, CREDIT); THROUGH = |x| only.

const sendGross: PostingAmount = (i) => i.x + i.f;
const receiveGross: PostingAmount = (i) => -i.x;

const SYSTEM_SEND_SUPPLIER = {
  post: "post",
  lines: [{ role: "providerSupplier", currency: "txn", amount: sendGross }],
} as const satisfies LedgerExpectation<SupplierRole>;

const SYSTEM_RECEIVE_SUPPLIER = {
  post: "post",
  lines: [{ role: "providerSupplier", currency: "txn", amount: receiveGross }],
} as const satisfies LedgerExpectation<SupplierRole>;

/** Cash SEND: the customer pays x + f into the PCD (payment-method fee 0). */
const CASH_SEND_PCD = {
  post: "post",
  lines: [{ role: "pcd", currency: "txn", amount: sendGross }],
} as const satisfies LedgerExpectation<DrawerRole>;

/** Cash RECEIVE: the PCD pays out x, less any kept change (§4.1). */
const CASH_RECEIVE_PCD = {
  post: "post",
  lines: [{ role: "pcd", currency: "txn", amount: (i) => -(i.x - keptOf(i)) }],
} as const satisfies LedgerExpectation<DrawerRole>;

const FS_SYSTEM_RULES = {
  "FS_SYSTEM/SEND/walk-in": {
    transactionType: "FINANCIAL_SERVICE",
    mode: "OMT/WHISH walk-in SEND, cash",
    mapRef: "POSTING_MAP.md §4.1 Walk-in SEND",
    ledgers: {
      drawers: CASH_SEND_PCD,
      supplier: SYSTEM_SEND_SUPPLIER,
      partner: NONE,
      debt: NONE,
    },
  },
  "FS_SYSTEM/RECEIVE/walk-in": {
    transactionType: "FINANCIAL_SERVICE",
    mode: "OMT/WHISH walk-in RECEIVE, cash payout",
    mapRef: "POSTING_MAP.md §4.1 Walk-in RECEIVE, cash",
    ledgers: {
      // Kept change: the PCD pays out x − kept; the supplier still credits
      // the full x (the provider owes the shop the whole transfer).
      drawers: CASH_RECEIVE_PCD,
      supplier: SYSTEM_RECEIVE_SUPPLIER,
      partner: NONE,
      debt: NONE,
    },
    keptProfit: KEPT_PROFIT,
    notes: PAYOUT_NO_OUT_LEGS_NOTE,
  },
  "FS_SYSTEM/SEND/THROUGH-base": {
    transactionType: "FINANCIAL_SERVICE",
    mode: "OMT/WHISH THROUGH partner on the base system, SEND",
    mapRef: "POSTING_MAP.md §4.1 THROUGH partner, base system",
    ledgers: {
      drawers: CASH_SEND_PCD,
      supplier: SYSTEM_SEND_SUPPLIER,
      // THROUGH SEND = CREDIT |x| → shop owes the partner x (D7: fee is the shop's).
      partner: {
        post: "post",
        lines: [{ role: "partner", currency: "txn", amount: (i) => -i.x }],
      },
      debt: NONE,
    },
  },
  "FS_SYSTEM/RECEIVE/THROUGH-base": {
    transactionType: "FINANCIAL_SERVICE",
    mode: "OMT/WHISH THROUGH partner on the base system, RECEIVE",
    mapRef: "POSTING_MAP.md §4.1 THROUGH partner, base system",
    ledgers: {
      drawers: CASH_RECEIVE_PCD,
      supplier: SYSTEM_RECEIVE_SUPPLIER,
      // THROUGH RECEIVE = DEBIT |x| → partner owes the shop x.
      partner: {
        post: "post",
        lines: [{ role: "partner", currency: "txn", amount: (i) => i.x }],
      },
      debt: NONE,
    },
  },
  "FS_SYSTEM/SEND/THROUGH-secondary": {
    transactionType: "FINANCIAL_SERVICE",
    mode: "OMT/WHISH THROUGH partner on the secondary system, SEND",
    mapRef: "POSTING_MAP.md §4.1 THROUGH partner, secondary system",
    ledgers: {
      // Cash lands in General, not the (other provider's) PCD.
      drawers: {
        post: "post",
        lines: [{ role: "general", currency: "txn", amount: sendGross }],
      },
      // By design: the partner carries it (skipSecondarySupplierLedger).
      supplier: NONE,
      partner: {
        post: "post",
        lines: [{ role: "partner", currency: "txn", amount: (i) => -i.x }],
      },
      debt: NONE,
    },
  },
  "FS_SYSTEM/SEND/FOR": {
    transactionType: "FINANCIAL_SERVICE",
    mode: "OMT/WHISH FOR partner SEND",
    mapRef: "POSTING_MAP.md §4.1 FOR partner SEND (D1)",
    ledgers: {
      // Obligations only — no drawer moves (FEATURE_GUIDE §8.1.0).
      drawers: NONE,
      supplier: SYSTEM_SEND_SUPPLIER,
      partner: {
        post: "post",
        lines: [{ role: "partner", currency: "txn", amount: sendGross }],
      },
      debt: NONE,
    },
  },
  "FS_SYSTEM/RECEIVE/FOR": {
    transactionType: "FINANCIAL_SERVICE",
    mode: "OMT/WHISH FOR partner RECEIVE",
    mapRef: "POSTING_MAP.md §4.1 FOR partner RECEIVE",
    ledgers: {
      drawers: NONE,
      supplier: SYSTEM_RECEIVE_SUPPLIER,
      // FOR RECEIVE = CREDIT x → shop owes the partner x.
      partner: {
        post: "post",
        lines: [{ role: "partner", currency: "txn", amount: (i) => -i.x }],
      },
      debt: NONE,
    },
  },
  "FS_SYSTEM/SEND/basket": {
    transactionType: "FINANCIAL_SERVICE",
    mode: "OMT/WHISH SEND inside a session basket (deferPayment)",
    mapRef: "POSTING_MAP.md §4.1 Session basket",
    ledgers: {
      // The basket posts pooled legs at checkout, not this repository call.
      drawers: NONE,
      // Still booked at creation.
      supplier: SYSTEM_SEND_SUPPLIER,
      partner: NONE,
      // `Session Debt` is written later by the session checkout, not here.
      debt: NONE,
    },
  },
} as const satisfies Record<string, PostingRule>;

// ─── Loto tickets — POSTING_MAP.md §4.4 ─────────────────────────────────────
// The LOTO supplier is owed `sale − commission` in LBP in EVERY mode (incl.
// FOR and basket); the ticket is natively LBP.

const LOTO_SUPPLIER = {
  post: "post",
  lines: [
    { role: "providerSupplier", currency: "LBP", amount: (i) => i.x - i.c },
  ],
} as const satisfies LedgerExpectation<SupplierRole>;

const LOTO_RULES = {
  "LOTO/ticket/walk-in": {
    transactionType: "LOTO",
    mode: "Loto ticket, walk-in, paid in full into a drawer",
    mapRef: "POSTING_MAP.md §4.4 Ticket sale",
    ledgers: {
      drawers: {
        post: "post",
        lines: [{ role: "tender", currency: "txn", amount: (i) => i.x }],
      },
      supplier: LOTO_SUPPLIER,
      partner: NONE,
      debt: NONE,
    },
  },
  "LOTO/ticket/account": {
    transactionType: "LOTO",
    mode: "Loto ticket charged to the customer account",
    mapRef: "POSTING_MAP.md §4.4 Ticket sale (CA legs → Loto Debt)",
    ledgers: {
      drawers: NONE,
      supplier: LOTO_SUPPLIER,
      debt: {
        post: "post",
        lines: [{ role: "client", currency: "txn", amount: (i) => i.x }],
      },
      partner: NONE,
    },
  },
  "LOTO/ticket/FOR": {
    transactionType: "LOTO",
    mode: "Loto ticket FOR partner",
    mapRef: "POSTING_MAP.md §4.4 Ticket sale (FOR: FOR_LOTO DEBIT = sale)",
    ledgers: {
      drawers: NONE,
      supplier: LOTO_SUPPLIER,
      partner: {
        post: "post",
        lines: [{ role: "partner", currency: "LBP", amount: (i) => i.x }],
      },
      debt: NONE,
    },
  },
} as const satisfies Record<string, PostingRule>;

// ─── MTC / Alfa recharge, carrier lines, provider top-ups — POSTING_MAP.md
//     §4.3 (and the top-up / self-charge / cash-out rows of §4.2) ─────────
// Carrier lines (`carrier_lines`) are not one of the four snapshot ledgers;
// the tests check the line credits directly next to these rules.

/** Credit sale: the carrier drawer gives up face value + the SMS fee (the
 *  fee leaves through the auto `SMS_Transfer_Fee` expense, same drawer). */
const CARRIER_SALE_STOCK = {
  role: "carrier",
  currency: "USD",
  amount: (i) => -(need(i.carrierUsd, "carrierUsd") + need(i.smsUsd, "smsUsd")),
} as const satisfies PostingLine<DrawerRole>;

/** Credits coming INTO the carrier drawer (buy-back, self-charge, line edit). */
const CARRIER_GAIN = {
  role: "carrier",
  currency: "USD",
  amount: (i) => need(i.carrierUsd, "carrierUsd"),
} as const satisfies PostingLine<DrawerRole>;

const TENDER_IN = {
  role: "tender",
  currency: "txn",
  amount: (i) => i.x,
} as const satisfies PostingLine<DrawerRole>;

const RECHARGE_RULES = {
  "RECHARGE/sale/walk-in": {
    transactionType: "RECHARGE",
    mode: "MTC/Alfa credit sale, walk-in, paid in full into a drawer",
    mapRef: "POSTING_MAP.md §4.3 Recharge sale",
    ledgers: {
      drawers: { post: "post", lines: [TENDER_IN, CARRIER_SALE_STOCK] },
      // Prepaid stock: no supplier posting.
      supplier: NONE,
      partner: NONE,
      debt: NONE,
    },
  },
  "RECHARGE/sale/account": {
    transactionType: "RECHARGE",
    mode: "MTC/Alfa credit sale charged to the customer account",
    mapRef:
      "POSTING_MAP.md §4.3 Recharge sale (non-drawer legs → Recharge Debt)",
    ledgers: {
      drawers: { post: "post", lines: [CARRIER_SALE_STOCK] },
      supplier: NONE,
      partner: NONE,
      debt: {
        post: "post",
        lines: [{ role: "client", currency: "txn", amount: (i) => i.x }],
      },
    },
  },
  "RECHARGE/sale/FOR": {
    transactionType: "RECHARGE",
    mode: "MTC/Alfa credit sale FOR partner",
    mapRef: "POSTING_MAP.md §4.3 FOR partner (FOR_RECHARGE DEBIT = price)",
    ledgers: {
      drawers: { post: "post", lines: [CARRIER_SALE_STOCK] },
      supplier: NONE,
      partner: {
        post: "post",
        lines: [{ role: "partner", currency: "txn", amount: (i) => i.x }],
      },
      debt: NONE,
    },
  },
  "RECHARGE/sale/basket": {
    transactionType: "RECHARGE",
    mode: "MTC/Alfa credit sale inside a session basket (deferPayment)",
    mapRef: "POSTING_MAP.md §4.3 Session basket",
    ledgers: {
      // Only the stock leg + SMS expense; the basket posts the tender and
      // any `Session Debt` at checkout, not this repository call.
      drawers: { post: "post", lines: [CARRIER_SALE_STOCK] },
      supplier: NONE,
      partner: NONE,
      debt: NONE,
    },
  },
  "RECHARGE/DAYS/walk-in": {
    transactionType: "RECHARGE",
    mode: "MTC/Alfa DAYS sale, walk-in",
    mapRef: "POSTING_MAP.md §4.3 DAYS sale",
    ledgers: {
      // The carrier drawer gives up the days COST (USD), never the day
      // count; no SMS fee on DAYS.
      drawers: {
        post: "post",
        lines: [
          TENDER_IN,
          {
            role: "carrier",
            currency: "USD",
            amount: (i) => -need(i.carrierUsd, "carrierUsd"),
          },
        ],
      },
      supplier: NONE,
      partner: NONE,
      debt: NONE,
    },
  },
} as const satisfies Record<string, PostingRule>;

const TELECOM_RULES = {
  "TELECOM_CREDIT_BUYBACK/cash": {
    transactionType: "TELECOM_CREDIT_BUYBACK",
    mode: "Shop-line credit buy-back, paid out in cash",
    mapRef: "POSTING_MAP.md §4.3 Credit buy-back",
    ledgers: {
      // x = what the shop owes for the credits (the buy-back price); the
      // customer is handed x − kept (payout kept change, §4.1).
      drawers: {
        post: "post",
        lines: [
          {
            role: "tender",
            currency: "txn",
            amount: (i) => -(i.x - keptOf(i)),
          },
          CARRIER_GAIN,
        ],
      },
      supplier: NONE,
      partner: NONE,
      debt: NONE,
    },
    keptProfit: KEPT_PROFIT,
    notes:
      "Assumes the carrier drawer already equals Σ active line credits. " +
      "If it has drifted, a separate `<drawer>_LINE_DRIFT` correction leg " +
      "also posts on this transaction (by design, owner report #10). " +
      "Profit stays credits − owed, plus kept.",
  },
  "TELECOM_CREDIT_BUYBACK/account": {
    transactionType: "TELECOM_CREDIT_BUYBACK",
    mode: "Shop-line credit buy-back, paid out to the customer account",
    mapRef: "POSTING_MAP.md §4.3 Credit buy-back (CA payout → CREDIT_DEPOSIT)",
    ledgers: {
      drawers: { post: "post", lines: [CARRIER_GAIN] },
      supplier: NONE,
      partner: NONE,
      debt: {
        post: "post",
        lines: [{ role: "client", currency: "txn", amount: (i) => -i.x }],
      },
    },
  },
  "TELECOM_SELF_CHARGE/catalog": {
    transactionType: "TELECOM_SELF_CHARGE",
    mode: "iPick/Katsh telecom item charged to the shop's own line",
    mapRef: "POSTING_MAP.md §4.2 selfChargeTelecomItem",
    ledgers: {
      // x = the item's cost_lbp (currency LBP); carrierUsd = its credits.
      drawers: {
        post: "post",
        lines: [
          { role: "wallet", currency: "txn", amount: (i) => -i.x },
          CARRIER_GAIN,
        ],
      },
      // No supplier booking for the cost leg — owner confirmed 2026-10-07:
      // the supplier debt was already booked when the wallet was loaded.
      supplier: NONE,
      partner: NONE,
      debt: NONE,
    },
  },
  "CARRIER_LINE_ADJUSTMENT/manual": {
    transactionType: "CARRIER_LINE_ADJUSTMENT",
    mode: "Shop line created / edited / toggled / archived by hand",
    mapRef: "POSTING_MAP.md §4.3 Line create / edit / toggle / archive",
    ledgers: {
      // carrierUsd = the signed credits delta of the edit.
      drawers: { post: "post", lines: [CARRIER_GAIN] },
      supplier: NONE,
      partner: NONE,
      debt: NONE,
    },
    notes:
      "NON_REVERSIBLE: corrected by a new, opposite edit (its own " +
      "adjustment), never by a void.",
  },
} as const satisfies Record<string, PostingRule>;

const WALLET_IN = {
  role: "wallet",
  currency: "txn",
  amount: (i) => i.x,
} as const satisfies PostingLine<DrawerRole>;

const TOPUP_RULES = {
  "RECHARGE_TOPUP/app": {
    transactionType: "RECHARGE_TOPUP",
    mode: "Provider wallet top-up from another drawer (topUpApp)",
    mapRef: "POSTING_MAP.md §4.3 Drawer top-up (topUpApp)",
    ledgers: {
      drawers: {
        post: "post",
        lines: [
          { role: "source", currency: "txn", amount: (i) => -i.x },
          WALLET_IN,
        ],
      },
      supplier: NONE,
      partner: NONE,
      debt: NONE,
    },
    notes: "MTC/Alfa are refused as targets since LIRA-258 G15.",
  },
  "RECHARGE_TOPUP/supplier": {
    transactionType: "RECHARGE_TOPUP",
    mode: "iPick/Katsh/OMT App wallet top-up on supplier credit",
    mapRef: "POSTING_MAP.md §4.2 Top-up from supplier",
    ledgers: {
      drawers: { post: "post", lines: [WALLET_IN] },
      // TOP_UP +x on the provider's own supplier row (shop owes it more).
      supplier: {
        post: "post",
        lines: [
          { role: "providerSupplier", currency: "txn", amount: (i) => i.x },
        ],
      },
      partner: NONE,
      debt: NONE,
    },
  },
  "RECHARGE_TOPUP/partner": {
    transactionType: "RECHARGE_TOPUP",
    mode: "Whish App top-up funded by a partner",
    mapRef: "POSTING_MAP.md §4.6 Whish App top-up via partner",
    ledgers: {
      drawers: { post: "post", lines: [WALLET_IN] },
      supplier: NONE,
      // WHISH_TOPUP CREDIT x → shop owes the partner x.
      partner: {
        post: "post",
        lines: [{ role: "partner", currency: "txn", amount: (i) => -i.x }],
      },
      debt: NONE,
    },
  },
  "RECHARGE_TOPUP/client": {
    transactionType: "RECHARGE_TOPUP",
    mode: "Whish App credits bought from a client, paid out in cash",
    mapRef: "RechargeRepository.topUpFromClient (no POSTING_MAP row yet)",
    ledgers: {
      // x = credits received, f = the shop's fee: the client is owed x − f
      // and handed x − f − kept (payout kept change, §4.1).
      drawers: {
        post: "post",
        lines: [
          {
            role: "tender",
            currency: "txn",
            amount: (i) => -(i.x - i.f - keptOf(i)),
          },
          WALLET_IN,
        ],
      },
      supplier: NONE,
      partner: NONE,
      debt: NONE,
    },
    keptProfit: KEPT_PROFIT,
    notes: "Profit = the fee f, plus kept.",
  },
  "WALLET_CASHOUT/OMT_APP": {
    transactionType: "WALLET_CASHOUT",
    mode: "Cash Out to OMT from the OMT App wallet",
    mapRef: "POSTING_MAP.md §4.2 OMT App cashout to supplier",
    ledgers: {
      drawers: {
        post: "post",
        lines: [{ role: "wallet", currency: "txn", amount: (i) => -i.x }],
      },
      // PAYMENT −(x + c) on 'OMT App': OMT now owes the shop principal +
      // commission (c = omtAppCashoutCommission, recognised at settlement).
      supplier: {
        post: "post",
        lines: [
          {
            role: "providerSupplier",
            currency: "txn",
            amount: (i) => -(i.x + i.c),
          },
        ],
      },
      partner: NONE,
      debt: NONE,
    },
  },
} as const satisfies Record<string, PostingRule>;

// ─── Drawers — POSTING_MAP.md §4.6 (cash-out) and §4.7 (top-up / transfer /
//     checkpoint) ──────────────────────────────────────────────────────────
// One currency per rule (`txn`); a USD + LBP call is the sum of two rules.
// `x` > 0 for every drawer rule except CHECKPOINT, where it is the signed
// reconciliation delta (physical count − live balance).

const DRAWER_RULES = {
  "DRAWER_TRANSFER/between-drawers": {
    transactionType: "DRAWER_TRANSFER",
    mode: "Cash moved between two of the shop's own drawers (transferBetweenDrawers)",
    mapRef: "POSTING_MAP.md §4.7 Drawer top-up / transfer",
    ledgers: {
      drawers: {
        post: "post",
        lines: [
          { role: "source", currency: "txn", amount: (i) => -i.x },
          { role: "destination", currency: "txn", amount: (i) => i.x },
        ],
      },
      supplier: NONE,
      partner: NONE,
      debt: NONE,
    },
  },
  "DRAWER_TOPUP/external": {
    transactionType: "DRAWER_TOPUP",
    mode: "External cash-in to General (createTopUp)",
    mapRef: "POSTING_MAP.md §4.7 Drawer top-up, external",
    ledgers: {
      drawers: {
        post: "post",
        lines: [{ role: "general", currency: "txn", amount: (i) => i.x }],
      },
      supplier: NONE,
      partner: NONE,
      debt: NONE,
    },
    notes:
      "NON_REVERSIBLE: corrected by a Cash Out of the same amount " +
      "(DrawerCashoutRepository names itself DRAWER_TOPUP's reversal owner). " +
      "Extra (non-USD/LBP) currencies and their exchange lots are not encoded.",
  },
  "DRAWER_TOPUP/from-drawer": {
    transactionType: "DRAWER_TOPUP",
    mode: "Top-up of General from another named drawer (createTopUpFromDrawer)",
    mapRef: "POSTING_MAP.md §4.7 Drawer top-up, from a drawer (G9 / G33)",
    ledgers: {
      drawers: {
        post: "post",
        lines: [
          { role: "source", currency: "txn", amount: (i) => -i.x },
          { role: "general", currency: "txn", amount: (i) => i.x },
        ],
      },
      supplier: NONE,
      partner: NONE,
      debt: NONE,
    },
    notes:
      "NON_REVERSIBLE (rows from before G9 lack the source leg). No code " +
      "names its correction; the tests use a reverse transferBetweenDrawers " +
      "— an assumption, not a recorded owner decision.",
  },
  "DRAWER_CASHOUT/general": {
    transactionType: "DRAWER_CASHOUT",
    mode: "Cash taken out of General (createCashout)",
    mapRef: "POSTING_MAP.md §4.6 Drawer cashout",
    ledgers: {
      drawers: {
        post: "post",
        lines: [{ role: "general", currency: "txn", amount: (i) => -i.x }],
      },
      supplier: NONE,
      partner: NONE,
      debt: NONE,
    },
    notes:
      "NON_REVERSIBLE. Refused (writes nothing) when General holds less than " +
      "x. The tests correct it with an external top-up — the mirror of the " +
      "documented top-up → cash-out owner, not itself documented.",
  },
  "CHECKPOINT/count": {
    transactionType: "CHECKPOINT",
    mode: "Checkpoint of a non-carrier drawer: book balance set to the count",
    mapRef: "POSTING_MAP.md §4.7 Daily checkpoint",
    ledgers: {
      // x = physical − live balance (signed); a zero delta posts nothing.
      drawers: {
        post: "post",
        lines: [{ role: "counted", currency: "txn", amount: (i) => i.x }],
      },
      supplier: NONE,
      partner: NONE,
      debt: NONE,
    },
    notes:
      "NON_REVERSIBLE: corrected by a later checkpoint. MTC/Alfa " +
      "checkpoints (drawer follows counted line credits) are not encoded here.",
  },
} as const satisfies Record<string, PostingRule>;

// ─── Suppliers — POSTING_MAP.md §4.7 (manual operator actions; the hidden
//     auto SUPPLIER_PAYMENT siblings are covered by each parent's rule) ────

const SUPPLIER_DOWN = {
  post: "post",
  lines: [{ role: "providerSupplier", currency: "txn", amount: (i) => -i.x }],
} as const satisfies LedgerExpectation<SupplierRole>;

const SUPPLIER_UP = {
  post: "post",
  lines: [{ role: "providerSupplier", currency: "txn", amount: (i) => i.x }],
} as const satisfies LedgerExpectation<SupplierRole>;

const SUPPLIER_RULES = {
  "SUPPLIER_PAYMENT/pay": {
    transactionType: "SUPPLIER_PAYMENT",
    mode: "Supplier paid down in cash (recordSupplierCashflow PAY)",
    mapRef: "POSTING_MAP.md §4.7 Supplier pay / receive cash",
    ledgers: {
      // tender = resolveServiceCashDrawer: the PCD for a CASH leg paying the
      // shop's base-system supplier, the method's own drawer otherwise.
      drawers: {
        post: "post",
        lines: [{ role: "tender", currency: "txn", amount: (i) => -i.x }],
      },
      supplier: SUPPLIER_DOWN,
      partner: NONE,
      debt: NONE,
    },
    notes:
      "SUPPLIER_PAYMENT has two kinds: this manual payment, and the hidden " +
      "auto sibling (rule 26) behind every auto supplier posting, whose " +
      "movement is asserted by the PARENT rule's supplier line. A bundled " +
      "discount posts its own COUNTERPARTY_DISCOUNT/supplier on top.",
  },
  "SUPPLIER_PAYMENT/receive": {
    transactionType: "SUPPLIER_PAYMENT",
    mode: "Supplier pays the shop in cash (recordSupplierCashflow RECEIVE)",
    mapRef: "POSTING_MAP.md §4.7 Supplier pay / receive cash",
    ledgers: {
      drawers: {
        post: "post",
        lines: [{ role: "tender", currency: "txn", amount: (i) => i.x }],
      },
      // SUPPLIER_PAYS_US +x (their debt to the shop is settled).
      supplier: SUPPLIER_UP,
      partner: NONE,
      debt: NONE,
    },
  },
  "SUPPLIER_PAYMENT/manual-drawer": {
    transactionType: "SUPPLIER_PAYMENT",
    mode: "Manual supplier PAYMENT entry naming a drawer (addLedgerEntry)",
    mapRef: "POSTING_MAP.md §4.7 Manual supplier entry with drawer (G8)",
    ledgers: {
      drawers: {
        post: "post",
        lines: [{ role: "source", currency: "txn", amount: (i) => -i.x }],
      },
      supplier: SUPPLIER_DOWN,
      partner: NONE,
      debt: NONE,
    },
  },
  "SUPPLIER_ADJUSTMENT/paper": {
    transactionType: "SUPPLIER_ADJUSTMENT",
    mode: "Paper supplier credit / debit, no cash (addLedgerEntry ADJUSTMENT)",
    mapRef: "POSTING_MAP.md §4.7 Supplier paper adjustment",
    ledgers: {
      drawers: NONE,
      // x signed: + = shop owes the supplier more, − = owes less.
      supplier: SUPPLIER_UP,
      partner: NONE,
      debt: NONE,
    },
    notes: "NON_REVERSIBLE: corrected by an opposite adjustment.",
  },
  "SUPPLIER_STOCK_INTAKE/receive": {
    transactionType: "SUPPLIER_STOCK_INTAKE",
    mode: "Stock received from a supplier on credit (ProductRepository.receiveStock)",
    mapRef: "POSTING_MAP.md §4.7 Supplier stock intake",
    ledgers: {
      drawers: NONE,
      // x = round(qty × unit cost, 2), always USD.
      supplier: {
        post: "post",
        lines: [
          { role: "providerSupplier", currency: "USD", amount: (i) => i.x },
        ],
      },
      partner: NONE,
      debt: NONE,
    },
    notes:
      "Also raises products.stock_quantity and writes a cost batch; the " +
      "void takes both back (refused once units from the batch sold).",
  },
  "SUPPLIER_RECORDED_DEBT/open": {
    transactionType: "SUPPLIER_RECORDED_DEBT",
    mode: "Supplier debt recorded without products (recordDebt)",
    mapRef: "POSTING_MAP.md §4.7 Supplier recorded debt",
    ledgers: {
      drawers: NONE,
      supplier: SUPPLIER_UP,
      partner: NONE,
      debt: NONE,
    },
  },
  "SUPPLIER_SETTLEMENT/system-model1": {
    transactionType: "SUPPLIER_SETTLEMENT",
    mode: "OMT/WHISH per-supplier settlement, non-bills, commission model 1",
    mapRef: "POSTING_MAP.md §4.7 Supplier settle (+ commission, non-bills)",
    ledgers: {
      // x = net paid (legs), c = commission entered at settlement.
      drawers: {
        post: "post",
        lines: [{ role: "tender", currency: "txn", amount: (i) => -i.x }],
      },
      // SETTLEMENT −x, plus the hidden SUPPLIER_PAYS_US −c sibling.
      supplier: {
        post: "post",
        lines: [
          {
            role: "providerSupplier",
            currency: "txn",
            amount: (i) => -(i.x + i.c),
          },
        ],
      },
      partner: NONE,
      debt: NONE,
    },
  },
} as const satisfies Record<string, PostingRule>;

// ─── Partners — POSTING_MAP.md §4.7 ─────────────────────────────────────────
// Partner balance > 0 = partner owes the shop. A settlement's direction is
// derived from that balance's sign; Add Credit / Debt's from the operator.

const PARTNER_RULES = {
  "PARTNER_SETTLEMENT/partner-owes": {
    transactionType: "PARTNER_SETTLEMENT",
    mode: "Partner settles what it owes the shop, cash in",
    mapRef: "POSTING_MAP.md §4.7 Partner settle",
    ledgers: {
      drawers: {
        post: "post",
        lines: [{ role: "tender", currency: "txn", amount: (i) => i.x }],
      },
      supplier: NONE,
      // SETTLEMENT CREDIT x.
      partner: {
        post: "post",
        lines: [{ role: "partner", currency: "txn", amount: (i) => -i.x }],
      },
      debt: NONE,
    },
    notes:
      "A bundled discount posts its own COUNTERPARTY_DISCOUNT/partner-forgiven " +
      "on top; voiding the settlement reverses both.",
  },
  "PARTNER_SETTLEMENT/shop-owes": {
    transactionType: "PARTNER_SETTLEMENT",
    mode: "Shop settles what it owes the partner, cash out",
    mapRef: "POSTING_MAP.md §4.7 Partner settle",
    ledgers: {
      drawers: {
        post: "post",
        lines: [{ role: "tender", currency: "txn", amount: (i) => -i.x }],
      },
      supplier: NONE,
      // SETTLEMENT DEBIT x.
      partner: {
        post: "post",
        lines: [{ role: "partner", currency: "txn", amount: (i) => i.x }],
      },
      debt: NONE,
    },
  },
  "PARTNER_SETTLEMENT/client-account": {
    transactionType: "PARTNER_SETTLEMENT",
    mode: "Paper settlement of what the partner owes (method CLIENT_ACCOUNT)",
    mapRef: "POSTING_MAP.md §4.7 Partner settle",
    ledgers: {
      drawers: NONE,
      supplier: NONE,
      partner: {
        post: "post",
        lines: [{ role: "partner", currency: "txn", amount: (i) => -i.x }],
      },
      debt: NONE,
    },
  },
  "PARTNER_PAYMENT/add-debt": {
    transactionType: "PARTNER_PAYMENT",
    mode: "Add Debt with cash moved: shop hands the partner cash",
    mapRef: "POSTING_MAP.md §4.7 Partner Add Credit / Debt",
    ledgers: {
      drawers: {
        post: "post",
        lines: [{ role: "tender", currency: "txn", amount: (i) => -i.x }],
      },
      supplier: NONE,
      partner: {
        post: "post",
        lines: [{ role: "partner", currency: "txn", amount: (i) => i.x }],
      },
      debt: NONE,
    },
  },
  "PARTNER_PAYMENT/add-credit": {
    transactionType: "PARTNER_PAYMENT",
    mode: "Add Credit with cash moved: partner hands the shop cash",
    mapRef: "POSTING_MAP.md §4.7 Partner Add Credit / Debt",
    ledgers: {
      drawers: {
        post: "post",
        lines: [{ role: "tender", currency: "txn", amount: (i) => i.x }],
      },
      supplier: NONE,
      partner: {
        post: "post",
        lines: [{ role: "partner", currency: "txn", amount: (i) => -i.x }],
      },
      debt: NONE,
    },
  },
  "PARTNER_ADJUSTMENT/paper": {
    transactionType: "PARTNER_ADJUSTMENT",
    mode: "Add Credit / Debt without cash (paper entry)",
    mapRef: "POSTING_MAP.md §4.7 Partner Add Credit / Debt",
    ledgers: {
      drawers: NONE,
      supplier: NONE,
      // x signed: DEBIT = +x (partner owes more), CREDIT = −x.
      partner: {
        post: "post",
        lines: [{ role: "partner", currency: "txn", amount: (i) => i.x }],
      },
      debt: NONE,
    },
    notes: "NON_REVERSIBLE: corrected by an opposite paper entry.",
  },
} as const satisfies Record<string, PostingRule>;

// ─── Counterparty discounts (write-offs) — POSTING_MAP.md §4.7 ──────────────
// No drawer ever moves. NON_REVERSIBLE: a discount is corrected by an
// opposite entry on the same counterparty, never by a void.

const DISCOUNT_RULES = {
  "COUNTERPARTY_DISCOUNT/client": {
    transactionType: "COUNTERPARTY_DISCOUNT",
    mode: "Client debt written off (DebtService.writeOffDebt)",
    mapRef: "POSTING_MAP.md §4.7 write-off ('Debt Discount')",
    ledgers: {
      drawers: NONE,
      supplier: NONE,
      partner: NONE,
      debt: {
        post: "post",
        lines: [{ role: "client", currency: "txn", amount: (i) => -i.x }],
      },
    },
    notes:
      "A discount bundled into a repayment uses the same posting; voiding " +
      "the repayment leaves it in place by design (DebtRepository).",
  },
  "COUNTERPARTY_DISCOUNT/partner-forgiven": {
    transactionType: "COUNTERPARTY_DISCOUNT",
    mode: "Shop forgives part of what a partner owes (write-off or settle discount)",
    mapRef: "POSTING_MAP.md §4.7 Partner write-off",
    ledgers: {
      drawers: NONE,
      supplier: NONE,
      // DISCOUNT CREDIT x.
      partner: {
        post: "post",
        lines: [{ role: "partner", currency: "txn", amount: (i) => -i.x }],
      },
      debt: NONE,
    },
  },
  "COUNTERPARTY_DISCOUNT/partner-received": {
    transactionType: "COUNTERPARTY_DISCOUNT",
    mode: "Partner forgives part of what the shop owes it (write-off)",
    mapRef: "POSTING_MAP.md §4.7 Partner write-off",
    ledgers: {
      drawers: NONE,
      supplier: NONE,
      // DISCOUNT DEBIT x.
      partner: {
        post: "post",
        lines: [{ role: "partner", currency: "txn", amount: (i) => i.x }],
      },
      debt: NONE,
    },
  },
  "COUNTERPARTY_DISCOUNT/supplier": {
    transactionType: "COUNTERPARTY_DISCOUNT",
    mode: "Supplier discount bundled into a cash PAY (recordSupplierCashflow)",
    mapRef: "POSTING_MAP.md §4.7 Supplier pay / receive cash (+discount)",
    ledgers: {
      drawers: NONE,
      // DISCOUNT −x: the shop owes the supplier less.
      supplier: SUPPLIER_DOWN,
      partner: NONE,
      debt: NONE,
    },
    notes:
      "Only reachable bundled with SUPPLIER_PAYMENT/pay (D8 removed the " +
      "standalone write-off). Reversal owner: that payment's void/refund " +
      "(owner decision 2026-10-07, like the Partners page) — the DISCOUNT " +
      "row is linked to the payment's ledger row at write time and is " +
      "soft-voided with its profit negated and FIFO coverage given back. A " +
      "discount written before the link existed stays booked after the void.",
  },
} as const satisfies Record<string, PostingRule>;

// ─── Wallet RECEIVE, Hold Money pickup, manual expense ───────────────────────

const PAYOUT_AND_EXPENSE_RULES = {
  "FS_WALLET/RECEIVE/cash": {
    transactionType: "FINANCIAL_SERVICE",
    mode: "Whish App RECEIVE, paid out in cash",
    mapRef: "POSTING_MAP.md §4.2 Wallet RECEIVE, walk-in",
    ledgers: {
      // x = the transfer credited to the shop's wallet, c = the shop's
      // commission: the customer is owed x − c and handed x − c − kept.
      drawers: {
        post: "post",
        lines: [
          WALLET_IN,
          {
            role: "tender",
            currency: "txn",
            amount: (i) => -(i.x - i.c - keptOf(i)),
          },
        ],
      },
      supplier: NONE,
      partner: NONE,
      debt: NONE,
    },
    keptProfit: KEPT_PROFIT,
    notes:
      "Pinned for Whish App, payout in the transfer's own currency. Not " +
      "pinned: OMT App (it refuses any fee on a RECEIVE, so c must be 0) " +
      "and a Binance cash-out (USDT in, USD out). " +
      PAYOUT_NO_OUT_LEGS_NOTE,
  },
  "HOLD_MONEY_COLLECT/payout": {
    transactionType: "HOLD_MONEY_COLLECT",
    mode: "Hold Money pickup, paid out from the till",
    mapRef: "POSTING_MAP.md §4.6 Hold money pickup (row still reads profit 0)",
    ledgers: {
      // x = the held amount being returned (one currency): the payout legs
      // debit their drawers by x − kept.
      drawers: {
        post: "post",
        lines: [
          {
            role: "tender",
            currency: "txn",
            amount: (i) => -(i.x - keptOf(i)),
          },
        ],
      },
      supplier: NONE,
      partner: NONE,
      debt: NONE,
    },
    keptProfit: KEPT_PROFIT,
    notes:
      "The held balance clears by the full x — the kept part included — so " +
      "the hold reads 'collected'. Reversal owner: HoldMoneyRepository" +
      ".voidPickup (HOLD_MONEY_COLLECT_VOID, exact negation of drawers and " +
      "profit). A pickup never carries change (OUT) legs; it is refused.",
  },
  "EXPENSE/manual": {
    transactionType: "EXPENSE",
    mode: "Manual expense paid from a drawer, change handed back",
    mapRef: "POSTING_MAP.md §4.6 Expense, manual (row predates change back)",
    ledgers: {
      // x = cash handed to the vendor, returned = change the vendor gave
      // back. Both legs sit on the SAME transaction, on the method's drawer.
      drawers: {
        post: "post",
        lines: [
          { role: "tender", currency: "txn", amount: (i) => -i.x },
          { role: "tender", currency: "txn", amount: (i) => i.returned ?? 0 },
        ],
      },
      supplier: NONE,
      partner: NONE,
      debt: NONE,
    },
    // Change NOT returned is part of the cost, never profit.
    expenseAmount: {
      currency: "txn",
      amount: (i) => i.x - (i.returned ?? 0),
    },
    notes:
      "Operator-entered expense only. The auto SMS-fee EXPENSE a " +
      "CREDIT_TRANSFER books is pinned by that RECHARGE rule; EXPENSE_* " +
      "provider types are separate.",
  },
} as const satisfies Record<string, PostingRule>;

// ─── Warranty — LIRA-296 P2 (owner decision D1, 2026-10-10) ────────────────

const WARRANTY_RULES = {
  "WARRANTY_COST/claim": {
    transactionType: "WARRANTY_COST",
    mode: "Warranty cost of a claim (replace / refund / repair parts) or its recovery",
    mapRef: "POSTING_MAP.md §4.7 Warranty cost (LIRA-296)",
    ledgers: {
      // Profit-only: no payment legs, no counterparty. A REFUND claim's
      // cash moves on its own REFUND row (the existing refund-item rule).
      drawers: NONE,
      supplier: NONE,
      partner: NONE,
      debt: NONE,
    },
    notes:
      "profit_usd = −cost (replacement unit, refunded faulty unit, repair " +
      "parts) or +recovery (not faulty back to stock, supplier credit). " +
      "Reversal owner: WarrantyService.voidClaim (exact negation, " +
      "reverses_id); the generic void refuses the type.",
  },
} as const satisfies Record<string, PostingRule>;

export const POSTING_RULES = {
  ...FS_SYSTEM_RULES,
  ...WARRANTY_RULES,
  ...LOTO_RULES,
  ...RECHARGE_RULES,
  ...TELECOM_RULES,
  ...TOPUP_RULES,
  ...DRAWER_RULES,
  ...SUPPLIER_RULES,
  ...PARTNER_RULES,
  ...DISCOUNT_RULES,
  ...PAYOUT_AND_EXPENSE_RULES,
} as const satisfies Record<string, PostingRule>;

export type PostingRuleKey = keyof typeof POSTING_RULES;

/** Why a transaction type has no rule (yet). */
export type PostingExclusionReason =
  /** The type moves no money in any ledger. */
  | "no-money"
  /** Moves money; its rule is pending (POSTING_INTEGRITY_PLAN.md §7 TODO list). */
  | "todo-phase5"
  /** A void/refund row: guarded as "create + reverse nets to 0" (rule 20), not as a forward rule. */
  | "reversal"
  /** No code writes this type any more; historical rows only. Nothing to test forward. */
  | "retired";

/**
 * Every transaction type WITHOUT a rule, with the reason. A new type must be
 * added either to `POSTING_RULES` or here — the guard test fails otherwise.
 * `todo-phase5` is debt, not a decision: move each one into a rule.
 */
export const POSTING_RULE_EXCLUSIONS: Readonly<
  Partial<Record<TransactionType, PostingExclusionReason>>
> = {
  // ── no money: client-record audit rows ──
  CLIENT_CREATED: "no-money",
  CLIENT_UPDATED: "no-money",
  CLIENT_DELETED: "no-money",
  // Standalone profit-only row of a session basket: profit stamp only, none
  // of the four ledgers moves.
  KEPT_CHANGE: "no-money",

  // ── reversals: checked as "create + reverse nets to 0 on every ledger,
  //    per currency" (rule 20) in each module's reversal tests, not as a
  //    forward rule ──
  REFUND: "reversal",
  REFUND_UNDO: "reversal",
  HOLD_MONEY_COLLECT_VOID: "reversal",

  // ── retired: no writer left ──
  // `topUpFromCustomer`, the only writer of these two, was deleted in
  // CARRIER_LINES_VALIDITY_PLAN.md Phase 8.2 (superseded by
  // TELECOM_CREDIT_BUYBACK). Old rows keep the type and stay in
  // NON_REVERSIBLE_TRANSACTION_TYPES. If a writer ever comes back, it
  // needs a rule here first.
  MTC_TOPUP: "retired",
  ALFA_TOPUP: "retired",

  // ── moves money, rule pending (POSTING_INTEGRITY_PLAN.md §7 TODO) ──
  SALE: "todo-phase5",
  EXCHANGE: "todo-phase5",
  WALLET_EXCHANGE: "todo-phase5",
  CUSTOM_SERVICE: "todo-phase5",
  MAINTENANCE: "todo-phase5",
  LOTO_CASH_PRIZE: "todo-phase5",
  LOTO_SETTLEMENT: "todo-phase5",
  LOTO_MONTHLY_FEE: "todo-phase5",
  EXPENSE_INVENTORY: "todo-phase5",
  EXPENSE_KATSH: "todo-phase5",
  EXPENSE_IPICK: "todo-phase5",
  EXPENSE_WHISH_APP: "todo-phase5",
  HOLD_MONEY: "todo-phase5",
  DEBT_REPAYMENT: "todo-phase5",
  CREDIT_CASH_OUT: "todo-phase5",
  CREDIT_CASH_IN: "todo-phase5",
  DEBT_CASH_OUT: "todo-phase5",
  ACCOUNT_ADJUSTMENT: "todo-phase5",
};
