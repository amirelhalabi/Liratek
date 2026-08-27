import { useEffect, useState } from "react";
import { Wallet, Plus, X, Smartphone } from "lucide-react";
import { DecimalInput, useApi } from "@liratek/ui";
import { useSetup } from "../context/SetupContext";
import { DRAWER_ORDER, DRAWER_CONFIGS } from "../../closing/config/drawers";
import type { DrawerType } from "../../closing/types";

// Carrier-line UI slots (LIRA carrier-lines-validity Phase 2, §0.1/§0.5). One
// slot per carrier — no per-carrier module exists, both map to `recharge`
// (create_db.sql:1132), so the section is gated on that single module and
// shows both drawers or neither.
type CarrierDrawer = "MTC" | "Alfa";
const CARRIER_LINE_META: Array<{
  drawer: CarrierDrawer;
  carrier: "mtc" | "alfa";
}> = [
  { drawer: "MTC", carrier: "mtc" },
  { drawer: "Alfa", carrier: "alfa" },
];

interface CarrierLineDraft {
  phone_number: string;
  label: string;
  validity_expires_at: string;
}

const EMPTY_CARRIER_DRAFT: CarrierLineDraft = {
  phone_number: "",
  label: "",
  validity_expires_at: "",
};

interface CurrencyOption {
  code: string;
  name: string;
  is_active: number;
}

// Module required to show each drawer
const DRAWER_MODULE_REQUIREMENT: Record<string, string> = {
  OMT_System: "ipec_katch",
  OMT_App: "ipec_katch",
  Whish_App: "ipec_katch",
  Whish_System: "ipec_katch",
  Binance: "binance",
  MTC: "recharge",
  Alfa: "recharge",
  iPick: "ipec_katch",
  Katsh: "ipec_katch",
};

const DRAWER_ACCENT: Record<string, string> = {
  General: "blue",
  OMT_System: "green",
  OMT_App: "lime",
  Whish_App: "emerald",
  Whish_System: "fuchsia",
  Binance: "yellow",
  MTC: "orange",
  Alfa: "red",
  iPick: "sky",
  Katsh: "amber",
};

