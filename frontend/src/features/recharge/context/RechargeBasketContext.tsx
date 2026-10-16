/**
 * LIRA-326 — ONE Mobile Recharge basket across provider tabs.
 *
 * The iPick + Katsh grid (KatshForm) and the Whish App Bills grid
 * (FinancialForm) used to keep their cart in component state, so switching
 * to a tab with a different screen threw the picks away. The carts live here
 * instead, mounted in the app shell above the routes: picks survive tab
 * switches and leaving Mobile Recharge (FR-014). Nothing is persisted — a
 * reload or closing the app empties the basket, by design.
 *
 * Two groups, each owned by the form that prices it:
 *  - "catalog": iPick + Katsh (KatshForm's cart; both providers mix);
 *  - "whish":   Whish App (FinancialForm on the WHISH_APP tab).
 * Each owning form publishes its lines PRICED (`PricedLine`), so the other
 * tab can list and pay them without knowing their pricing rules.
 *
 * Outside a provider (component tests, any other host) the hooks fall back to
 * a local cart: the form works exactly as it did, nothing is shared.
 *
 * LIRA-327 adds two basket-wide pieces:
 *  - `bills`: the bills staged on the iPick / Katsh Bill card, each tagged
 *    with the tab it was added on (and always booked under that provider).
 *    They are priced here (`billLines`), so either form can list and pay
 *    them, even while KatshForm is unmounted;
 *  - `partner`: the For Partner toggle + chosen partner — on in one basket
 *    tab means on in every basket tab (Katsh, iPick, Whish App), until it is
 *    turned off or the basket is submitted / cleared.
 *
 * Rule 25: the context value is memoised on its pieces of state; the setters
 * are React's own (stable), so a consumer can call them from
 * empty-dependency callbacks.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type {
  BasketBill,
  CatalogCartLine,
  PricedLine,
  WhishCartLine,
} from "../types/basket";
import { billPricedLine } from "../utils/basketCheckout";

/** The basket-wide For Partner choice. */
export interface BasketPartner {
  forPartner: boolean;
  partnerId: number | null;
}

const PARTNER_OFF: BasketPartner = { forPartner: false, partnerId: null };

interface RechargeBasketValue {
  catalogCart: Map<string, CatalogCartLine>;
  setCatalogCart: Dispatch<SetStateAction<Map<string, CatalogCartLine>>>;
  catalogPriced: PricedLine[];
  setCatalogPriced: (lines: PricedLine[]) => void;
  whishCart: Map<string, WhishCartLine>;
  setWhishCart: Dispatch<SetStateAction<Map<string, WhishCartLine>>>;
  whishPriced: PricedLine[];
  setWhishPriced: (lines: PricedLine[]) => void;
  /** LIRA-327 — staged bills, each under the tab it was added on. */
  bills: BasketBill[];
  setBills: Dispatch<SetStateAction<BasketBill[]>>;
  /** The bills, priced (one PricedLine each). */
  billLines: PricedLine[];
  /** LIRA-327 — For Partner, basket-wide. */
  partner: BasketPartner;
  setPartner: Dispatch<SetStateAction<BasketPartner>>;
  /** Empty every group, drop the bills and turn For Partner off (after a
   *  paid / submitted basket). */
  clearAll: () => void;
}

const RechargeBasketContext = createContext<RechargeBasketValue | null>(null);

export function RechargeBasketProvider({ children }: { children: ReactNode }) {
  const [catalogCart, setCatalogCart] = useState<Map<string, CatalogCartLine>>(
    () => new Map(),
  );
  const [catalogPriced, setCatalogPriced] = useState<PricedLine[]>([]);
  const [whishCart, setWhishCart] = useState<Map<string, WhishCartLine>>(
    () => new Map(),
  );
  const [whishPriced, setWhishPriced] = useState<PricedLine[]>([]);
  const [bills, setBills] = useState<BasketBill[]>([]);
  const billLines = useMemo(() => bills.map(billPricedLine), [bills]);
  const [partner, setPartner] = useState<BasketPartner>(PARTNER_OFF);

  const clearAll = useCallback(() => {
    setCatalogCart(new Map());
    setCatalogPriced([]);
    setWhishCart(new Map());
    setWhishPriced([]);
    setBills([]);
    setPartner(PARTNER_OFF);
  }, []);

  const value = useMemo<RechargeBasketValue>(
    () => ({
      catalogCart,
      setCatalogCart,
      catalogPriced,
      setCatalogPriced,
      whishCart,
      setWhishCart,
      whishPriced,
      setWhishPriced,
      bills,
      setBills,
      billLines,
      partner,
      setPartner,
      clearAll,
    }),
    [
      catalogCart,
      catalogPriced,
      whishCart,
      whishPriced,
      bills,
      billLines,
      partner,
      clearAll,
    ],
  );

  return (
    <RechargeBasketContext.Provider value={value}>
      {children}
    </RechargeBasketContext.Provider>
  );
}

/** What a form sees of its own group in the basket. */
export interface BasketGroupHandle<L> {
  cart: Map<string, L>;
  setCart: Dispatch<SetStateAction<Map<string, L>>>;
  /** Publish this group's lines, priced. */
  setPriced: (lines: PricedLine[]) => void;
  /** The OTHER group's priced lines (empty outside a provider). For the
   *  Whish App group this includes the staged bills (LIRA-327). */
  others: PricedLine[];
  /** Empty the whole basket — every group. */
  clearAll: () => void;
  /** False outside a provider: the cart is this form's alone. */
  shared: boolean;
}

