/**
 * LIRA-329 — the transaction details contract (ONE definition, rule 14).
 *
 * Every new transaction may carry, inside its existing `metadata_json`:
 *  - `details`: one typed set of fields per transaction kind, so the row can
 *    be understood on its own later (specs/329-transaction-full-details/
 *    data-model.md is the field list; this file is its executable form);
 *  - `payment_snapshot`: a copy of the payment lines, change returned and
 *    change kept, as at the moment of saving (`buildPaymentSnapshot`).
 *
 * Conventions:
 *  - `v` is the shape version (1). A later display step reads old and new.
 *  - Every field is optional unless the data model stars it. An empty value
 *    is OMITTED, never saved blank: strings are `min(1)`, so a builder that
 *    forwards "" fails loudly in tests instead of storing a made-up value.
 *  - Unknown keys are stripped (zod's default), never an error.
 *  - Client name/phone are NOT here — they live on the row's own
 *    `client_name`/`client_phone` columns.
 *
 * Browser-safe (rule 29): zod plus pure constant modules only. It is
 * exported from `browser.ts` through the validators barrel.
 *
 * Kinds whose builders arrive in later LIRA-329 phases (everything except
 * `omt_whish_transfer`, `custom_service` and `hold_money`) are a first draft
 * of their shape; their phase may refine them before any row is written.
 */
import { z } from "zod";
import { OMT_SERVICE_TYPES } from "../utils/omtFees.js";
import { FULFILLMENT_STATUSES } from "../utils/insuranceFulfillment.js";

// ── Field building blocks ───────────────────────────────────────────────

/** Non-empty text, kept in full (FR-006 — no truncation). */
const text = z.string().min(1);
const money = z.number().finite();
const id = z.number().int().positive();
const count = z.number().int().nonnegative();
/** `YYYY-MM-DD` calendar day. */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const currencyCode = z.string().min(1).max(10);
/** A provider / payment-method code (open set, like `providerCodeSchema`). */
const code = z.string().min(1).max(50);

const usdLbp = z.object({ usd: money.optional(), lbp: money.optional() });
const person = z.object({ name: text.optional(), phone: text.optional() });

export const PARTNER_DETAIL_MODES = ["FOR", "VIA", "THROUGH"] as const;
const partnerRef = z.object({
  id,
  name: text.optional(),
  mode: z.enum(PARTNER_DETAIL_MODES),
});

/** Fields any kind may carry (data-model.md "Common"). */
const common = {
  v: z.literal(1),
  note: text.optional(),
  /** The discount exactly as typed (FR-007). */
  discount: z.object({ amount: money, currency: currencyCode }).optional(),
  partner: partnerRef.optional(),
  /** Session id when paid through a customer-session basket. */
  paid_in_session: id.optional(),
};

const TRANSFER_DIRECTIONS = ["SEND", "RECEIVE"] as const;
const FEE_PAID_BY = ["SENDER", "DEDUCTED", "SEPARATELY"] as const;
const CARRIERS = ["MTC", "ALFA"] as const;

// ── Kinds ───────────────────────────────────────────────────────────────

/** OMT / Whish system transfer on the Services page. */
export const omtWhishTransferDetailsSchema = z.object({
  ...common,
  kind: z.literal("omt_whish_transfer"),
  provider: z.enum(["OMT", "WHISH"]),
  direction: z.enum(TRANSFER_DIRECTIONS),
  serviceType: z.enum(OMT_SERVICE_TYPES).optional(),
  reference: text.optional(),
  sender: person.optional(),
  receiver: person.optional(),
  omtFee: money.optional(),
  whishFee: money.optional(),
  includingFees: z.boolean().optional(),
  paymentMethodFee: z
    .object({ amount: money, rate: money.optional() })
    .optional(),
  brokerage: z
    .object({
      payFee: z.boolean(),
      supplierItemKey: text.optional(),
      fee: money.optional(),
    })
    .optional(),
});

/** Custom Services (IN sale or Via-Partner OUT pay-out). */
export const customServiceDetailsSchema = z.object({
  ...common,
  kind: z.literal("custom_service"),
  description: text.optional(),
  category: text.optional(),
  productId: id.optional(),
  fulfillmentStatus: z.enum(FULFILLMENT_STATUSES).optional(),
  direction: z.enum(["IN", "OUT"]).optional(),
  cost: usdLbp.optional(),
  price: usdLbp.optional(),
});

