import { useEffect, useMemo, useState } from "react";
import {
  MultiPaymentInput,
  PageHeader,
  type PaymentLine,
} from "@liratek/ui";
import { Truck } from "lucide-react";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { useSellRate } from "@/hooks/useSellRate";
import { useShopBase } from "@/hooks/useShopBase";
import {
  useSuppliersQuery,
  useSupplierBalancesQuery,
  useProductSupplierBalancesQuery,
  useProductItemsQuery,
  useSupplierLedgerQuery,
  useAllTransactionsQuery,
  useSupplierCashflowMutation,
} from "../../hooks/useSuppliers";

type Supplier = {
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
};

type SupplierBalance = {
  supplier_id: number;
  total_usd: number;
  total_lbp: number;
};

type LedgerEntry = {
  id: number;
  supplier_id: number;
  entry_type:
    | "TOP_UP"
    | "SALE_COST"
    | "PAYMENT"
    | "ADJUSTMENT"
    | "SETTLEMENT"
    | "CASH_PRIZE"
    | "SUPPLIER_PAYS_US";
  amount_usd: number;
  amount_lbp: number;
  note: string | null;
  created_by: number | null;
  transaction_id: number | null;
  created_at: string;
};

type SupplierTxn = {
  id: number;
  service_type: "SEND" | "RECEIVE";
  amount: number;
  currency: string;
  commission: number;
  cost: number;
  omt_fee: number | null;
  omt_service_type: string | null;
  settlement_id: number | null;
  is_settled: number;
  fifo_status: "paid" | "partial" | "unpaid";
  fifo_paid_usd: number;
  created_at: string;
};

const PROVIDER_DRAWER: Record<string, string> = {
  OMT: "OMT_System",
  WHISH: "Whish_System",
  iPick: "iPick",
  Katsh: "Katsh",
  OMT_APP: "OMT_App",
  WHISH_APP: "Whish_App",
  LOTO: "Loto",
};

