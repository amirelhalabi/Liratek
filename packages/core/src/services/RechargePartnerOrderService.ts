/**
 * RechargePartnerOrderService — LIRA-327: "For Partner" across the Mobile
 * Recharge basket. ONE submit books every provider's partner sales (iPick /
 * Katsh card sales and bills, Whish App units) in ONE DB transaction: if any
 * sale fails, none is booked.
 *
 * No new posting code: each sale is today's per-tab partner call
 * (`FinancialService.addTransaction` with partnerMode "FOR", no counter
 * payment) — the provider drawer pays the sale's cost and the partner owes
 * its full selling price. The reversal owner is unchanged: each sale is
 * voided / refunded on its own through the generic per-transaction path,
 * which reverses its partner_ledger rows (rule 20). Partner sales carry no
 * pooled payment, so reversing one never strands another's money.
 *
 * Shared by the IPC handler (`recharge-basket:partner-order`) and the REST
 * route (`POST /api/recharge-basket/partner-order`) — rules 13/14/19. No SQL
 * here: the transaction boundary is FinancialServiceRepository's.
 */
import {
  getFinancialService,
  type FinancialService,
} from "./FinancialService.js";
import {
  getFinancialServiceRepository,
  type CreateFinancialServiceData,
  type FinancialServiceRepository,
} from "../repositories/FinancialServiceRepository.js";
import {
  RECHARGE_BASKET_BILL_MODULES,
  RECHARGE_BASKET_MODULES,
  RECHARGE_BASKET_MODULE_PROVIDER,
  type RechargePartnerOrderInput,
} from "../validators/rechargeBasket.js";
import { rechargeLogger } from "../utils/logger.js";

export const PARTNER_ORDER_EMPTY_ERROR = "There is nothing to submit.";
export const PARTNER_ORDER_PROVIDER_ERROR =
  "Only iPick, Katsh and Whish App items can be submitted to a partner from Mobile Recharge.";
export const PARTNER_ORDER_BILL_ERROR =
  "Only iPick and Katsh bills can be submitted to a partner.";
export const PARTNER_ORDER_SERVICE_TYPE_ERROR =
  "A partner order can only hold sales and bills.";
export const PARTNER_ORDER_PAYMENT_ERROR =
  "A partner order collects no payment from a customer.";
export const PARTNER_ORDER_CUSTOMER_ERROR =
  "A partner order has no walk-in customer.";
export const PARTNER_ORDER_OTHER_PARTNER_ERROR =
  "Every item in a partner order goes to the same partner.";

export type RechargePartnerOrderRequest = RechargePartnerOrderInput;

export interface RechargePartnerOrderResult {
  success: boolean;
  /** financial_services ids, in submit order (success only). */
  ids?: number[];
  error?: string;
}

type PartnerSale = RechargePartnerOrderInput["sales"][number];

const BASKET_PROVIDERS = new Set<string>(
  RECHARGE_BASKET_MODULES.map((m) => RECHARGE_BASKET_MODULE_PROVIDER[m]),
);
const BILL_PROVIDERS = new Set<string>(
  RECHARGE_BASKET_BILL_MODULES.map((m) => RECHARGE_BASKET_MODULE_PROVIDER[m]),
);

/**
 * What a partner order may hold. Returns the refusal, or null. Pure — runs
 * before any write.
 */
export function findPartnerOrderRefusal(
  partnerId: number,
  sales: readonly PartnerSale[] | undefined,
): string | null {
  if (!sales || sales.length === 0) return PARTNER_ORDER_EMPTY_ERROR;
  for (const sale of sales) {
    if (!BASKET_PROVIDERS.has(sale.provider)) {
      return PARTNER_ORDER_PROVIDER_ERROR;
    }
    if (sale.serviceType === "BILL") {
      if (!BILL_PROVIDERS.has(sale.provider)) return PARTNER_ORDER_BILL_ERROR;
    } else if (sale.serviceType !== "SEND") {
      return PARTNER_ORDER_SERVICE_TYPE_ERROR;
    }
    // Only the shop's own disbursement (an OUT leg, today's zero-cost Whish
    // transfer unit) — never a customer-paid IN leg.
    if (
      (sale.payments ?? []).some((leg) => leg.direction !== "OUT") ||
      (sale.customerPayments?.length ?? 0) > 0 ||
      (sale.feePayments?.length ?? 0) > 0 ||
      sale.paidByMethod === "CUSTOMER_ACCOUNT"
    ) {
      return PARTNER_ORDER_PAYMENT_ERROR;
    }
    if (sale.clientId !== undefined || sale.clientName !== undefined) {
      return PARTNER_ORDER_CUSTOMER_ERROR;
    }
    if (
      (sale.partnerId !== undefined && sale.partnerId !== partnerId) ||
      (sale.partnerMode !== undefined && sale.partnerMode !== "FOR")
    ) {
      return PARTNER_ORDER_OTHER_PARTNER_ERROR;
    }
  }
  return null;
}

/** Carries a failed sale's own error out of the transaction (rolls it back). */
class PartnerSaleFailed extends Error {}

export class RechargePartnerOrderService {
  private readonly financialService?: FinancialService;
  private readonly fsRepository?: FinancialServiceRepository;

  /** Dependencies resolve lazily from the singletons unless injected (tests). */
  constructor(
    financialService?: FinancialService,
    fsRepository?: FinancialServiceRepository,
  ) {
    this.financialService = financialService;
    this.fsRepository = fsRepository;
  }

  private get financial(): FinancialService {
    return this.financialService ?? getFinancialService();
  }

  private get repo(): FinancialServiceRepository {
    return this.fsRepository ?? getFinancialServiceRepository();
  }

  /**
   * Book a partner order. `req.userId` is the authenticated operator (both
   * transports overwrite the wire value).
   */
  submit(req: RechargePartnerOrderRequest): RechargePartnerOrderResult {
    const refusal = findPartnerOrderRefusal(req.partnerId, req.sales);
    if (refusal) {
      rechargeLogger.warn(
        { userId: req.userId, partnerId: req.partnerId, refusal },
        "Recharge partner order refused",
      );
      return { success: false, error: refusal };
    }

    try {
      const ids = this.repo.transaction(() =>
        req.sales.map((sale) => {
          const result = this.financial.addTransaction({
            ...sale,
            payments: sale.payments ?? [],
            partnerId: req.partnerId,
            partnerMode: "FOR",
            ...(req.transaction_time
              ? { transaction_time: req.transaction_time }
              : {}),
            userId: req.userId,
          } as CreateFinancialServiceData);
          if (!result.success || !result.id) {
            throw new PartnerSaleFailed(
              result.error || "Failed to process partner transaction",
            );
          }
          return result.id;
        }),
      );
      rechargeLogger.info(
        { userId: req.userId, partnerId: req.partnerId, ids },
        "Recharge partner order booked",
      );
      return { success: true, ids };
    } catch (error) {
      rechargeLogger.warn(
        { error, userId: req.userId, partnerId: req.partnerId },
        "Recharge partner order failed — nothing booked",
      );
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to process partner transaction",
      };
    }
  }
}

let instance: RechargePartnerOrderService | null = null;

export function getRechargePartnerOrderService(): RechargePartnerOrderService {
  if (!instance) instance = new RechargePartnerOrderService();
  return instance;
}

export function resetRechargePartnerOrderService(): void {
  instance = null;
}