export const HOLD_MONEY_DETAIL_ACTIONS = [
  "CREATE",
  "COLLECT",
  "VOID_PICKUP",
] as const;

/** Hold Money: hold, pickup, pickup void. */
export const holdMoneyDetailsSchema = z.object({
  ...common,
  kind: z.literal("hold_money"),
  action: z.enum(HOLD_MONEY_DETAIL_ACTIONS),
  notes: text.optional(),
});

export const VOUCHER_DETAIL_ACTIONS = ["SALE", "CANCEL"] as const;

/** Vouchers (LIRA-339): a gift card sold, or cancelled with its refund.
 *  `legacy` marks the cancel of a voucher made before sales took money. */
export const voucherDetailsSchema = z.object({
  ...common,
  kind: z.literal("voucher"),
  action: z.enum(VOUCHER_DETAIL_ACTIONS),
  code: text,
  legacy: z.boolean().optional(),
});

export const telecomRechargeDetailsSchema = z.object({
  ...common,
  kind: z.literal("telecom_recharge"),
  carrier: z.enum(CARRIERS),
  type: z.enum([
    "CREDIT_TRANSFER",
    "DAYS",
    "SHOP_LINE_USE",
    "ALFA_GIFT",
    "VOUCHER",
  ]),
  phone: text.optional(),
  amount: money.optional(),
  days: count.optional(),
  carrierLineId: id.optional(),
  defaultPrice: money.optional(),
  typed: z
    .object({ costUsd: money.optional(), priceUsd: money.optional() })
    .optional(),
  giftTier: z.object({ key: text, label: text.optional() }).optional(),
  smsExpenseTxnId: id.optional(),
});

export const telecomBuybackDetailsSchema = z.object({
  ...common,
  kind: z.literal("telecom_buyback"),
  carrier: z.enum(CARRIERS),
  credits: money.optional(),
  phone: text.optional(),
  payoutMethod: code.optional(),
  carrierLineId: id.optional(),
});

export const catalogSaleDetailsSchema = z.object({
  ...common,
  kind: z.literal("catalog_sale"),
  provider: code,
  items: z
    .array(
      z.object({
        key: text.optional(),
        category: text.optional(),
        label: text.optional(),
        quantity: count,
        unitPrice: money.optional(),
        onlyDays: z.boolean().optional(),
        returnedCreditsUsd: money.optional(),
      }),
    )
    .optional(),
  currencyMode: z.enum(["LBP", "USD"]).optional(),
});

export const providerBillDetailsSchema = z.object({
  ...common,
  kind: z.literal("provider_bill"),
  provider: code,
  amount: money.optional(),
  currency: currencyCode.optional(),
});

export const walletTransferDetailsSchema = z.object({
  ...common,
  kind: z.literal("wallet_transfer"),
  provider: code,
  direction: z.enum(TRANSFER_DIRECTIONS),
  counterparty: person.optional(),
  providerFee: money.optional(),
  feePaidBy: z.enum(FEE_PAID_BY).optional(),
  cashoutMethod: code.optional(),
});

export const cryptoTransferDetailsSchema = z.object({
  ...common,
  kind: z.literal("crypto_transfer"),
  direction: z.enum(TRANSFER_DIRECTIONS),
  amountUsdt: money.optional(),
  fee: money.optional(),
  feePaidBy: z.enum(FEE_PAID_BY).optional(),
  walletOrReference: text.optional(),
  cashoutMethod: code.optional(),
});

export const walletTopupDetailsSchema = z.object({
  ...common,
  kind: z.literal("wallet_topup"),
  provider: code,
  source: z.enum(["DRAWER", "SUPPLIER", "PARTNER", "CLIENT"]).optional(),
  includingFees: z.boolean().optional(),
  fee: money.optional(),
  /** Shop-day fix: the amount moved, in `currency`. */
  amount: money.optional(),
  currency: currencyCode.optional(),
  /** The shop drawer the money left (a drawer top-up's source; a cash-out's
   *  wallet). */
  sourceDrawer: code.optional(),
  /** The shop drawer the money reached (the wallet topped up). */
  destDrawer: code.optional(),
});

export const wrongNumberDetailsSchema = z.object({
  ...common,
  kind: z.literal("wrong_number"),
  cardId: id.optional(),
  itemId: id.optional(),
  wrongNumber: text.optional(),
  rightNumber: text.optional(),
  saleTransactionId: id.optional(),
});

