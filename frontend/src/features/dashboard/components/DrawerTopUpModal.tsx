import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "@liratek/ui/i18n/format";
import { translateServerError } from "@liratek/ui/i18n/serverMessage";
import { Ltr } from "@liratek/ui/components/ui/Ltr";
import { X, PlusCircle, ArrowRightLeft, Plus, Landmark } from "lucide-react";
import {
  PRIMARY_CASH_DRAWER_NAMES,
  isDrawerVisible,
  isLotTrackedCurrency,
  marketRateToUsdPerUnit,
} from "@liratek/core";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import { appEvents, DecimalInput, Select, useApi } from "@liratek/ui";
import { useShopBase } from "@/hooks/useShopBase";
import { useExchangeCurrencyList } from "@/hooks/useExchangeCurrencyList";
import type { ExchangeRate } from "@/utils/currencyUtils";

interface SourceDrawer {
  drawer_name: string;
  balance_usd: number;
  balance_lbp: number;
}

interface ExtraCurrencyRow {
  currency_code: string;
  amount: string;
  /** EXCHANGE_LOT_SETTLEMENT.md Q3, refined 2026-08-23 (owner decision —
   *  "market rate by default"): USD per one unit of currency_code, entered
   *  ONLY when the operator opens the "edit" affordance below
   *  (`showRateOverride`). No longer required — the server resolves the
   *  cost basis hands-free (configured market rate, or the live-feed hint
   *  for a currency with no configured rate) unless this is set. */
  acquisitionRate: string;
  /** Whether the operator has revealed the manual override input for this
   *  row. Hands-free (false) by default. */
  showRateOverride: boolean;
}

/**
 * Where this row's cost basis will come from if the operator does not
 * override it — mirrors the server's own resolution order
 * (DrawerTopUpRepository.createTopUp): a configured `exchange_rates` row
 * wins over the live feed. `null` means neither is available — the operator
 * MUST use the edit link, or the server will reject with its own error.
 */