const NO_LINES: PricedLine[] = [];

function useGroup<L>(
  shared: Omit<BasketGroupHandle<L>, "shared"> | null,
): BasketGroupHandle<L> {
  // Always called (hooks cannot be conditional); used only without a provider.
  const [cart, setCart] = useState<Map<string, L>>(() => new Map());
  const setPriced = useCallback((_lines: PricedLine[]) => {}, []);
  const clearAll = useCallback(() => setCart(new Map()), []);
  if (shared) return { ...shared, shared: true };
  return {
    cart,
    setCart,
    setPriced,
    others: NO_LINES,
    clearAll,
    shared: false,
  };
}

/**
 * LIRA-327 — the staged bills (KatshForm's Bill card). Outside a provider
 * (component tests, any other host) they are this form's alone.
 */
export interface BasketBillsHandle {
  bills: BasketBill[];
  setBills: Dispatch<SetStateAction<BasketBill[]>>;
  /** The bills, priced — one line each, under its own provider. */
  billLines: PricedLine[];
}

export function useBasketBills(): BasketBillsHandle {
  const ctx = useContext(RechargeBasketContext);
  // Always called (hooks cannot be conditional); used only without a provider.
  const [bills, setBills] = useState<BasketBill[]>([]);
  const billLines = useMemo(() => bills.map(billPricedLine), [bills]);
  if (ctx) {
    return {
      bills: ctx.bills,
      setBills: ctx.setBills,
      billLines: ctx.billLines,
    };
  }
  return { bills, setBills, billLines };
}

/**
 * LIRA-327 — the For Partner toggle + partner. Basket-wide on the basket
 * tabs (`enabled`); any other provider FinancialForm serves, and any host
 * without a provider, keeps its own.
 */
export interface BasketPartnerHandle extends BasketPartner {
  setForPartner: (on: boolean) => void;
  setPartnerId: (id: number | null) => void;
  /** True when the choice is the basket's (shared across tabs). */
  shared: boolean;
}

export function useBasketPartner(enabled: boolean): BasketPartnerHandle {
  const ctx = useContext(RechargeBasketContext);
  const [local, setLocal] = useState<BasketPartner>(PARTNER_OFF);
  const shared = !!ctx && enabled;
  const value = shared ? ctx.partner : local;
  const set = shared ? ctx.setPartner : setLocal;
  const setForPartner = useCallback(
    (on: boolean) =>
      set((p) => (on ? { ...p, forPartner: true } : { ...PARTNER_OFF })),
    [set],
  );
  const setPartnerId = useCallback(
    (id: number | null) => set((p) => ({ ...p, partnerId: id })),
    [set],
  );
  return { ...value, setForPartner, setPartnerId, shared };
}

/** The iPick + Katsh group (KatshForm). */
export function useCatalogBasket(): BasketGroupHandle<CatalogCartLine> {
  const ctx = useContext(RechargeBasketContext);
  return useGroup<CatalogCartLine>(
    ctx
      ? {
          cart: ctx.catalogCart,
          setCart: ctx.setCatalogCart,
          setPriced: ctx.setCatalogPriced,
          others: ctx.whishPriced,
          clearAll: ctx.clearAll,
        }
      : null,
  );
}

/**
 * The Whish App group (FinancialForm). `enabled` is false for every other
 * provider FinancialForm serves — those keep a local cart, never the basket.
 */
export function useWhishBasket(
  enabled: boolean,
): BasketGroupHandle<WhishCartLine> {
  const ctx = useContext(RechargeBasketContext);
  const catalogPriced = ctx?.catalogPriced;
  const billLines = ctx?.billLines;
  // LIRA-327: the other tabs' lines = iPick / Katsh cards + staged bills.
  const others = useMemo(
    () => [...(catalogPriced ?? NO_LINES), ...(billLines ?? NO_LINES)],
    [catalogPriced, billLines],
  );
  return useGroup<WhishCartLine>(
    ctx && enabled
      ? {
          cart: ctx.whishCart,
          setCart: ctx.setWhishCart,
          setPriced: ctx.setWhishPriced,
          others,
          clearAll: ctx.clearAll,
        }
      : null,
  );
}

/** Picked quantities per provider tab, across every group, plus each staged
 *  bill under its own tab (LIRA-327) ({} outside a provider). */
export function useRechargeBasketCounts(): Record<string, number> {
  const ctx = useContext(RechargeBasketContext);
  const catalogCart = ctx?.catalogCart;
  const whishCart = ctx?.whishCart;
  const bills = ctx?.bills;
  return useMemo(() => {
    const counts: Record<string, number> = {};
    const add = (
      lines: Iterable<{ item: { provider: string }; quantity: number }>,
    ) => {
      for (const l of lines)
        counts[l.item.provider] = (counts[l.item.provider] ?? 0) + l.quantity;
    };
    if (catalogCart) add(catalogCart.values());
    if (whishCart) add(whishCart.values());
    for (const b of bills ?? [])
      counts[b.provider] = (counts[b.provider] ?? 0) + 1;
    return counts;
  }, [catalogCart, whishCart, bills]);
}