export const posSaleDetailsSchema = z.object({
  ...common,
  kind: z.literal("pos_sale"),
  items: z
    .array(
      z.object({
        productId: id.optional(),
        name: text.optional(),
        // Phase 5: as the sale schema allows it (`saleProcessSchema` takes
        // any positive quantity, not only whole units).
        quantity: z.number().finite().nonnegative(),
        unitPrice: money.optional(),
        unitCost: money.optional(),
        imei: text.optional(),
        unitId: id.optional(),
        warrantyMonths: count.optional(),
      }),
    )
    .optional(),
  giftCardCodes: z.array(text).optional(),
  paymentCurrency: currencyCode.optional(),
});

export const maintenanceJobDetailsSchema = z.object({
  ...common,
  kind: z.literal("maintenance_job"),
  jobId: id,
  device: text.optional(),
  issue: text.optional(),
  status: text.optional(),
  repairCost: usdLbp.optional(),
  price: usdLbp.optional(),
  warrantyMonths: count.optional(),
  warrantyUntil: day.optional(),
  parts: z
    .array(
      z.object({
        productId: id.optional(),
        name: text.optional(),
        quantity: count,
        unitPrice: money.optional(),
        unitCost: money.optional(),
      }),
    )
    .optional(),
});

export const warrantyClaimDetailsSchema = z.object({
  ...common,
  kind: z.literal("warranty_claim"),
  claimId: id,
  action: text.optional(),
  unitId: id.optional(),
  replacementUnitId: id.optional(),
  notes: text.optional(),
  overrideReason: text.optional(),
  saleItemId: id.optional(),
  maintenanceId: id.optional(),
});

export const exchangeDetailsSchema = z.object({
  ...common,
  kind: z.literal("exchange"),
  from: currencyCode,
  to: currencyCode,
  via: currencyCode.optional(),
  amountIn: money.optional(),
  amountOut: money.optional(),
  legs: z
    .array(
      z.object({
        rate: money.optional(),
        marketRate: money.optional(),
        overridden: z.boolean().optional(),
        profitUsd: money.optional(),
      }),
    )
    .optional(),
  payoutRate: money.optional(),
});

export const lotoSaleDetailsSchema = z.object({
  ...common,
  kind: z.literal("loto_sale"),
  saleAmount: money.optional(),
  commissionRate: money.optional(),
  ticketNumber: text.optional(),
});

export const lotoPrizeDetailsSchema = z.object({
  ...common,
  kind: z.literal("loto_prize"),
  ticketNumber: text.optional(),
  prizeDate: day.optional(),
});

export const expenseDetailsSchema = z.object({
  ...common,
  kind: z.literal("expense"),
  category: text.optional(),
  description: text.optional(),
  billAmount: z.object({ amount: money, currency: currencyCode }).optional(),
  /** Exactly as stored on the expense (phase 7): the Expenses page sends a
   *  full ISO instant, internal writers a `YYYY-MM-DD` day. */
  expenseDate: text.optional(),
  stockUse: z
    .object({
      source: code,
      itemId: id.optional(),
      quantity: count.optional(),
    })
    .optional(),
});

export const accountEntryDetailsSchema = z.object({
  ...common,
  kind: z.literal("account_entry"),
  action: z.enum([
    "REPAYMENT",
    "CREDIT_CASH_OUT",
    "CREDIT_CASH_IN",
    "DEBT_CASH_OUT",
    "ADJUSTMENT",
    "WRITE_OFF",
  ]),
  targets: z
    .array(
      z.object({
        type: text,
        id: id.optional(),
        amount: money.optional(),
        currency: currencyCode.optional(),
      }),
    )
    .optional(),
});

export const supplierEntryDetailsSchema = z.object({
  ...common,
  kind: z.literal("supplier_entry"),
  supplierId: id,
  action: z.enum([
    "PAY",
    "RECEIVE",
    "ADJUSTMENT",
    "RECORDED_DEBT",
    "BATCH_SETTLE",
    "ACCOUNT_SETTLE",
    // Phase 7: the supplier discount (a waive on a settlement, or a
    // discount bundled with a payment) — its own COUNTERPARTY_DISCOUNT row.
    "DISCOUNT",
  ]),
  commissionRate: money.optional(),
  unitCount: count.optional(),
});

export const partnerEntryDetailsSchema = z.object({
  ...common,
  kind: z.literal("partner_entry"),
  partnerId: id,
  action: z.enum(["SETTLE", "PAYMENT", "ADJUSTMENT", "WRITE_OFF"]),
  pickedType: text.optional(),
  reason: text.optional(),
});

