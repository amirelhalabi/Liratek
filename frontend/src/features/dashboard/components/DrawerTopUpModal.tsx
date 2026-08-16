import { useState, useEffect } from "react";
import { X, PlusCircle, ArrowRightLeft, Plus, Landmark } from "lucide-react";
import { PRIMARY_CASH_DRAWER_NAMES } from "@liratek/core";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import { appEvents, DecimalInput, Select, useApi } from "@liratek/ui";
import { useShopBase } from "@/hooks/useShopBase";
import { useCurrencyContext } from "@/contexts/CurrencyContext";

interface SourceDrawer {
  drawer_name: string;
  balance_usd: number;
  balance_lbp: number;
}

interface AvailableCurrency {
  code: string;
  name: string;
  symbol?: string;
}

interface ExtraCurrencyRow {
  currency_code: string;
  amount: string;
}

type TopUpMode = "external" | "from_drawer" | "transfer";

/** Which way cash moves in Transfer mode — General <-> the primary cash
 *  drawer (OMT_System/Whish_System), both directions
 *  (Primary Cash Drawer plan §0 decision #12). */
type TransferDirection = "to_primary" | "to_general";

/** Routing decision for `PRIMARY_CASH_DRAWER_NAMES` (imported above from
 *  `@liratek/core` — single definition per CLAUDE.md rule 14, see
 *  `packages/core/src/constants/systemFloatDrawers.ts`). Owner-approved
 *  routing fix (LIRA-141 follow-up): General <-> either of these two names
 *  now goes through the reversible `transferBetweenDrawers` path in BOTH
 *  directions (previously only General -> primary went through it, via
 *  Transfer mode below — primary -> General, the "From Drawer" mode's only
 *  real-world case, still called the older non-reversible
 *  `drawerTopUp.createFromDrawer`). Any OTHER named source drawer keeps
 *  using `createFromDrawer` unchanged — that append-only, audit-trail-only
 *  move is a deliberately different use case
 *  (`DrawerTopUpRepository.createTopUpFromDrawer`'s own doc comment) and
 *  must not be rerouted.
 *
 *  Widened to `readonly string[]` here (the core export is a narrower `as
 *  const` literal tuple) so `.includes(selectedDrawer)` below — where
 *  `selectedDrawer` is a plain `string` — typechecks without casting. */
const primaryCashDrawerNames: readonly string[] = PRIMARY_CASH_DRAWER_NAMES;

function formatDrawerAmount(amount: number, currency: "USD" | "LBP"): string {
  return currency === "LBP"
    ? `${Math.round(amount).toLocaleString()} LBP`
    : `$${amount.toLocaleString()}`;
}