export default function StepDrawerAmounts() {
  const { payload, updatePayload, setStep } = useSetup();
  const api = useApi();

  // drawer → currency → numeric value
  const [amounts, setAmounts] = useState<
    Record<string, Record<string, number>>
  >({});
  // drawer → currency_code[] — the countable currencies (base allowlist ∪
  // any currency holding a non-zero balance there —
  // GENERAL_DRAWER_UNRESTRICTED.md D2/D5), so this screen always matches the
  // rest of the app and never renders a duplicate or a zero-balance exotic.
  const [drawerCurrencies, setDrawerCurrencies] = useState<
    Record<string, string[]>
  >({});
  // drawer → extra currency_code[] the operator added here (e.g. EUR) on top of
  // the countable set. Persisted to currency_drawers on completion.
  const [extraCurrencies, setExtraCurrencies] = useState<
    Record<string, string[]>
  >({});
  // All active currencies, for the "add currency" picker.
  const [allCurrencies, setAllCurrencies] = useState<CurrencyOption[]>([]);
  // Carrier (MTC/Alfa) line drafts — phone/label/validity only. Credits is
  // NOT duplicated here: it lives solely in `amounts[drawer]["USD"]` (§0.1),
  // so the line and the carrier's starting drawer amount can never disagree.
  const [carrierLineDrafts, setCarrierLineDrafts] = useState<
    Record<string, CarrierLineDraft>
  >({});

  const enabledModules = payload.enabled_modules;

  const visibleDrawers = DRAWER_ORDER.filter((name) => {
    const required = DRAWER_MODULE_REQUIREMENT[name];
    return !required || enabledModules.includes(required);
  });

  useEffect(() => {
    api
      .getCountableDrawerCurrencies()
      .then((configured) => setDrawerCurrencies(configured ?? {}));
    api.getCurrencies().then((rows) =>
      setAllCurrencies(
        (Array.isArray(rows) ? rows : []).filter(
          (c: CurrencyOption) => c.is_active,
        ),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Countable + operator-added currencies for a drawer, de-duplicated.
  function currenciesFor(drawer: string): string[] {
    return Array.from(
      new Set([
        ...(drawerCurrencies[drawer] ?? []),
        ...(extraCurrencies[drawer] ?? []),
      ]),
    );
  }

  // Active currencies not already shown for this drawer (picker options).
  function addableCurrencies(drawer: string): CurrencyOption[] {
    const shown = new Set(currenciesFor(drawer));
    return allCurrencies.filter((c) => !shown.has(c.code));
  }

  function handleAddCurrency(drawer: string, currency: string) {
    if (!currency) return;
    setExtraCurrencies((prev) => ({
      ...prev,
      [drawer]: [...(prev[drawer] ?? []), currency],
    }));
  }

  function handleRemoveExtra(drawer: string, currency: string) {
    setExtraCurrencies((prev) => ({
      ...prev,
      [drawer]: (prev[drawer] ?? []).filter((c) => c !== currency),
    }));
    setAmounts((prev) => {
      const next = { ...(prev[drawer] ?? {}) };
      delete next[currency];
      return { ...prev, [drawer]: next };
    });
  }

  function handleChange(drawer: string, currency: string, value: number) {
    setAmounts((prev) => ({
      ...prev,
      [drawer]: { ...prev[drawer], [currency]: value },
    }));
  }

  function handleCarrierFieldChange(
    drawer: CarrierDrawer,
    field: keyof CarrierLineDraft,
    value: string,
  ) {
    setCarrierLineDrafts((prev) => ({
      ...prev,
      [drawer]: { ...(prev[drawer] ?? EMPTY_CARRIER_DRAFT), [field]: value },
    }));
  }

  // Only carriers the operator actually typed a phone number for become a
  // line (D4 — soft nudge, never blocks Launch). Credits come straight from
  // `amounts[drawer]["USD"]` — the exact same number the drawer grid above
  // would show for that drawer, so the line and the starting drawer amount
  // are the same value read twice, never two independently-typed ones.
  function buildCarrierLines() {
    const rows: Array<{
      carrier: "mtc" | "alfa";
      phone_number: string;
      label: string | null;
      credits: number;
      validity_expires_at: string | null;
    }> = [];
    for (const meta of CARRIER_LINE_META) {
      if (!visibleDrawers.includes(meta.drawer)) continue;
      const draft = carrierLineDrafts[meta.drawer] ?? EMPTY_CARRIER_DRAFT;
      const phone = draft.phone_number.trim();
      if (!phone) continue;
      rows.push({
        carrier: meta.carrier,
        phone_number: phone,
        label: draft.label.trim() || null,
        credits: amounts[meta.drawer]?.["USD"] ?? 0,
        validity_expires_at: draft.validity_expires_at || null,
      });
    }
    return rows;
  }

  function buildDrawerAmounts() {
    const rows: Array<{
      drawer_name: string;
      currency_code: string;
      amount: number;
    }> = [];
    for (const drawer of visibleDrawers) {
      for (const currency of currenciesFor(drawer)) {
        const amt = amounts[drawer]?.[currency] ?? 0;
        if (amt !== 0) {
          rows.push({
            drawer_name: drawer,
            currency_code: currency,
            amount: amt,
          });
        }
      }
    }
    return rows;
  }

  // Only drawers the operator extended need a currency_drawers rewrite; each
  // carries its FULL currency set (configured + added) since the persist
  // replaces the drawer's mapping.
  function buildDrawerCurrencyConfig() {
    return visibleDrawers
      .filter((drawer) => (extraCurrencies[drawer] ?? []).length > 0)
      .map((drawer) => ({
        drawer_name: drawer,
        currency_codes: currenciesFor(drawer),
      }));
  }

  function handleNext() {
    // Store amounts + any drawer currency additions so StepComplete applies them
    updatePayload({
      drawer_amounts: buildDrawerAmounts(),
      drawer_currency_config: buildDrawerCurrencyConfig(),
      carrier_lines: buildCarrierLines(),
    });
    setStep(7);
  }

  function handleSkip() {
    updatePayload({
      drawer_amounts: [],
      drawer_currency_config: [],
      carrier_lines: [],
    });
    setStep(7);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">
          Starting Drawer Amounts
        </h2>
        <p className="text-sm text-slate-400">
          Optionally set the initial cash for each active drawer. Leave fields
          empty to start at zero. You can always update these later from the
          Dashboard.
        </p>
      </div>

      <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
        {visibleDrawers.map((drawer) => {
          const config = DRAWER_CONFIGS[drawer as DrawerType];
          const currencies = currenciesFor(drawer);
          const extras = extraCurrencies[drawer] ?? [];
          const options = addableCurrencies(drawer);
          const accent = DRAWER_ACCENT[drawer] ?? "slate";
          // MTC/Alfa's USD amount is entered once, in the Carrier Lines
          // section below, as that carrier's Credits field (§0.1) — never a
          // second field here that could disagree with it.
          const isCarrierDrawer = drawer === "MTC" || drawer === "Alfa";

          return (
            <div
              key={drawer}
              className={`bg-slate-900 rounded-xl border border-slate-600/40 border-l-4 border-l-${accent}-500 px-4 py-3`}
            >
              <div className="flex items-center gap-2 mb-3">
                <Wallet className={`w-3.5 h-3.5 text-${accent}-400`} />
                <span className={`text-sm font-semibold text-${accent}-400`}>
                  {config?.label ?? drawer}
                </span>
                {config?.description && (
                  <span className="text-xs text-slate-500">
                    — {config.description}
                  </span>
                )}
              </div>
              {isCarrierDrawer ? (
                <p className="text-xs text-slate-500 italic">
                  Set below in Carrier Lines ↓
                </p>
              ) : (
                <div
                  className={`grid gap-3 ${currencies.length <= 1 ? "grid-cols-1 max-w-xs" : "grid-cols-2"}`}
                >
                  {currencies.map((currency) => (
                    <div
                      key={currency}
                      data-testid={`setup-amount-${drawer}-${currency}`}
                    >
                      <label className="text-xs text-slate-400 mb-1 flex items-center justify-between">
                        <span>{currency}</span>
                        {extras.includes(currency) && (
                          <button
                            type="button"
                            onClick={() => handleRemoveExtra(drawer, currency)}
                            className="text-slate-500 hover:text-red-400 transition-colors"
                            title={`Remove ${currency}`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </label>
                      <DecimalInput
                        value={amounts[drawer]?.[currency] ?? 0}
                        onChange={(v) => handleChange(drawer, currency, v)}
                        decimals={currency === "LBP" ? 0 : 2}
                        placeholder="0"
                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500 placeholder:text-slate-600"
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Add another currency (e.g. EUR) — only on the General till,
                  where physical foreign cash is held. Provider drawers keep
                  their fixed business currency. */}
              {drawer === "General" && options.length > 0 && (
                <div className="mt-3 flex items-center gap-2">
                  <Plus className="w-3 h-3 text-slate-500" />
                  <select
                    value=""
                    data-testid={`setup-add-currency-${drawer}`}
                    onChange={(e) => {
                      handleAddCurrency(drawer, e.target.value);
                      e.target.value = "";
                    }}
                    className="bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-slate-300 text-xs focus:outline-none focus:border-violet-500"
                  >
                    <option value="">Add currency…</option>
                    {options.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} — {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {CARRIER_LINE_META.some((meta) =>
        visibleDrawers.includes(meta.drawer),
      ) && (
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-white">
              Carrier Lines{" "}
              <span className="text-slate-500 font-normal">(optional)</span>
            </h3>
            <p className="text-xs text-slate-400">
              The shop's own MTC/Alfa SIM line. Credits entered here also set
              that carrier's starting drawer amount above — one number, never
              typed twice.
            </p>
          </div>

          <div className="space-y-3">
            {CARRIER_LINE_META.filter((meta) =>
              visibleDrawers.includes(meta.drawer),
            ).map((meta) => {
              const draft =
                carrierLineDrafts[meta.drawer] ?? EMPTY_CARRIER_DRAFT;
              const accent = DRAWER_ACCENT[meta.drawer] ?? "slate";

              return (
                <div
                  key={meta.drawer}
                  data-testid={`setup-carrier-line-${meta.drawer}`}
                  className={`bg-slate-900 rounded-xl border border-slate-600/40 border-l-4 border-l-${accent}-500 px-4 py-3`}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <Smartphone className={`w-3.5 h-3.5 text-${accent}-400`} />
                    <span
                      className={`text-sm font-semibold text-${accent}-400`}
                    >
                      {meta.drawer} Line
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">
                        Phone Number
                      </label>
                      <input
                        type="text"
                        value={draft.phone_number}
                        onChange={(e) =>
                          handleCarrierFieldChange(
                            meta.drawer,
                            "phone_number",
                            e.target.value,
                          )
                        }
                        placeholder="e.g. 03123456"
                        data-testid={`setup-carrier-phone-${meta.drawer}`}
                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500 placeholder:text-slate-600"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">
                        Label
                      </label>
                      <input
                        type="text"
                        value={draft.label}
                        onChange={(e) =>
                          handleCarrierFieldChange(
                            meta.drawer,
                            "label",
                            e.target.value,
                          )
                        }
                        placeholder="e.g. Shop Line 1"
                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500 placeholder:text-slate-600"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">
                        Credits ($)
                      </label>
                      <DecimalInput
                        value={amounts[meta.drawer]?.["USD"] ?? 0}
                        onChange={(v) => handleChange(meta.drawer, "USD", v)}
                        decimals={2}
                        placeholder="0"
                        data-testid={`setup-carrier-credits-${meta.drawer}`}
                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500 placeholder:text-slate-600"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">
                        Validity Expires
                      </label>
                      <input
                        type="date"
                        value={draft.validity_expires_at}
                        onChange={(e) =>
                          handleCarrierFieldChange(
                            meta.drawer,
                            "validity_expires_at",
                            e.target.value,
                          )
                        }
                        data-testid={`setup-carrier-validity-${meta.drawer}`}
                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex justify-between pt-2">
        <button
          onClick={() => setStep(5)}
          className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
        >
          ← Back
        </button>
        <div className="flex gap-3">
          <button
            onClick={handleSkip}
            className="px-4 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
          >
            Skip
          </button>
          <button
            onClick={handleNext}
            className="px-6 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}