export const sessionSiblingDetailsSchema = z.object({
  ...common,
  kind: z.literal("session_sibling"),
  sessionId: id,
  role: z.enum(["EXTRA", "KEPT_CHANGE", "WAIVED"]).optional(),
  paidByMethod: code.optional(),
});

export const reversalDetailsSchema = z.object({
  ...common,
  kind: z.literal("reversal"),
  originalTransactionId: id,
  reason: text.optional(),
  refundUnits: z
    .array(z.object({ unitId: id, flags: z.array(text).optional() }))
    .optional(),
});

// ── The union ───────────────────────────────────────────────────────────

/** Discriminated on `kind`. */
export const transactionDetailsSchema = z.discriminatedUnion("kind", [
  omtWhishTransferDetailsSchema,
  customServiceDetailsSchema,
  holdMoneyDetailsSchema,
  voucherDetailsSchema,
  telecomRechargeDetailsSchema,
  telecomBuybackDetailsSchema,
  catalogSaleDetailsSchema,
  providerBillDetailsSchema,
  walletTransferDetailsSchema,
  cryptoTransferDetailsSchema,
  walletTopupDetailsSchema,
  wrongNumberDetailsSchema,
  posSaleDetailsSchema,
  maintenanceJobDetailsSchema,
  warrantyClaimDetailsSchema,
  exchangeDetailsSchema,
  lotoSaleDetailsSchema,
  lotoPrizeDetailsSchema,
  expenseDetailsSchema,
  accountEntryDetailsSchema,
  supplierEntryDetailsSchema,
  partnerEntryDetailsSchema,
  sessionSiblingDetailsSchema,
  reversalDetailsSchema,
]);

export type TransactionDetails = z.infer<typeof transactionDetailsSchema>;
export type TransactionDetailsKind = TransactionDetails["kind"];

/** Every kind, read off the union itself (never a second hand-kept list). */
export const TRANSACTION_DETAILS_KINDS: readonly TransactionDetailsKind[] =
  transactionDetailsSchema.options.map(
    (o) => o.shape.kind.value,
  ) as TransactionDetailsKind[];

export type OmtWhishTransferDetails = z.infer<
  typeof omtWhishTransferDetailsSchema
>;
export type CustomServiceDetails = z.infer<typeof customServiceDetailsSchema>;
export type HoldMoneyDetails = z.infer<typeof holdMoneyDetailsSchema>;
export type VoucherDetails = z.infer<typeof voucherDetailsSchema>;
export type ExpenseDetails = z.infer<typeof expenseDetailsSchema>;
export type AccountEntryDetails = z.infer<typeof accountEntryDetailsSchema>;
export type SupplierEntryDetails = z.infer<typeof supplierEntryDetailsSchema>;
export type PartnerEntryDetails = z.infer<typeof partnerEntryDetailsSchema>;
export type PosSaleDetails = z.infer<typeof posSaleDetailsSchema>;
export type MaintenanceJobDetails = z.infer<typeof maintenanceJobDetailsSchema>;
export type WarrantyClaimDetails = z.infer<typeof warrantyClaimDetailsSchema>;
export type ExchangeDetails = z.infer<typeof exchangeDetailsSchema>;
export type LotoSaleDetails = z.infer<typeof lotoSaleDetailsSchema>;
export type LotoPrizeDetails = z.infer<typeof lotoPrizeDetailsSchema>;

/** The version every builder stamps. */
export const TRANSACTION_DETAILS_VERSION = 1 as const;

// ── Payment snapshot (contracts/transaction-details.md) ─────────────────

const snapshotDirection = z.enum(["IN", "OUT"]);

export const paymentSnapshotSchema = z.object({
  /** Every leg as booked: method, currency, amount and its partition
   *  direction (`partitionLegs`: IN = the leg the flow consumes — paid by
   *  the customer, or a payout leg; OUT = change handed back). */
  lines: z.array(
    z.object({
      method: code,
      currency: currencyCode,
      amount: money,
      direction: snapshotDirection,
      note: text.optional(),
    }),
  ),
  /** The OUT (change) legs again, on their own, for a reader that only
   *  wants "change returned". */
  change_returned: z
    .array(z.object({ method: code, currency: currencyCode, amount: money }))
    .optional(),
  /** Change the customer left with the shop, per currency. */
  kept: usdLbp.optional(),
  /** Paid as part of a customer-session payment. */
  session_id: id.optional(),
});

export type PaymentSnapshot = z.infer<typeof paymentSnapshotSchema>;
