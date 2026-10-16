/**
 * RechargeBasketService — LIRA-326: one Mobile Recharge basket across
 * providers (iPick, Katsh, Whish App), paid ONCE.
 *
 * Records the basket as an automatic customer session and checks it out
 * through the existing SessionCheckoutService (research R1/R2): one `_batch`
 * cart entry per provider, each sub-item booked by FinancialService under its
 * OWN provider, ONE payment posted for the whole basket, the session closed.
 * No new posting code — the money path, profit stamping and the reversal
 * owner (`voidSessionBasket` / `refundSessionBasket`, rule 20) are all the
 * session checkout's.
 *
 * Shared by the IPC handler (`recharge-basket:checkout`) and the REST route
 * (`POST /api/recharge-basket/checkout`) — rules 13/14/19. No SQL here: the
 * session row is created and deleted through CustomerSessionRepository.
 *
 * All-or-nothing: the basket shape is checked BEFORE anything is written;
 * checkout runs its writes in one DB transaction (rolled back on failure);
 * and the session created here is deleted again when checkout fails.
 *
 * Client registration: no separate step. Checkout's own
 * `resolveSessionClientForCheckout` already registers the session customer
 * (findOrCreateByPhone) when both a name and a phone are given — the same
 * rule `session:start` applies — and it does so only once the basket shape
 * has been accepted, so a refused basket never registers anyone.
 */
import {
  getCustomerSessionRepository,
  type CustomerSessionRepository,
} from "../repositories/CustomerSessionRepository.js";
import {
  getSessionCheckoutService,
  type CheckoutRequest,
  type CheckoutResult,
  type SessionCheckoutService,
} from "./SessionCheckoutService.js";
import {
  RECHARGE_BASKET_BILL_MODULES,
  RECHARGE_BASKET_MODULES,
  RECHARGE_BASKET_MODULE_PROVIDER,
  type RechargeBasketCheckoutInput,
  type RechargeBasketModule,
} from "../validators/rechargeBasket.js";
import { rechargeLogger } from "../utils/logger.js";

/** The note that marks a session as a Mobile Recharge basket (FR-008). */
export const RECHARGE_BASKET_SESSION_NOTE = "Mobile Recharge basket";
/** Session customer when the cashier entered no name. */
export const RECHARGE_BASKET_WALK_IN = "Walk-in";

export const RECHARGE_BASKET_EMPTY_ERROR = "The basket is empty.";
export const RECHARGE_BASKET_ITEM_ERROR =
  "Only iPick, Katsh and Whish App items can be paid in a Mobile Recharge basket.";

export type RechargeBasketCheckoutRequest = RechargeBasketCheckoutInput & {
  userId: number;
};

export interface RechargeBasketCheckoutResult extends CheckoutResult {
  /** The closed session that links the basket's sales (success only). */
  sessionId?: number;
}