interface DrawerTopUpModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function DrawerTopUpModal({
  isOpen,
  onClose,
  onSuccess,
}: DrawerTopUpModalProps) {
  const api = useApi();
  useModalFocusFix(isOpen);
  const { getCurrenciesForDrawer } = useCurrencyContext();
  const [mode, setMode] = useState<TopUpMode>("external");
  const [amountUsd, setAmountUsd] = useState("");
  const [amountLbp, setAmountLbp] = useState("");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sourceDrawers, setSourceDrawers] = useState<SourceDrawer[]>([]);
  const [selectedDrawer, setSelectedDrawer] = useState("");
  const [extraCurrencies, setExtraCurrencies] = useState<ExtraCurrencyRow[]>(
    [],
  );
  const [availableExtraCurrencies, setAvailableExtraCurrencies] = useState<
    AvailableCurrency[]
  >([]);

  /**
   * Currencies offerable as an extra top-up leg: ONLY currencies explicitly
   * enabled for the General drawer (Settings → Currencies → "Drawer
   * Currencies"), minus USD/LBP which have dedicated inputs above.
   *
   * This MUST mirror the backend gate exactly. `DrawerTopUpService.addTopUp`
   * hard-rejects any `extra_currencies` entry whose code is not linked to the
   * General drawer via `currency_drawers` — offering shop-wide active
   * currencies or live-feed currencies (as a prior version did) let the
   * operator pick a currency, type an amount, and only then get rejected.
   * `getCurrenciesForDrawer` (CurrencyContext) is the same drawer-scoped
   * lookup the backend enforces, so what's offered here is exactly what will
   * be accepted.
   */
  useEffect(() => {
    if (!isOpen || mode !== "external") return;
    let cancelled = false;
    (async () => {
      const drawerCurrencies = await getCurrenciesForDrawer("General");
      if (cancelled) return;
      setAvailableExtraCurrencies(
        drawerCurrencies
          .filter((c) => c.code !== "USD" && c.code !== "LBP")
          .map((c) => ({ code: c.code, name: c.name, symbol: c.symbol })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, mode, getCurrenciesForDrawer]);

  // Transfer mode — General <-> the primary cash drawer (PCD), the shop's
  // OWN physical till at the money-transfer counter (Primary Cash Drawer
  // plan §1 — supersedes the PR #66 "fund the float" model: there is no
  // provider-side balance to fund, only cash moving between two of the
  // shop's own drawers). Bidirectional per owner decision #12; the PCD is
  // whichever of OMT_System/Whish_System is primary (shop_base_system).
  const { baseSystem } = useShopBase();
  const primaryDrawerName =
    baseSystem === "WHISH" ? "Whish_System" : "OMT_System";
  const primaryDrawerLabel =
    baseSystem === "WHISH" ? "Whish Cash Drawer" : "OMT Cash Drawer";
  const [transferDirection, setTransferDirection] =
    useState<TransferDirection>("to_primary");
  const [transferBalances, setTransferBalances] = useState<
    Record<string, Record<string, number>>
  >({});

  useEffect(() => {
    if (isOpen && mode === "from_drawer") {
      loadSourceDrawers();
    }
    if (isOpen && mode === "transfer") {
      loadTransferBalances();
    }
  }, [isOpen, mode]);

  async function loadSourceDrawers() {
    const result = await api.drawerTopUp.getSourceDrawers();
    if (result.success && result.data) {
      setSourceDrawers(result.data);
      if (result.data.length > 0 && !selectedDrawer) {
        setSelectedDrawer(result.data[0].drawer_name);
      }
    }
  }

  async function loadTransferBalances() {
    try {
      const balances = await api.getSystemExpectedBalancesDynamic();
      setTransferBalances(balances ?? {});
    } catch {
      setTransferBalances({});
    }
  }

  if (!isOpen) return null;

  function handleClose() {
    setAmountUsd("");
    setAmountLbp("");
    setNotes("");
    setMode("external");
    setSelectedDrawer("");
    setExtraCurrencies([]);
    setAvailableExtraCurrencies([]);
    setTransferDirection("to_primary");
    setTransferBalances({});
    onClose();
  }

  function addCurrencyRow() {
    const used = new Set(extraCurrencies.map((row) => row.currency_code));
    const next = availableExtraCurrencies.find((c) => !used.has(c.code));
    if (!next) return;
    setExtraCurrencies((prev) => [
      ...prev,
      { currency_code: next.code, amount: "" },
    ]);
  }

  function removeCurrencyRow(index: number) {
    setExtraCurrencies((prev) => prev.filter((_, i) => i !== index));
  }

  function updateCurrencyRow(index: number, patch: Partial<ExtraCurrencyRow>) {
    setExtraCurrencies((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  async function handleSubmit() {
    if (mode === "transfer") {
      await handleTransferSubmit();
      return;
    }

    const usd = parseFloat(amountUsd) || 0;
    const lbp = parseFloat(amountLbp) || 0;
    const extraLegs =
      mode === "external"
        ? extraCurrencies
            .filter(
              (row) => row.currency_code && (parseFloat(row.amount) || 0) > 0,
            )
            .map((row) => ({
              currency_code: row.currency_code,
              amount: parseFloat(row.amount) || 0,
            }))
        : [];

    if (usd <= 0 && lbp <= 0 && extraLegs.length === 0) {
      alert("Please enter at least one amount greater than 0.");
      return;
    }

    if (mode === "from_drawer" && !selectedDrawer) {
      alert("Please select a source drawer.");
      return;
    }

    setIsSubmitting(true);
    try {
      const trimmedNotes = notes.trim();

      let result;
      if (mode === "from_drawer") {
        // Primary-cash-drawer sources (OMT_System/Whish_System) route
        // through the generic, reversible transfer — the SAME call
        // handleTransferSubmit below makes for the opposite direction. Any
        // other named source drawer keeps the old, deliberately
        // non-reversible from-drawer top-up (see the routing decision
        // comment above `primaryCashDrawerNames`).
        result = primaryCashDrawerNames.includes(selectedDrawer)
          ? await api.transferBetweenDrawers({
              fromDrawer: selectedDrawer,
              toDrawer: "General",
              amount_usd: usd,
              amount_lbp: lbp,
              ...(trimmedNotes ? { notes: trimmedNotes } : {}),
            })
          : await api.drawerTopUp.createFromDrawer({
              amount_usd: usd,
              amount_lbp: lbp,
              source_drawer: selectedDrawer,
              ...(trimmedNotes ? { notes: trimmedNotes } : {}),
            });
      } else {
        result = await api.drawerTopUp.create({
          amount_usd: usd,
          amount_lbp: lbp,
          ...(trimmedNotes ? { notes: trimmedNotes } : {}),
          ...(extraLegs.length > 0 ? { extra_currencies: extraLegs } : {}),
        });
      }

      if (result.success) {
        appEvents.emit(
          "notification:show",
          "Drawer topped up successfully.",
          "success",
        );
        setAmountUsd("");
        setAmountLbp("");
        setNotes("");
        setExtraCurrencies([]);
        onSuccess();
      } else {
        alert(result.error ?? "Failed to top up drawer.");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleTransferSubmit() {
    const usd = parseFloat(amountUsd) || 0;
    const lbp = parseFloat(amountLbp) || 0;
    if (usd <= 0 && lbp <= 0) {
      alert("Please enter at least one amount greater than 0.");
      return;
    }

    const fromDrawer =
      transferDirection === "to_primary" ? "General" : primaryDrawerName;
    const toDrawer =
      transferDirection === "to_primary" ? primaryDrawerName : "General";

    setIsSubmitting(true);
    try {
      const trimmedNotes = notes.trim();
      // Primary Cash Drawer plan §8.6 — the generalized, reversible
      // General <-> PCD cash transfer that replaces the retired
      // one-directional "fund the system float" call.
      const result = await api.transferBetweenDrawers({
        fromDrawer,
        toDrawer,
        amount_usd: usd,
        amount_lbp: lbp,
        ...(trimmedNotes ? { notes: trimmedNotes } : {}),
      });

      if (result.success) {
        const parts = [
          usd > 0 ? formatDrawerAmount(usd, "USD") : null,
          lbp > 0 ? formatDrawerAmount(lbp, "LBP") : null,
        ].filter((v): v is string => v !== null);
        appEvents.emit(
          "notification:show",
          `${parts.join(" + ")} moved from ${fromDrawer.replace(/_/g, " ")} into ${toDrawer.replace(/_/g, " ")}.`,
          "success",
        );
        setAmountUsd("");
        setAmountLbp("");
        setNotes("");
        onSuccess();
      } else {
        alert(result.error ?? "Failed to transfer funds.");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const currentDrawer = sourceDrawers.find(
    (d) => d.drawer_name === selectedDrawer,
  );

  const transferFromDrawer =
    transferDirection === "to_primary" ? "General" : primaryDrawerName;
  const transferToDrawer =
    transferDirection === "to_primary" ? primaryDrawerName : "General";
  const transferUsdAmount = parseFloat(amountUsd) || 0;
  const transferLbpAmount = parseFloat(amountLbp) || 0;
  const transferFromBalanceUsd = transferBalances[transferFromDrawer]?.USD ?? 0;
  const transferFromBalanceLbp = transferBalances[transferFromDrawer]?.LBP ?? 0;
  const transferInsufficient =
    (transferUsdAmount > 0 && transferUsdAmount > transferFromBalanceUsd) ||
    (transferLbpAmount > 0 && transferLbpAmount > transferFromBalanceLbp);
  const transferPreviewAmounts = [
    transferUsdAmount > 0 ? formatDrawerAmount(transferUsdAmount, "USD") : null,
    transferLbpAmount > 0 ? formatDrawerAmount(transferLbpAmount, "LBP") : null,
  ].filter((v): v is string => v !== null);

  const modalTitle =
    mode === "transfer" ? "Transfer Drawer Cash" : "Top Up General Drawer";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-md bg-slate-800 border border-slate-700 rounded-xl shadow-2xl p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            {mode === "transfer" ? (
              <Landmark className="w-5 h-5 text-amber-400" />
            ) : (
              <PlusCircle className="w-5 h-5 text-emerald-400" />
            )}
            <h2 className="text-lg font-bold text-white">{modalTitle}</h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Mode Toggle */}
        <div className="flex gap-2 mb-5">
          <button
            onClick={() => setMode("external")}
            className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-colors ${
              mode === "external"
                ? "bg-emerald-600 text-white"
                : "bg-slate-700 text-slate-300 hover:bg-slate-600"
            }`}
          >
            External (Cash In)
          </button>
          <button
            onClick={() => setMode("from_drawer")}
            className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
              mode === "from_drawer"
                ? "bg-violet-600 text-white"
                : "bg-slate-700 text-slate-300 hover:bg-slate-600"
            }`}
          >
            <ArrowRightLeft size={14} />
            From Drawer
          </button>
          <button
            data-testid="drawer-transfer-mode-toggle"
            onClick={() => setMode("transfer")}
            className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
              mode === "transfer"
                ? "bg-amber-600 text-white"
                : "bg-slate-700 text-slate-300 hover:bg-slate-600"
            }`}
          >
            <Landmark size={14} />
            Transfer
          </button>
        </div>

        {mode === "transfer" ? (
          <div className="space-y-4">
            <p className="text-xs text-slate-400">
              Move physical cash between General and the {primaryDrawerLabel}—
              the shop&apos;s own till at the money-transfer counter. This moves
              cash between two of the shop&apos;s own drawers; it earns no
              profit.
            </p>

            {/* NEGATIVE-DRAWER PROMPT (owner decision 2026-08-01).
                Replaces the old hard block. Nothing in the system refuses a
                money movement any more — a drawer may go negative, which
                means cash was physically taken from somewhere else and the
                transfer was never recorded. A negative balance is therefore
                not an error state, it is an unrecorded transfer, and the fix
                is exactly one click: this panel names the drawer, the
                currency, and pre-fills the amount that brings it back to
                zero. Surfaced HERE (the move-money screen) because this is
                the only place the operator can act on it. */}
            {(() => {
              const negatives = Object.entries(transferBalances)
                .flatMap(([drawer, byCurrency]) =>
                  (["USD", "LBP"] as const)
                    .map((cur) => ({
                      drawer,
                      cur,
                      bal: byCurrency?.[cur] ?? 0,
                    }))
                    .filter((x) => x.bal < 0),
                )
                .sort((a, b) => a.bal - b.bal);
              if (negatives.length === 0) return null;
              return (
                <div
                  data-testid="drawer-negative-balance-panel"
                  className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 space-y-2"
                >
                  <p className="text-xs font-semibold text-red-300">
                    {negatives.length === 1
                      ? "A drawer is in the red"
                      : `${negatives.length} drawer balances are in the red`}
                  </p>
                  <p className="text-[11px] text-red-200/80">
                    Cash was paid out that the drawer did not hold — record the
                    move that covers it.
                  </p>
                  {negatives.map(({ drawer, cur, bal }) => (
                    <div
                      key={`${drawer}-${cur}`}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="text-xs text-slate-200">
                        {drawer.replace(/_/g, " ")}:{" "}
                        <span className="font-semibold text-red-300">
                          {cur === "USD"
                            ? `-$${Math.abs(bal).toFixed(2)}`
                            : `-${Math.abs(bal).toLocaleString()} LBP`}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          // Point the transfer AT the negative drawer and
                          // pre-fill exactly what clears it.
                          setTransferDirection(
                            drawer === "General" ? "to_general" : "to_primary",
                          );
                          if (cur === "USD")
                            setAmountUsd(String(Math.abs(bal)));
                          else setAmountLbp(String(Math.abs(bal)));
                        }}
                        className="shrink-0 text-[11px] font-medium px-2 py-1 rounded-md bg-red-500/20 text-red-200 hover:bg-red-500/30 transition-colors"
                      >
                        Cover it
                      </button>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Direction (bidirectional — owner decision #12) */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Direction
              </label>
              <div
                data-testid="drawer-transfer-direction-toggle"
                className="flex gap-2"
              >
                <button
                  type="button"
                  onClick={() => setTransferDirection("to_primary")}
                  className={`flex-1 py-2 px-3 text-xs font-medium rounded-lg transition-colors ${
                    transferDirection === "to_primary"
                      ? "bg-amber-600 text-white"
                      : "bg-slate-900 text-slate-400 border border-slate-700 hover:text-slate-200"
                  }`}
                >
                  General → {primaryDrawerLabel}
                </button>
                <button
                  type="button"
                  onClick={() => setTransferDirection("to_general")}
                  className={`flex-1 py-2 px-3 text-xs font-medium rounded-lg transition-colors ${
                    transferDirection === "to_general"
                      ? "bg-amber-600 text-white"
                      : "bg-slate-900 text-slate-400 border border-slate-700 hover:text-slate-200"
                  }`}
                >
                  {primaryDrawerLabel} → General
                </button>
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                {transferFromDrawer.replace(/_/g, " ")} balance:{" "}
                {formatDrawerAmount(transferFromBalanceUsd, "USD")} /{" "}
                {formatDrawerAmount(transferFromBalanceLbp, "LBP")}
              </p>
            </div>

            {/* USD Amount */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                USD Amount
              </label>
              <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg overflow-hidden focus-within:border-amber-500 transition-colors">
                <span className="px-3 text-sm text-slate-400 border-r border-slate-700">
                  $
                </span>
                <DecimalInput
                  value={parseFloat(amountUsd) || 0}
                  onChange={(n) => setAmountUsd(n ? String(n) : "")}
                  placeholder="0.00"
                  data-testid="drawer-transfer-amount-usd-input"
                  className="flex-1 bg-transparent px-3 py-2.5 text-sm text-white focus:outline-none placeholder:text-slate-600"
                />
              </div>
            </div>

            {/* LBP Amount */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                LBP Amount
              </label>
              <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg overflow-hidden focus-within:border-amber-500 transition-colors">
                <span className="px-3 text-sm text-slate-400 border-r border-slate-700">
                  LBP
                </span>
                <DecimalInput
                  value={parseFloat(amountLbp) || 0}
                  onChange={(n) => setAmountLbp(n ? String(n) : "")}
                  decimals={0}
                  placeholder="0"
                  data-testid="drawer-transfer-amount-lbp-input"
                  className="flex-1 bg-transparent px-3 py-2.5 text-sm text-white focus:outline-none placeholder:text-slate-600"
                />
              </div>
            </div>

            {transferInsufficient && (
              <p className="text-xs text-red-400">
                {transferFromDrawer.replace(/_/g, " ")} does not have enough
                funds for this transfer.
              </p>
            )}

            {/* Before-you-confirm preview — make the money movement unambiguous */}
            {transferPreviewAmounts.length > 0 && (
              <div
                data-testid="drawer-transfer-preview"
                className="bg-slate-900/60 border border-amber-500/30 rounded-lg px-3 py-2.5 text-xs text-slate-300 space-y-1"
              >
                {transferPreviewAmounts.map((amountLabel) => (
                  <p key={amountLabel}>
                    <span className="text-red-400 font-semibold">−</span>{" "}
                    {amountLabel} from{" "}
                    <span className="text-white font-medium">
                      {transferFromDrawer.replace(/_/g, " ")}
                    </span>
                    {" · "}
                    <span className="text-emerald-400 font-semibold">
                      +
                    </span>{" "}
                    {amountLabel} into{" "}
                    <span className="text-white font-medium">
                      {transferToDrawer.replace(/_/g, " ")}
                    </span>
                  </p>
                ))}
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Notes <span className="text-slate-600">(optional)</span>
              </label>
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add a note..."
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 placeholder:text-slate-600 resize-none transition-colors"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Source Drawer Selector (only in from_drawer mode) */}
            {mode === "from_drawer" && (
              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  Source Drawer
                </label>
                <Select
                  value={selectedDrawer}
                  onChange={(v) => setSelectedDrawer(v)}
                  options={
                    sourceDrawers.length === 0
                      ? [{ value: "", label: "No drawers available" }]
                      : sourceDrawers.map((d) => ({
                          value: d.drawer_name,
                          label: d.drawer_name.replace("_", " "),
                        }))
                  }
                  buttonClassName="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 transition-colors"
                />
                {currentDrawer && (
                  <p className="mt-1.5 text-xs text-slate-500">
                    Balance: ${currentDrawer.balance_usd.toLocaleString()} USD
                    {currentDrawer.balance_lbp > 0 &&
                      ` / ${currentDrawer.balance_lbp.toLocaleString()} LBP`}
                  </p>
                )}
              </div>
            )}

            {/* USD Amount */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                USD Amount
              </label>
              <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg overflow-hidden focus-within:border-violet-500 transition-colors">
                <span className="px-3 text-sm text-slate-400 border-r border-slate-700">
                  $
                </span>
                <DecimalInput
                  value={parseFloat(amountUsd) || 0}
                  onChange={(n) => setAmountUsd(n ? String(n) : "")}
                  placeholder="0.00"
                  className="flex-1 bg-transparent px-3 py-2.5 text-sm text-white focus:outline-none placeholder:text-slate-600"
                />
              </div>
            </div>

            {/* LBP Amount */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                LBP Amount
              </label>
              <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg overflow-hidden focus-within:border-violet-500 transition-colors">
                <span className="px-3 text-sm text-slate-400 border-r border-slate-700">
                  LBP
                </span>
                <DecimalInput
                  value={parseFloat(amountLbp) || 0}
                  onChange={(n) => setAmountLbp(n ? String(n) : "")}
                  placeholder="0"
                  className="flex-1 bg-transparent px-3 py-2.5 text-sm text-white focus:outline-none placeholder:text-slate-600"
                />
              </div>
            </div>

            {/* Extra currencies (External mode only) */}
            {mode === "external" && (
              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  Other Currencies{" "}
                  <span className="text-slate-600">(optional)</span>
                </label>

                {availableExtraCurrencies.length === 0 ? (
                  <p className="text-xs text-slate-500 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2.5">
                    No other currencies available — add one in Settings →
                    Currencies, or check the connection for the live list.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {extraCurrencies.map((row, index) => {
                      const usedElsewhere = new Set(
                        extraCurrencies
                          .filter((_, i) => i !== index)
                          .map((r) => r.currency_code),
                      );
                      const rowOptions = availableExtraCurrencies
                        .filter((c) => !usedElsewhere.has(c.code))
                        .map((c) => ({
                          value: c.code,
                          label: c.symbol ? `${c.code} (${c.symbol})` : c.code,
                        }));

                      return (
                        <div key={index} className="flex items-center gap-2">
                          <Select
                            value={row.currency_code}
                            onChange={(v) =>
                              updateCurrencyRow(index, { currency_code: v })
                            }
                            options={rowOptions}
                            className="w-28 shrink-0"
                            buttonClassName="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors"
                          />
                          <div className="flex-1 flex items-center bg-slate-900 border border-slate-700 rounded-lg overflow-hidden focus-within:border-emerald-500 transition-colors">
                            <DecimalInput
                              value={parseFloat(row.amount) || 0}
                              onChange={(n) =>
                                updateCurrencyRow(index, {
                                  amount: n ? String(n) : "",
                                })
                              }
                              placeholder="0.00"
                              className="flex-1 bg-transparent px-3 py-2.5 text-sm text-white focus:outline-none placeholder:text-slate-600"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => removeCurrencyRow(index)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                            aria-label="Remove currency"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      );
                    })}

                    <button
                      type="button"
                      onClick={addCurrencyRow}
                      disabled={
                        extraCurrencies.length >=
                        availableExtraCurrencies.length
                      }
                      className="flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 disabled:text-slate-600 disabled:cursor-not-allowed transition-colors"
                    >
                      <Plus size={14} />
                      Add currency
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Notes <span className="text-slate-600">(optional)</span>
              </label>
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add a note..."
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 placeholder:text-slate-600 resize-none transition-colors"
              />
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex gap-3 mt-6">
          <button
            onClick={handleClose}
            disabled={isSubmitting}
            className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            data-testid="drawer-topup-submit"
            onClick={handleSubmit}
            disabled={
              isSubmitting ||
              (mode === "transfer" &&
                !(transferUsdAmount > 0 || transferLbpAmount > 0))
            }
            className={`flex-1 py-2.5 ${
              mode === "transfer"
                ? "bg-amber-600 hover:bg-amber-500"
                : mode === "from_drawer"
                  ? "bg-violet-600 hover:bg-violet-500"
                  : "bg-emerald-600 hover:bg-emerald-500"
            } disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-semibold rounded-lg transition-colors`}
          >
            {isSubmitting
              ? "Processing..."
              : mode === "transfer"
                ? "Transfer"
                : mode === "from_drawer"
                  ? "Transfer"
                  : "Top Up"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default DrawerTopUpModal;