interface ResolvedBasis {
  usdPerUnit: number;
  /** True when there is no configured `exchange_rates` row for this
   *  currency — the basis comes from the live feed instead, and
   *  `market_usd_per_unit_hint` must be attached on submit. */
  isFeedOnly: boolean;
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
 *  move (its source debit journaled as a DRAWER_TRANSFER payments row since
 *  LIRA-258 G9/G33; the type stays non-reversible because older rows lack
 *  that leg) is a deliberately different use case
 *  (`DrawerTopUpRepository.createTopUpFromDrawer`'s own doc comment) and
 *  must not be rerouted.
 *
 *  Widened to `readonly string[]` here (the core export is a narrower `as
 *  const` literal tuple) so `.includes(selectedDrawer)` below — where
 *  `selectedDrawer` is a plain `string` — typechecks without casting. */
const primaryCashDrawerNames: readonly string[] = PRIMARY_CASH_DRAWER_NAMES;

function formatDrawerAmount(amount: number, currency: "USD" | "LBP"): string {
  return currency === "LBP"
    ? `${formatNumber(Math.round(amount))} LBP`
    : `$${formatNumber(amount)}`;
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
  const { t } = useTranslation("dashboard");
  const { t: tc } = useTranslation("common");
  useModalFocusFix(isOpen);
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

  /**
   * Currencies offerable as an extra top-up leg (AC1, EXCHANGE_LOT_SETTLEMENT.md
   * Q3 refinement, 2026-08-23): the SAME merged list the Exchange page offers
   * — configured currencies + the live FX feed — via the shared
   * `useExchangeCurrencyList` hook, rather than a drawer-scoped allowlist.
   * The server now auto-registers an unknown code (mirroring
   * `ExchangeRepository.ensureCurrency`) before opening its exchange lot, so
   * offering exactly what Exchange offers no longer risks "pick a currency,
   * type an amount, get rejected" — see DrawerTopUpRepository.createTopUp's
   * lot-creation block and DrawerTopUpService.addTopUp's updated doc comment.
   *
   * Gated off (`enabled = isOpen && mode === "external"`): this modal stays
   * mounted under the Dashboard whether or not it's open, and only External
   * (Cash In) mode ever shows the extra-currency picker — no reason to hit
   * the live feed otherwise.
   */
  const { options: currencyOptions, liveCurrencyRates } =
    useExchangeCurrencyList(isOpen && mode === "external");

  // Configured `exchange_rates` rows — the basis line's primary source
  // (AC2: "configured currencies: from api.getRates() market_rate,
  // orientation-normalized for display the same way the server will").
  // Fetched only in External mode, same gating as the currency list above.
  const [rateRows, setRateRows] = useState<ExchangeRate[]>([]);
  useEffect(() => {
    if (!isOpen || mode !== "external") return;
    let cancelled = false;
    (async () => {
      try {
        const list = (await api.getRates()) as ExchangeRate[];
        if (!cancelled) setRateRows(list);
      } catch {
        if (!cancelled) setRateRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mode]);

  /**
   * Resolve what this currency's cost basis WOULD be if the operator does
   * not override it — mirrors the server's own resolution order exactly
   * (DrawerTopUpRepository.createTopUp, step 2 then step 3): a configured
   * `exchange_rates` row wins over the live feed; `null` means neither
   * exists, so the operator must use the edit link or the server will
   * reject with its own "no cost basis available" error.
   */
  function resolveBasis(currencyCode: string): ResolvedBasis | null {
    const configured = rateRows.find((r) => r.to_code === currencyCode);
    if (configured) {
      return {
        usdPerUnit: marketRateToUsdPerUnit(
          configured.market_rate,
          configured.is_stronger,
        ),
        isFeedOnly: false,
      };
    }
    const fed = liveCurrencyRates.find((r) => r.to_code === currencyCode);
    if (fed) {
      return {
        usdPerUnit: marketRateToUsdPerUnit(fed.market_rate, fed.is_stronger),
        isFeedOnly: true,
      };
    }
    return null;
  }

  function formatBasisRate(usdPerUnit: number): string {
    return formatNumber(usdPerUnit, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    });
  }

  // Transfer mode — General <-> the primary cash drawer (PCD), the shop's
  // OWN physical till at the money-transfer counter (Primary Cash Drawer
  // plan §1 — supersedes the PR #66 "fund the float" model: there is no
  // provider-side balance to fund, only cash moving between two of the
  // shop's own drawers). Bidirectional per owner decision #12; the PCD is
  // whichever of OMT_System/Whish_System is primary (shop_base_system).
  const { baseSystem, loading: baseSystemLoading } = useShopBase();
  const primaryDrawerName =
    baseSystem === "WHISH" ? "Whish_System" : "OMT_System";
  const primaryDrawerLabel = t("drawer.primaryLabel", {
    brand: baseSystem === "WHISH" ? "Whish" : "OMT",
  });
  /** A drawer name for display only — never sent to the server. */
  const drawerText = (name: string): string =>
    name === "General" ? t("drawer.generalName") : name.replace(/_/g, " ");
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
      // The other system's cash drawer is only offered while it holds money
      // (so leftovers can be moved to General); empty, the shop has no such
      // physical drawer.
      const offered = result.data.filter((d) =>
        isDrawerVisible(d.drawer_name, () => true, {
          baseSystem: baseSystemLoading ? null : baseSystem,
          balances: { USD: d.balance_usd, LBP: d.balance_lbp },
        }),
      );
      setSourceDrawers(offered);
      if (offered.length > 0 && !selectedDrawer) {
        setSelectedDrawer(offered[0].drawer_name);
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
    setTransferDirection("to_primary");
    setTransferBalances({});
    onClose();
  }

  function addCurrencyRow() {
    const used = new Set(extraCurrencies.map((row) => row.currency_code));
    const next = currencyOptions.find((c) => !used.has(c.code));
    if (!next) return;
    setExtraCurrencies((prev) => [
      ...prev,
      {
        currency_code: next.code,
        amount: "",
        acquisitionRate: "",
        showRateOverride: false,
      },
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
    // AC2 (2026-08-23 refinement) — hands-free by default. Per row:
    //  - `acquisition_usd_per_unit` is sent ONLY when the operator opened the
    //    "edit" link and entered a value (`showRateOverride` + a positive
    //    rate) — never merely because a value happens to be typed in a
    //    hidden field.
    //  - `market_usd_per_unit_hint` is auto-attached ONLY for a feed-only
    //    currency (no configured `exchange_rates` row) — the server ignores
    //    it whenever it has its own configured rate, so attaching it
    //    unconditionally for a feed-only row is safe even alongside an
    //    operator override (override always wins server-side).
    const extraLegs =
      mode === "external"
        ? extraCurrencies
            .filter(
              (row) => row.currency_code && (parseFloat(row.amount) || 0) > 0,
            )
            .map((row) => {
              const acquisitionRate = parseFloat(row.acquisitionRate) || 0;
              const basis = resolveBasis(row.currency_code);
              return {
                currency_code: row.currency_code,
                amount: parseFloat(row.amount) || 0,
                ...(row.showRateOverride && acquisitionRate > 0
                  ? { acquisition_usd_per_unit: acquisitionRate }
                  : {}),
                ...(basis?.isFeedOnly
                  ? { market_usd_per_unit_hint: basis.usdPerUnit }
                  : {}),
              };
            })
        : [];

    if (usd <= 0 && lbp <= 0 && extraLegs.length === 0) {
      alert(t("drawer.amountRequired"));
      return;
    }

    // EXCHANGE_LOT_SETTLEMENT.md Q3, refined 2026-08-23 — a lot-tracked
    // (non-USD/LBP) row no longer REQUIRES an operator-entered rate (the
    // server falls back to the configured market rate or the feed hint
    // above), but it still needs SOME cost basis: an override, or a
    // resolvable market/feed rate. Caught here for a friendlier message than
    // the repository's throw.
    const missingBasis = extraLegs.find((leg) => {
      if (!isLotTrackedCurrency(leg.currency_code)) return false;
      const hasOverride = (leg.acquisition_usd_per_unit ?? 0) > 0;
      if (hasOverride) return false;
      return resolveBasis(leg.currency_code) === null;
    });
    if (missingBasis) {
      alert(t("topup.noMarketRate", { code: missingBasis.currency_code }));
      return;
    }

    if (mode === "from_drawer" && !selectedDrawer) {
      alert(t("topup.selectSource"));
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
          t("topup.success"),
          "success",
        );
        setAmountUsd("");
        setAmountLbp("");
        setNotes("");
        setExtraCurrencies([]);
        onSuccess();
      } else {
        alert(translateServerError(result, t, t("topup.failed")));
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : t("drawer.unexpectedError"));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleTransferSubmit() {
    const usd = parseFloat(amountUsd) || 0;
    const lbp = parseFloat(amountLbp) || 0;
    if (usd <= 0 && lbp <= 0) {
      alert(t("drawer.amountRequired"));
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
          t("transfer.success", {
            amounts: parts.join(" + "),
            from: drawerText(fromDrawer),
            to: drawerText(toDrawer),
          }),
          "success",
        );
        setAmountUsd("");
        setAmountLbp("");
        setNotes("");
        onSuccess();
      } else {
        alert(translateServerError(result, t, t("transfer.failed")));
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : t("drawer.unexpectedError"));
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
    mode === "transfer" ? t("transfer.title") : t("topup.title");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-md max-h-[90vh] bg-slate-800 border border-slate-700 rounded-xl shadow-2xl flex flex-col">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-6 pt-6 pb-5">
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

        {/* Body (scrolls) */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
        {/* Mode Toggle */}
        <div className="flex gap-2 mb-5">
          <button
            data-testid="drawer-external-mode-toggle"
            onClick={() => setMode("external")}
            className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-colors ${
              mode === "external"
                ? "bg-emerald-600 text-white"
                : "bg-slate-700 text-slate-300 hover:bg-slate-600"
            }`}
          >
            {t("topup.modeExternal")}
          </button>
          <button
            data-testid="drawer-from-drawer-mode-toggle"
            onClick={() => setMode("from_drawer")}
            className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
              mode === "from_drawer"
                ? "bg-violet-600 text-white"
                : "bg-slate-700 text-slate-300 hover:bg-slate-600"
            }`}
          >
            <ArrowRightLeft size={14} />
            {t("topup.modeFromDrawer")}
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
            {t("topup.modeTransfer")}
          </button>
        </div>

        {mode === "transfer" ? (
          <div className="space-y-4">
            <p className="text-xs text-slate-400">
              {t("transfer.intro", { label: primaryDrawerLabel })}
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
                      ? t("transfer.negativeOne")
                      : t("transfer.negativeMany", { n: negatives.length })}
                  </p>
                  <p className="text-[11px] text-red-200/80">
                    {t("transfer.negativeHint")}
                  </p>
                  {negatives.map(({ drawer, cur, bal }) => (
                    <div
                      key={`${drawer}-${cur}`}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="text-xs text-slate-200">
                        {drawerText(drawer)}:{" "}
                        <Ltr className="font-semibold text-red-300">
                          {cur === "USD"
                            ? `-$${Math.abs(bal).toFixed(2)}`
                            : `-${formatNumber(Math.abs(bal))} LBP`}
                        </Ltr>
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
                        {t("transfer.coverIt")}
                      </button>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Direction (bidirectional — owner decision #12) */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                {t("transfer.direction")}
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
                  {t("transfer.directionArrow", {
                    from: t("drawer.generalName"),
                    to: primaryDrawerLabel,
                  })}
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
                  {t("transfer.directionArrow", {
                    from: primaryDrawerLabel,
                    to: t("drawer.generalName"),
                  })}
                </button>
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                {t("transfer.balanceLabel", {
                  drawer: drawerText(transferFromDrawer),
                })}{" "}
                <Ltr>{formatDrawerAmount(transferFromBalanceUsd, "USD")}</Ltr> /{" "}
                <Ltr>{formatDrawerAmount(transferFromBalanceLbp, "LBP")}</Ltr>
              </p>
            </div>

            {/* USD Amount */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                {t("drawer.usdAmount")}
              </label>
              <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg overflow-hidden focus-within:border-amber-500 transition-colors">
                <span className="px-3 text-sm text-slate-400 border-e border-slate-700">
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
                {t("drawer.lbpAmount")}
              </label>
              <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg overflow-hidden focus-within:border-amber-500 transition-colors">
                <span className="px-3 text-sm text-slate-400 border-e border-slate-700">
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
                {t("transfer.insufficient", {
                  drawer: drawerText(transferFromDrawer),
                })}
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
                    <Ltr>{amountLabel}</Ltr> {t("transfer.from")}{" "}
                    <span className="text-white font-medium">
                      {drawerText(transferFromDrawer)}
                    </span>
                    {" · "}
                    <span className="text-emerald-400 font-semibold">
                      +
                    </span>{" "}
                    <Ltr>{amountLabel}</Ltr> {t("transfer.into")}{" "}
                    <span className="text-white font-medium">
                      {drawerText(transferToDrawer)}
                    </span>
                  </p>
                ))}
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                {t("drawer.notes")}{" "}
                <span className="text-slate-600">{t("drawer.optional")}</span>
              </label>
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("drawer.addNote")}
                data-testid="drawer-transfer-notes-input"
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
                  {t("fromDrawer.source")}
                </label>
                <Select
                  value={selectedDrawer}
                  onChange={(v) => setSelectedDrawer(v)}
                  options={
                    sourceDrawers.length === 0
                      ? [{ value: "", label: t("fromDrawer.none") }]
                      : sourceDrawers.map((d) => ({
                          value: d.drawer_name,
                          label: d.drawer_name.replace("_", " "),
                        }))
                  }
                  buttonClassName="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 transition-colors"
                />
                {currentDrawer && (
                  <p className="mt-1.5 text-xs text-slate-500">
                    {t("fromDrawer.balance")}{" "}
                    <Ltr>
                      ${formatNumber(currentDrawer.balance_usd)} USD
                      {currentDrawer.balance_lbp > 0 &&
                        ` / ${formatNumber(currentDrawer.balance_lbp)} LBP`}
                    </Ltr>
                  </p>
                )}
              </div>
            )}

            {/* USD Amount */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                {t("drawer.usdAmount")}
              </label>
              <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg overflow-hidden focus-within:border-violet-500 transition-colors">
                <span className="px-3 text-sm text-slate-400 border-e border-slate-700">
                  $
                </span>
                <DecimalInput
                  value={parseFloat(amountUsd) || 0}
                  onChange={(n) => setAmountUsd(n ? String(n) : "")}
                  placeholder="0.00"
                  data-testid="drawer-topup-amount-usd-input"
                  className="flex-1 bg-transparent px-3 py-2.5 text-sm text-white focus:outline-none placeholder:text-slate-600"
                />
              </div>
            </div>

            {/* LBP Amount */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                {t("drawer.lbpAmount")}
              </label>
              <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg overflow-hidden focus-within:border-violet-500 transition-colors">
                <span className="px-3 text-sm text-slate-400 border-e border-slate-700">
                  LBP
                </span>
                <DecimalInput
                  value={parseFloat(amountLbp) || 0}
                  onChange={(n) => setAmountLbp(n ? String(n) : "")}
                  placeholder="0"
                  data-testid="drawer-topup-amount-lbp-input"
                  className="flex-1 bg-transparent px-3 py-2.5 text-sm text-white focus:outline-none placeholder:text-slate-600"
                />
              </div>
            </div>

            {/* Extra currencies (External mode only) */}
            {mode === "external" && (
              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  {t("topup.otherCurrencies")}{" "}
                  <span className="text-slate-600">{t("drawer.optional")}</span>
                </label>

                {currencyOptions.length === 0 ? (
                  <p className="text-xs text-slate-500 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2.5">
                    {t("topup.noOtherCurrencies")}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {extraCurrencies.map((row, index) => {
                      const usedElsewhere = new Set(
                        extraCurrencies
                          .filter((_, i) => i !== index)
                          .map((r) => r.currency_code),
                      );
                      const rowOptions = currencyOptions
                        .filter((c) => !usedElsewhere.has(c.code))
                        .map((c) => ({
                          value: c.code,
                          label: c.symbol ? `${c.code} (${c.symbol})` : c.code,
                        }));

                      // EXCHANGE_LOT_SETTLEMENT.md Q3 — always true today
                      // (USD/LBP have dedicated inputs above and never reach
                      // `currencyOptions`), kept explicit rather than assumed
                      // so the field tracks the real policy if that ever
                      // changes.
                      const needsAcquisitionRate = isLotTrackedCurrency(
                        row.currency_code,
                      );
                      const basis = row.currency_code
                        ? resolveBasis(row.currency_code)
                        : null;

                      return (
                        <div key={index} className="space-y-1.5">
                          <div className="flex items-center gap-2">
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
                                data-testid={`drawer-topup-currency-amount-${index}`}
                                className="flex-1 bg-transparent px-3 py-2.5 text-sm text-white focus:outline-none placeholder:text-slate-600"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => removeCurrencyRow(index)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                              aria-label={t("topup.removeCurrency")}
                            >
                              <X size={16} />
                            </button>
                          </div>

                          {/* AC2 (2026-08-23 refinement) — hands-free by
                            default: a quiet basis line + an "edit" link,
                            instead of an always-visible rate input. Clicking
                            "edit" reveals the manual-override input (same
                            shape as before), which now overrides rather than
                            establishes the basis. */}
                          {needsAcquisitionRate &&
                            (!row.showRateOverride ? (
                              <div className="ps-1 flex items-center justify-between gap-2">
                                <span
                                  data-testid={`drawer-topup-basis-line-${index}`}
                                  className="text-[11px] text-slate-500"
                                >
                                  {basis
                                    ? t("topup.basisLine", {
                                        rate: formatBasisRate(basis.usdPerUnit),
                                        code:
                                          row.currency_code || t("topup.unit"),
                                      })
                                    : t("topup.basisMissing", {
                                        code:
                                          row.currency_code ||
                                          t("topup.thisCurrency"),
                                      })}
                                </span>
                                <button
                                  type="button"
                                  data-testid={`drawer-topup-basis-edit-${index}`}
                                  onClick={() =>
                                    updateCurrencyRow(index, {
                                      showRateOverride: true,
                                    })
                                  }
                                  className="shrink-0 text-[11px] font-medium text-emerald-400 hover:text-emerald-300 transition-colors"
                                >
                                  {t("topup.edit")}
                                </button>
                              </div>
                            ) : (
                              <div className="ps-1">
                                <label className="text-[11px] text-slate-500 block mb-1">
                                  {t("topup.acquisitionRate", {
                                    code: row.currency_code || t("topup.unit"),
                                  })}
                                </label>
                                <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg overflow-hidden focus-within:border-emerald-500 transition-colors">
                                  <span className="px-3 text-sm text-slate-400 border-e border-slate-700">
                                    $
                                  </span>
                                  <DecimalInput
                                    value={parseFloat(row.acquisitionRate) || 0}
                                    onChange={(n) =>
                                      updateCurrencyRow(index, {
                                        acquisitionRate: n ? String(n) : "",
                                      })
                                    }
                                    placeholder="0.00"
                                    data-testid={`drawer-topup-acquisition-rate-${index}`}
                                    className="flex-1 bg-transparent px-3 py-2 text-sm text-white focus:outline-none placeholder:text-slate-600"
                                  />
                                </div>
                                <p className="mt-1 text-[11px] text-slate-500">
                                  {t("topup.acquisitionHint", {
                                    code: row.currency_code || t("topup.unit"),
                                  })}
                                </p>
                              </div>
                            ))}
                        </div>
                      );
                    })}

                    <button
                      type="button"
                      data-testid="drawer-topup-add-currency"
                      onClick={addCurrencyRow}
                      disabled={
                        extraCurrencies.length >= currencyOptions.length
                      }
                      className="flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 disabled:text-slate-600 disabled:cursor-not-allowed transition-colors"
                    >
                      <Plus size={14} />
                      {t("topup.addCurrency")}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                {t("drawer.notes")}{" "}
                <span className="text-slate-600">{t("drawer.optional")}</span>
              </label>
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("drawer.addNote")}
                data-testid="drawer-topup-notes-input"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 placeholder:text-slate-600 resize-none transition-colors"
              />
            </div>
          </div>
        )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex gap-3 px-6 py-4 border-t border-slate-700/60">
          <button
            onClick={handleClose}
            disabled={isSubmitting}
            className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {tc("actions.cancel")}
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
              ? t("drawer.processing")
              : mode === "transfer"
                ? t("topup.modeTransfer")
                : mode === "from_drawer"
                  ? t("topup.modeTransfer")
                  : t("topup.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default DrawerTopUpModal;