function isBasketModule(module: string): module is RechargeBasketModule {
  return (RECHARGE_BASKET_MODULES as readonly string[]).includes(module);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * LIRA-327 — a bill entry must be exactly what a bill paid on its own sends:
 * its own provider, one currency and amount (the entry's — checkout charges
 * the ENTRY), cost = price = amount, no profit (a bill's commission is
 * entered at settlement). Anything else would book a different row.
 */
function findBillRefusal(
  entry: Record<string, unknown>,
  bill: Record<string, unknown>,
  module: RechargeBasketModule,
  label: string,
): string | null {
  const provider = RECHARGE_BASKET_MODULE_PROVIDER[module];
  if (bill.provider !== provider) {
    return `"${label}" is a ${provider} bill but names ${String(bill.provider)} as its provider.`;
  }
  if (bill.currency !== entry.currency) {
    return `"${label}" mixes currencies: the bill must be ${String(entry.currency)}.`;
  }
  const amount = Number(bill.amount);
  if (!(amount > 0) || amount !== Number(entry.amount)) {
    return `"${label}": the bill amount must match the amount charged for it.`;
  }
  if (
    Number(bill.cost) !== amount ||
    (bill.price !== undefined && Number(bill.price) !== amount) ||
    Number(bill.commission ?? 0) !== 0
  ) {
    return `"${label}": a bill costs exactly its amount and earns nothing until it is settled.`;
  }
  return null;
}

/**
 * The basket-specific shape the session-checkout envelope leaves open
 * (`cartItems` is `unknown[]` there; contracts/recharge-basket-checkout.md).
 * Returns the refusal, or null. Pure — runs before any write.
 */
export function findRechargeBasketRefusal(
  cartItems: readonly unknown[] | undefined,
): string | null {
  if (!cartItems || cartItems.length === 0) return RECHARGE_BASKET_EMPTY_ERROR;

  for (const raw of cartItems) {
    const entry = asRecord(raw);
    const formData = asRecord(entry?.formData);
    const module = entry?.module;
    if (
      !entry ||
      !formData ||
      entry.ipcChannel !== "financial:create" ||
      typeof module !== "string" ||
      !isBasketModule(module)
    ) {
      return RECHARGE_BASKET_ITEM_ERROR;
    }
    const label = typeof entry.label === "string" ? entry.label : module;
    // LIRA-327: a bill is its own entry (not a `_batch`).
    if (formData._batch !== true) {
      if (
        formData.serviceType !== "BILL" ||
        !(RECHARGE_BASKET_BILL_MODULES as readonly string[]).includes(module)
      ) {
        return RECHARGE_BASKET_ITEM_ERROR;
      }
      const billRefusal = findBillRefusal(entry, formData, module, label);
      if (billRefusal) return billRefusal;
      continue;
    }
    const items = formData.items;
    if (!Array.isArray(items) || items.length === 0) {
      return `"${label}" has no items to pay.`;
    }
    const provider = RECHARGE_BASKET_MODULE_PROVIDER[module];
    for (const rawSub of items) {
      const sub = asRecord(rawSub);
      if (!sub || sub.provider !== provider) {
        return `"${label}" mixes providers: every item in it must be ${provider}, found ${String(sub?.provider)}.`;
      }
      // Session checkout buckets an entry's charge by the ENTRY's currency;
      // a line in another currency would be booked in the wrong one.
      if ((sub.currency ?? entry.currency) !== entry.currency) {
        return `"${label}" mixes currencies: every item in it must be ${String(entry.currency)}.`;
      }
    }
  }
  return null;
}

export class RechargeBasketService {
  private readonly sessionRepo?: CustomerSessionRepository;
  private readonly checkoutService?: SessionCheckoutService;

  /** Dependencies resolve lazily from the singletons unless injected (tests). */
  constructor(
    sessionRepo?: CustomerSessionRepository,
    checkoutService?: SessionCheckoutService,
  ) {
    this.sessionRepo = sessionRepo;
    this.checkoutService = checkoutService;
  }

  private get repo(): CustomerSessionRepository {
    return this.sessionRepo ?? getCustomerSessionRepository();
  }

  private get checkoutSvc(): SessionCheckoutService {
    return this.checkoutService ?? getSessionCheckoutService();
  }

  /**
   * Pay a Mobile Recharge basket. `req.userId` is the authenticated operator
   * (both transports overwrite the wire value); `ctx.username` is stamped as
   * the session's started_by / closed_by.
   */
  async checkout(
    req: RechargeBasketCheckoutRequest,
    ctx: { username: string },
  ): Promise<RechargeBasketCheckoutResult> {
    const refusal = findRechargeBasketRefusal(req.cartItems);
    if (refusal) {
      rechargeLogger.warn(
        { userId: req.userId, refusal },
        "Recharge basket refused",
      );
      return { success: false, error: refusal };
    }

    const customerName = req.clientName?.trim() || RECHARGE_BASKET_WALK_IN;
    const customerPhone = req.clientPhone?.trim() || undefined;

    let sessionId: number;
    try {
      sessionId = this.repo.createSession({
        customer_name: customerName,
        customer_phone: customerPhone,
        customer_notes: RECHARGE_BASKET_SESSION_NOTE,
        started_by: ctx.username || String(req.userId),
        user_id: req.userId,
      });
    } catch (error) {
      rechargeLogger.error(
        { error, userId: req.userId },
        "Recharge basket: session create failed",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Checkout failed",
      };
    }

    const { clientPhone: _phone, ...envelope } = req;
    let result: CheckoutResult;
    try {
      result = await this.checkoutSvc.checkout(
        { ...(envelope as unknown as CheckoutRequest), sessionId },
        ctx,
      );
    } catch (error) {
      result = {
        success: false,
        error: error instanceof Error ? error.message : "Checkout failed",
      };
    }

    if (!result.success) {
      // Checkout's own writes were rolled back; drop the session it was for.
      try {
        this.repo.deleteSession(sessionId);
      } catch (error) {
        rechargeLogger.error(
          { error, sessionId },
          "Recharge basket: failed to delete the session of a failed checkout",
        );
      }
      rechargeLogger.warn(
        { sessionId, userId: req.userId, error: result.error },
        "Recharge basket checkout failed",
      );
      return { ...result, success: false };
    }

    rechargeLogger.info(
      {
        sessionId,
        userId: req.userId,
        itemCount: result.itemCount,
        totalUsd: result.checkoutTotalUsd,
        totalLbp: result.checkoutTotalLbp,
      },
      "Recharge basket paid",
    );
    return { ...result, sessionId };
  }
}

let instance: RechargeBasketService | null = null;

export function getRechargeBasketService(): RechargeBasketService {
  if (!instance) instance = new RechargeBasketService();
  return instance;
}

export function resetRechargeBasketService(): void {
  instance = null;
}