function EntryTypeBadge({ type }: { type: string }) {
  const color =
    type === "TOP_UP"
      ? "bg-red-900/50 text-red-300"
      : type === "SALE_COST"
        ? "bg-orange-900/50 text-orange-300"
        : type === "PAYMENT"
          ? "bg-green-900/50 text-green-300"
          : type === "SUPPLIER_PAYS_US"
            ? "bg-emerald-900/50 text-emerald-300"
            : type === "SETTLEMENT"
              ? "bg-blue-900/50 text-blue-300"
              : "bg-amber-900/50 text-amber-300";
  const label =
    type === "SALE_COST"
      ? "SALE COST"
      : type === "SUPPLIER_PAYS_US"
        ? "PAID US"
        : type;
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${color}`}>
      {label}
    </span>
  );
}

/**
 * Supplier balance is the signed sum of the ledger:
 *   > 0  → WE owe the supplier   ("You owe …", red)
 *   < 0  → the supplier owes US  ("They owe you …", green) — e.g. after overpayment
 *   = 0  → settled
 */
const BALANCE_EPS = 0.005;
function describeBalance(
  amount: number,
  currency: "USD" | "LBP",
): { text: string; cls: string } {
  const abs = Math.abs(amount);
  const money =
    currency === "USD"
      ? `$${abs.toFixed(2)}`
      : `${Math.round(abs).toLocaleString()} LBP`;
  if (amount > BALANCE_EPS)
    return { text: `You owe ${money}`, cls: "text-red-400" };
  if (amount < -BALANCE_EPS)
    return { text: `They owe you ${money}`, cls: "text-green-400" };
  return { text: "Settled", cls: "text-slate-400" };
}

/** Compact directional color for a single signed amount (list rows). */
function balanceColor(amount: number): string {
  if (amount > BALANCE_EPS) return "text-red-400";
  if (amount < -BALANCE_EPS) return "text-green-400";
  return "text-slate-500";
}

export default function SuppliersPage() {
  const { methods } = usePaymentMethods();
  const { partnerSystem } = useShopBase();

  // ── UI / form state (kept local — not server state) ──────────────────────
  const [viewCategory, setViewCategory] = useState<"companies" | "products">(
    "companies",
  );
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(
    null,
  );
  const [activeTab, setActiveTab] = useState<"settle" | "manual" | "items">(
    "settle",
  );
  // Pay / Receive (LIRA-059): cashflow against the supplier via payment legs
  const [cashflowDirection, setCashflowDirection] = useState<"PAY" | "RECEIVE">(
    "PAY",
  );
  const [cashflowLines, setCashflowLines] = useState<PaymentLine[]>([]);
  const [cashflowNote, setCashflowNote] = useState("");
  const [cashflowKey, setCashflowKey] = useState(0);

  // ── Exchange rate ─────────────────────────────────────────────────────────
  const { sellRate: exchangeRate } = useSellRate();

  // ── Server queries ────────────────────────────────────────────────────────
  const suppliersQuery = useSuppliersQuery();
  const balancesQuery = useSupplierBalancesQuery();
  const productBalancesQuery = useProductSupplierBalancesQuery();

  const selectedSupplier = useMemo(
    () =>
      (suppliersQuery.data as Supplier[] | undefined)?.find(
        (s) => s.id === selectedSupplierId,
      ) ?? null,
    [suppliersQuery.data, selectedSupplierId],
  );

  const isProductSupplier = selectedSupplier?.is_system === 0;

  const ledgerQuery = useSupplierLedgerQuery(selectedSupplierId);
  const allTxnsQuery = useAllTransactionsQuery(
    isProductSupplier ? null : (selectedSupplier?.provider ?? null),
  );
  const productItemsQuery = useProductItemsQuery(
    isProductSupplier ? selectedSupplierId : null,
  );

  // ── Derived data (pure computations, no state) ────────────────────────────
  const suppliers = (suppliersQuery.data ?? []) as Supplier[];
  const balances = (balancesQuery.data ?? []) as SupplierBalance[];
  const productBalances = (productBalancesQuery.data ??
    []) as SupplierBalance[];
  const ledger = (ledgerQuery.data ?? []) as LedgerEntry[];
  const allTxns = (allTxnsQuery.data ?? []) as SupplierTxn[];
  const productItems = (productItemsQuery.data ?? []) as Array<{
    product_id: number;
    name: string;
    quantity: number;
    cost: number;
    total: number;
    created_at: string;
  }>;

  const sortedSuppliers = useMemo(
    () =>
      [...suppliers]
        .filter((s) => s.provider !== partnerSystem)
        .filter((s) =>
          viewCategory === "companies" ? s.is_system === 1 : s.is_system === 0,
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [suppliers, partnerSystem, viewCategory],
  );

  const balanceBySupplier = useMemo(() => {
    const map = new Map<number, SupplierBalance>();
    for (const b of balances) map.set(b.supplier_id, b);
    return map;
  }, [balances]);

  const productBalanceBySupplier = useMemo(() => {
    const map = new Map<number, SupplierBalance>();
    for (const b of productBalances) map.set(b.supplier_id, b);
    return map;
  }, [productBalances]);

  // Use the right balance source depending on which tab we're viewing
  const activeBalanceMap =
    viewCategory === "products" ? productBalanceBySupplier : balanceBySupplier;

  const totalOwed = useMemo(() => {
    let usd = 0;
    let lbp = 0;
    for (const s of sortedSuppliers) {
      if (s.is_active === 0) continue;
      const b = activeBalanceMap.get(s.id);
      if (b) {
        usd += Number(b.total_usd || 0);
        lbp += Number(b.total_lbp || 0);
      }
    }
    return { usd, lbp };
  }, [sortedSuppliers, activeBalanceMap]);

  const hasOmtFee = useMemo(
    () => allTxns.some((t) => t.omt_fee != null && t.omt_fee > 0),
    [allTxns],
  );

  /**
   * Suggested amount, currency, and default PAY/RECEIVE direction for the Pay/Receive tab.
   *
   * Products → inventory total (Σ qty × cost), always USD. Direction = PAY (we always owe).
   *
   * Companies — three cases:
   *   Pure USD balance → USD amount, direction from sign.
   *   Pure LBP balance → LBP amount, direction from sign.
   *   Mixed (e.g. we owe LBP + supplier owes us USD) →
   *     netUsd = total_lbp / exchangeRate + total_usd  (user's formula)
   *     currency = USD, direction from sign of netUsd.
   *
   * Positive amount = we owe the supplier → PAY.
   * Negative amount = supplier owes us   → RECEIVE (form receives |amount|).
   */
  const { payAmount, payCurrency, defaultDirection } = useMemo<{
    payAmount: number;
    payCurrency: "USD" | "LBP";
    defaultDirection: "PAY" | "RECEIVE";
  }>(() => {
    if (isProductSupplier) {
      const bal = activeBalanceMap.get(selectedSupplierId ?? 0);
      const owed = Math.max(0, Number(bal?.total_usd ?? 0));
      return { payAmount: owed, payCurrency: "USD", defaultDirection: "PAY" };
    }
    const bal = activeBalanceMap.get(selectedSupplierId ?? 0);
    const usd = Number(bal?.total_usd ?? 0);
    const lbp = Number(bal?.total_lbp ?? 0);
    const hasUsd = Math.abs(usd) > BALANCE_EPS;
    const hasLbp = Math.abs(lbp) > 0.5;

    if (hasLbp && hasUsd) {
      // Mixed currencies: collapse to USD net using exchange rate
      const netUsd = lbp / exchangeRate + usd;
      return {
        payAmount: netUsd,
        payCurrency: "USD",
        defaultDirection: netUsd >= 0 ? "PAY" : "RECEIVE",
      };
    }
    if (hasLbp) {
      return {
        payAmount: lbp,
        payCurrency: "LBP",
        defaultDirection: lbp >= 0 ? "PAY" : "RECEIVE",
      };
    }
    return {
      payAmount: usd,
      payCurrency: "USD",
      defaultDirection: usd >= 0 ? "PAY" : "RECEIVE",
    };
  }, [
    isProductSupplier,
    productItems,
    activeBalanceMap,
    selectedSupplierId,
    exchangeRate,
  ]);

  // FIFO payment coverage per product item.
  // totalPaid = totalProductCosts − currentBalance (balance = costs − payments).
  const itemsWithCoverage = useMemo(() => {
    if (!isProductSupplier || productItems.length === 0) return [];
    const bal = activeBalanceMap.get(selectedSupplierId ?? 0);
    const currentBalanceUsd = Math.max(0, Number(bal?.total_usd ?? 0));
    const totalProductCosts = productItems.reduce((s, i) => s + i.total, 0);
    const totalPaid = Math.max(0, totalProductCosts - currentBalanceUsd);

    let remaining = totalPaid;
    return productItems.map((item) => {
      if (remaining >= item.total - 0.005) {
        remaining = Math.max(0, remaining - item.total);
        return { ...item, paid: item.total, status: "PAID" as const };
      } else if (remaining > 0.005) {
        const paid = remaining;
        remaining = 0;
        return { ...item, paid, status: "PARTIAL" as const };
      } else {
        return { ...item, paid: 0, status: "UNPAID" as const };
      }
    });
  }, [isProductSupplier, productItems, activeBalanceMap, selectedSupplierId]);

  // Auto-set PAY/RECEIVE direction whenever the Pay/Receive tab becomes active
  // or the selected supplier changes. The user can still override it manually.
  useEffect(() => {
    if (activeTab === "manual") {
      setCashflowDirection(defaultDirection);
    }
  }, [activeTab, selectedSupplierId, defaultDirection]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleCashflow = async () => {
    if (!selectedSupplierId) return;
    const activeLines = cashflowLines.filter((l) => l.amount > 0);
    if (activeLines.length === 0) {
      alert("Enter at least one payment amount");
      return;
    }
    const trimmedNote = cashflowNote.trim();
    const res = await supplierCashflow.mutateAsync({
      supplier_id: selectedSupplierId,
      direction: cashflowDirection,
      payments: activeLines.map((p) => ({
        method: p.method,
        currency_code: p.currencyCode,
        amount: p.amount,
      })),
      exchange_rate: exchangeRate,
      // Omit `note` entirely when empty (exactOptionalPropertyTypes: the field is
      // `note?: string`, so it must be absent rather than explicitly undefined).
      ...(trimmedNote ? { note: trimmedNote } : {}),
    });
    if (!(res as { success: boolean }).success) {
      alert((res as { error?: string }).error || "Failed");
      return;
    }
    setCashflowLines([]);
    setCashflowNote("");
    setCashflowKey((k) => k + 1);
  };

  const supplierCashflow = useSupplierCashflowMutation(
    selectedSupplierId,
    selectedSupplier?.provider ?? null,
  );

  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 flex flex-col gap-6 overflow-auto animate-in fade-in duration-500">
      <PageHeader
        icon={Truck}
        title="Suppliers"
        subtitle="Track amounts owed to suppliers. System debts are auto-recorded from transactions."
      />

      {/* Balance overview */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-4">
          <div className="text-xs text-slate-400 mb-1">Total Owed (USD)</div>
          <div
            className={`text-2xl font-bold font-mono ${totalOwed.usd < 0 ? "text-green-400" : "text-red-400"}`}
          >
            ${totalOwed.usd.toFixed(2)}
          </div>
        </div>
        <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-4">
          <div className="text-xs text-slate-400 mb-1">Total Owed (LBP)</div>
          <div
            className={`text-2xl font-bold font-mono ${totalOwed.lbp < 0 ? "text-green-400" : "text-red-400"}`}
          >
            {totalOwed.lbp.toLocaleString()} LBP
          </div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
        {/* Left: Supplier list */}
        <div className="col-span-4 bg-slate-800 rounded-xl border border-slate-700/50 p-4 overflow-auto">
          <div className="flex gap-1 border-b border-slate-700/50 pb-2 mb-3">
            {(
              [
                { id: "companies" as const, label: "Companies" },
                { id: "products" as const, label: "Products" },
              ] as const
            ).map((cat) => (
              <button
                key={cat.id}
                onClick={() => {
                  setViewCategory(cat.id);
                  setSelectedSupplierId(null);
                  setActiveTab(cat.id === "products" ? "items" : "settle");
                }}
                className={`px-4 py-1.5 text-xs font-semibold rounded-t transition-colors ${
                  viewCategory === cat.id
                    ? "text-white border-b-2 border-orange-500"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
          <div className="space-y-1">
            {sortedSuppliers.map((s) => {
              const b = activeBalanceMap.get(s.id);
              const active = s.id === selectedSupplierId;
              const drawer = s.provider
                ? PROVIDER_DRAWER[s.provider]
                : undefined;
              return (
                <button
                  key={s.id}
                  onClick={() => {
                    setSelectedSupplierId(s.id);
                    setActiveTab(
                      viewCategory === "products" ? "items" : "settle",
                    );
                  }}
                  className={`w-full text-left p-3 rounded-lg transition-colors ${
                    active ? "bg-slate-700" : "hover:bg-slate-700/50"
                  } ${s.is_active === 0 ? "opacity-60" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white">{s.name}</span>
                      {s.is_active === 0 && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-900/50 text-amber-300">
                          Inactive
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {drawer && (
                        <span className="text-[10px] text-slate-500 font-mono">
                          {drawer}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 text-xs font-mono">
                    <span className={balanceColor(Number(b?.total_usd || 0))}>
                      ${Number(b?.total_usd || 0).toFixed(2)}
                    </span>
                    <span className="text-slate-600"> | </span>
                    <span className={balanceColor(Number(b?.total_lbp || 0))}>
                      {Number(b?.total_lbp || 0).toLocaleString()} LBP
                    </span>
                  </div>
                </button>
              );
            })}
            {sortedSuppliers.length === 0 && (
              <div className="text-slate-500 text-sm p-3">
                No suppliers found.
              </div>
            )}
          </div>
        </div>

        {/* Right: Tabbed panel */}
        <div className="col-span-8 bg-slate-800 rounded-xl border border-slate-700/50 p-4 overflow-auto">
          {!selectedSupplier ? (
            <div className="text-slate-400 text-sm">
              Select a supplier to view ledger.
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-white font-bold text-lg">
                    {selectedSupplier.name}
                  </div>
                  <div className="text-xs text-slate-400 font-mono mt-0.5">
                    {(() => {
                      const bal = activeBalanceMap.get(selectedSupplierId!);
                      const usd = Number(bal?.total_usd ?? 0);
                      const lbp = Number(bal?.total_lbp ?? 0);
                      const usdInfo = describeBalance(usd, "USD");
                      const lbpInfo = describeBalance(lbp, "LBP");
                      const settled =
                        Math.abs(usd) <= BALANCE_EPS &&
                        Math.abs(lbp) <= BALANCE_EPS;
                      return (
                        <>
                          Balance:{" "}
                          {settled ? (
                            <span className="font-semibold text-slate-400">
                              Settled
                            </span>
                          ) : (
                            <>
                              {Math.abs(usd) > BALANCE_EPS && (
                                <span
                                  className={`font-semibold ${usdInfo.cls}`}
                                >
                                  {usdInfo.text}
                                </span>
                              )}
                              {Math.abs(usd) > BALANCE_EPS &&
                                Math.abs(lbp) > BALANCE_EPS && (
                                  <span className="text-slate-600"> · </span>
                                )}
                              {Math.abs(lbp) > BALANCE_EPS && (
                                <span
                                  className={`font-semibold ${lbpInfo.cls}`}
                                >
                                  {lbpInfo.text}
                                </span>
                              )}
                            </>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
                <button
                  onClick={() => {
                    suppliersQuery.refetch();
                    balancesQuery.refetch();
                    productBalancesQuery.refetch();
                    ledgerQuery.refetch();
                    if (!isProductSupplier) allTxnsQuery.refetch();
                    if (isProductSupplier) productItemsQuery.refetch();
                  }}
                  className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm"
                >
                  Refresh
                </button>
              </div>

              {/* Tabs */}
              {selectedSupplier.is_active !== 0 && (
                <div className="flex gap-1 mb-4 border-b border-slate-700">
                  {(isProductSupplier
                    ? [
                        { id: "items" as const, label: "Purchases" },
                        { id: "manual" as const, label: "Pay / Receive" },
                      ]
                    : [
                        {
                          id: "settle" as const,
                          label: `Transactions${allTxns.length > 0 ? ` (${allTxns.length})` : ""}`,
                        },
                        { id: "manual" as const, label: "Pay / Receive" },
                      ]
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                        activeTab === tab.id
                          ? "bg-slate-700 text-white border-b-2 border-blue-500"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Tab: Purchases — product items with FIFO payment coverage */}
              {selectedSupplier.is_active !== 0 && activeTab === "items" && (
                <div>
                  {productItemsQuery.isLoading ? (
                    <div className="text-slate-400 text-sm py-6 text-center">
                      Loading items…
                    </div>
                  ) : itemsWithCoverage.length === 0 ? (
                    <div className="text-slate-500 text-sm py-6 text-center">
                      No inventory items found for {selectedSupplier.name}.
                    </div>
                  ) : (
                    <div className="border border-slate-700 rounded-xl overflow-hidden">
                      <div className="grid grid-cols-12 bg-slate-900/60 text-slate-300 text-xs font-semibold px-4 py-2">
                        <div className="col-span-3">Product</div>
                        <div className="col-span-1 text-right">Qty</div>
                        <div className="col-span-2 text-right">Cost</div>
                        <div className="col-span-1 text-right">Total</div>
                        <div className="col-span-1 text-right">Paid</div>
                        <div className="col-span-2 text-right">Status</div>
                        <div className="col-span-2 text-right">Date</div>
                      </div>
                      <div className="max-h-[45vh] overflow-y-auto divide-y divide-slate-700">
                        {itemsWithCoverage.map((item) => (
                          <div
                            key={item.product_id}
                            className="grid grid-cols-12 px-4 py-2.5 text-sm items-center hover:bg-slate-700/30"
                          >
                            <div className="col-span-3 text-white font-medium truncate">
                              {item.name}
                            </div>
                            <div className="col-span-1 text-right font-mono text-slate-300">
                              {item.quantity}
                            </div>
                            <div className="col-span-2 text-right font-mono text-slate-300">
                              ${item.cost.toFixed(2)}
                            </div>
                            <div className="col-span-1 text-right font-mono text-orange-300 font-semibold">
                              ${item.total.toFixed(2)}
                            </div>
                            <div className="col-span-1 text-right font-mono text-slate-300 text-xs">
                              ${item.paid.toFixed(2)}
                            </div>
                            <div className="col-span-2 text-right">
                              {item.status === "PAID" && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                                  Paid
                                </span>
                              )}
                              {item.status === "PARTIAL" && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/20">
                                  Partial
                                </span>
                              )}
                              {item.status === "UNPAID" && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-700 text-slate-400 border border-slate-600">
                                  Unpaid
                                </span>
                              )}
                            </div>
                            <div className="col-span-2 text-right text-xs text-slate-400">
                              {item.created_at
                                ? new Date(item.created_at).toLocaleString()
                                : "—"}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between px-4 py-2.5 bg-slate-900/40 border-t border-slate-700 text-xs text-slate-400">
                        <span>
                          {
                            itemsWithCoverage.filter((i) => i.status === "PAID")
                              .length
                          }{" "}
                          paid ·{" "}
                          {
                            itemsWithCoverage.filter(
                              (i) => i.status === "PARTIAL",
                            ).length
                          }{" "}
                          partial ·{" "}
                          {
                            itemsWithCoverage.filter(
                              (i) => i.status === "UNPAID",
                            ).length
                          }{" "}
                          unpaid
                        </span>
                        <span className="font-mono font-bold text-white">
                          Outstanding: $
                          {itemsWithCoverage
                            .reduce((s, i) => s + (i.total - i.paid), 0)
                            .toFixed(2)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Tab: Transactions (full history, read-only) */}
              {selectedSupplier.is_active !== 0 && activeTab === "settle" && (
                <div className="space-y-3">
                  {allTxnsQuery.isLoading ? (
                    <div className="text-slate-400 text-sm py-6 text-center">
                      Loading transactions…
                    </div>
                  ) : allTxns.length === 0 ? (
                    <div className="text-slate-500 text-sm py-6 text-center">
                      No transactions found for {selectedSupplier.name}
                    </div>
                  ) : (
                    <div className="border border-slate-700 rounded-xl overflow-hidden">
                      <div className="grid grid-cols-12 gap-2 bg-slate-900/60 text-slate-300 text-xs font-semibold px-3 py-2">
                        <div
                          className={hasOmtFee ? "col-span-2" : "col-span-3"}
                        >
                          Type
                        </div>
                        <div
                          className={`${hasOmtFee ? "col-span-2" : "col-span-3"} text-right`}
                        >
                          Amount
                        </div>
                        {hasOmtFee && (
                          <div className="col-span-2 text-right">OMT Fee</div>
                        )}
                        <div className="col-span-2 text-right">Commission</div>
                        <div className="col-span-2 text-right">Status</div>
                        <div className="col-span-2">Date</div>
                      </div>
                      <div className="max-h-[40vh] overflow-y-auto">
                        {allTxns.map((t) => (
                          <div
                            key={t.id}
                            className="grid grid-cols-12 gap-2 px-3 py-2.5 text-sm border-t border-slate-700 items-center hover:bg-slate-700/30"
                          >
                            <div
                              className={`${hasOmtFee ? "col-span-2" : "col-span-3"} text-xs text-slate-300`}
                            >
                              {t.omt_service_type || t.service_type}
                            </div>
                            <div
                              className={`${hasOmtFee ? "col-span-2" : "col-span-3"} text-right font-mono text-white`}
                            >
                              {t.currency === "LBP"
                                ? `${Math.round(Math.abs(t.amount)).toLocaleString()} LBP`
                                : `$${Math.abs(t.amount).toFixed(2)}`}
                            </div>
                            {hasOmtFee && (
                              <div className="col-span-2 text-right font-mono text-amber-400">
                                {t.omt_fee ? `$${t.omt_fee.toFixed(2)}` : "—"}
                              </div>
                            )}
                            <div className="col-span-2 text-right font-mono text-emerald-400">
                              {t.commission > 0 ? (
                                t.currency === "LBP" ? (
                                  `${Math.round(t.commission).toLocaleString()} LBP`
                                ) : (
                                  `$${t.commission.toFixed(4)}`
                                )
                              ) : (
                                <span className="text-slate-600">—</span>
                              )}
                            </div>
                            <div className="col-span-2 text-right">
                              {t.settlement_id != null ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-900/50 text-blue-300">
                                  Settled
                                </span>
                              ) : t.fifo_status === "paid" ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-900/50 text-green-300">
                                  Paid
                                </span>
                              ) : t.fifo_status === "partial" ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-900/50 text-amber-300">
                                  Partial
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-900/50 text-red-400">
                                  Unpaid
                                </span>
                              )}
                            </div>
                            <div className="col-span-2 text-xs text-slate-400">
                              {new Date(t.created_at).toLocaleString()}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between px-4 py-2.5 bg-slate-900/40 border-t border-slate-700 text-xs text-slate-400">
                        <span>
                          {
                            allTxns.filter((t) => t.fifo_status === "paid")
                              .length
                          }{" "}
                          paid ·{" "}
                          {
                            allTxns.filter((t) => t.fifo_status === "partial")
                              .length
                          }{" "}
                          partial ·{" "}
                          {
                            allTxns.filter((t) => t.fifo_status === "unpaid")
                              .length
                          }{" "}
                          unpaid
                        </span>
                        <span className="font-mono font-bold text-white">
                          {(() => {
                            const outstandingUsd = allTxns
                              .filter((t) => t.currency !== "LBP")
                              .reduce((s, t) => {
                                const owed =
                                  t.service_type === "RECEIVE"
                                    ? Math.abs(t.amount) + t.commission
                                    : t.cost > 0
                                      ? t.cost
                                      : Math.abs(t.amount);
                                return s + Math.max(0, owed - t.fifo_paid_usd);
                              }, 0);
                            return outstandingUsd > 0
                              ? `Outstanding: $${outstandingUsd.toFixed(2)}`
                              : "Fully covered";
                          })()}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Tab: Pay / Receive */}
              {selectedSupplier.is_active !== 0 && activeTab === "manual" && (
                <div className="space-y-4">
                  {/* Direction toggle */}
                  <div className="flex gap-2">
                    {(["PAY", "RECEIVE"] as const).map((dir) => (
                      <button
                        key={dir}
                        onClick={() => setCashflowDirection(dir)}
                        className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                          cashflowDirection === dir
                            ? dir === "PAY"
                              ? "bg-red-600 text-white"
                              : "bg-green-600 text-white"
                            : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                        }`}
                      >
                        {dir === "PAY" ? "Pay Supplier" : "Supplier Paid Us"}
                      </button>
                    ))}
                  </div>

                  <MultiPaymentInput
                    key={`${cashflowKey}-${cashflowDirection}`}
                    totalAmount={Math.abs(payAmount)}
                    totalAmountCurrency={payCurrency}
                    currency={payCurrency}
                    onChange={setCashflowLines}
                    showPmFee={false}
                    showDiscount={false}
                    paymentMethods={methods}
                    currencies={[
                      { code: "USD", symbol: "$" },
                      { code: "LBP", symbol: "LBP" },
                    ]}
                    exchangeRate={exchangeRate}
                  />

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Note (optional)
                    </label>
                    <input
                      value={cashflowNote}
                      onChange={(e) => setCashflowNote(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
                      placeholder={
                        cashflowDirection === "PAY"
                          ? "Payment to supplier…"
                          : "Amount received from supplier…"
                      }
                    />
                  </div>

                  <div className="flex justify-end">
                    <button
                      onClick={handleCashflow}
                      disabled={supplierCashflow.isPending}
                      className={`px-6 py-2 rounded-lg text-white font-semibold transition-colors disabled:opacity-50 ${
                        cashflowDirection === "PAY"
                          ? "bg-red-600 hover:bg-red-500"
                          : "bg-green-600 hover:bg-green-500"
                      }`}
                    >
                      {supplierCashflow.isPending
                        ? "Processing…"
                        : cashflowDirection === "PAY"
                          ? "Record Payment"
                          : "Record Receipt"}
                    </button>
                  </div>
                </div>
              )}

              {/* Ledger history */}
              <div className="mt-6">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-1">
                  Payments
                </h3>
                <div className="border border-slate-700 rounded-xl overflow-hidden">
                  <div className="grid grid-cols-12 gap-2 bg-slate-900/60 text-slate-400 text-xs font-semibold px-3 py-2">
                    <div className="col-span-2">Type</div>
                    <div className="col-span-2 text-right">USD</div>
                    <div className="col-span-2 text-right">LBP</div>
                    <div className="col-span-4">Note</div>
                    <div className="col-span-2">Date</div>
                  </div>
                  <div className="max-h-[30vh] overflow-y-auto">
                    {ledger.map((row) => (
                      <div
                        key={row.id}
                        className="grid grid-cols-12 gap-2 px-3 py-2 text-sm border-t border-slate-700 items-center"
                      >
                        <div className="col-span-2 flex items-center gap-1">
                          <EntryTypeBadge type={row.entry_type} />
                        </div>
                        <div
                          className={`col-span-2 text-right font-mono ${row.amount_usd < 0 ? "text-green-400" : row.amount_usd > 0 ? "text-red-400" : "text-slate-500"}`}
                        >
                          {row.amount_usd !== 0
                            ? `${row.amount_usd > 0 ? "+" : ""}${row.amount_usd.toFixed(2)}`
                            : "—"}
                        </div>
                        <div
                          className={`col-span-2 text-right font-mono ${row.amount_lbp < 0 ? "text-green-400" : row.amount_lbp > 0 ? "text-red-400" : "text-slate-500"}`}
                        >
                          {row.amount_lbp !== 0
                            ? `${row.amount_lbp > 0 ? "+" : ""}${row.amount_lbp.toLocaleString()}`
                            : "—"}
                        </div>
                        <div className="col-span-4 text-slate-300 truncate text-xs">
                          {row.note || ""}
                        </div>
                        <div className="col-span-2 text-slate-400 text-xs">
                          {new Date(row.created_at).toLocaleString()}
                        </div>
                      </div>
                    ))}
                    {ledger.length === 0 && (
                      <div className="text-slate-500 text-sm p-3">
                        No payment entries yet.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
