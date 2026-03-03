import { useEffect, useState } from "react";
import { useSetup } from "../context/SetupContext";
import { useApi } from "@liratek/ui";
import { Lock } from "lucide-react";

interface ModuleRow {
  key: string;
  label: string;
  is_system: number;
}

interface PaymentMethodRow {
  code: string;
  label: string;
  is_system: number;
}

const MANDATORY_MODULES = new Set(["pos", "inventory"]);
const MANDATORY_PMS = new Set(["CASH"]);
const RECHARGE_MODULE_KEYS = new Set(["recharge", "ipec_katch", "binance"]);

function Toggle({
  checked,
  onChange,
  locked,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  locked?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => !locked && onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? "bg-violet-600" : "bg-slate-700"
      } ${locked ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

export default function Step2Modules() {
  const { payload, updatePayload, setStep } = useSetup();
  const api = useApi();
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [mods, pms] = await Promise.all([
          api.getToggleableModules() as Promise<ModuleRow[]>,
          api.getPaymentMethods() as Promise<PaymentMethodRow[]>,
        ]);
        setModules(mods);
        setPaymentMethods(pms);
      } finally {
        setLoading(false);
      }
    })();
  }, [api]);

  const toggleModule = (key: string, enabled: boolean) => {
    const next = enabled
      ? [...new Set([...payload.enabled_modules, key])]
      : payload.enabled_modules.filter((k) => k !== key);
    updatePayload({ enabled_modules: next });
  };

  const togglePM = (code: string, enabled: boolean) => {
    const next = enabled
      ? [...new Set([...payload.enabled_payment_methods, code])]
      : payload.enabled_payment_methods.filter((c) => c !== code);
    updatePayload({ enabled_payment_methods: next });
  };

  if (loading) {
    return <div className="text-slate-400 text-sm">Loading...</div>;
  }

  const rowCls =
    "flex items-center justify-between py-2.5 border-b border-slate-800";
  const labelCls = "text-sm text-white font-medium";
  const sublabelCls = "text-xs text-slate-500";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white">Modules & Features</h2>
        <p className="text-slate-400 text-sm mt-1">
          Choose which modules and features to enable. You can change these
          later in Settings.
        </p>
      </div>

      {/* Modules */}
      <div className="bg-slate-900/50 rounded-xl p-4 space-y-1">
        <h3 className="text-sm font-semibold text-slate-300 mb-3">Modules</h3>
        {/* Non-recharge modules */}
        {modules
          .filter((m) => !RECHARGE_MODULE_KEYS.has(m.key))
          .map((m) => {
            const mandatory = MANDATORY_MODULES.has(m.key);
            const enabled =
              mandatory || payload.enabled_modules.includes(m.key);
            return (
              <div key={m.key} className={rowCls}>
                <div>
                  <p className={labelCls}>{m.label}</p>
                  {mandatory && (
                    <p className={sublabelCls}>
                      <Lock size={10} className="inline mr-1" />
                      Mandatory
                    </p>
                  )}
                </div>
                <Toggle
                  checked={enabled}
                  onChange={(v) => toggleModule(m.key, v)}
                  locked={mandatory}
                />
              </div>
            );
          })}

        {/* Recharge group header */}
        <div className="pt-3 mt-3 border-t border-slate-700">
          <p className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">
            Recharge Providers
          </p>
          {modules
            .filter((m) => RECHARGE_MODULE_KEYS.has(m.key))
            .map((m) => {
              const enabled = payload.enabled_modules.includes(m.key);
              return (
                <div key={m.key} className={rowCls}>
                  <div>
                    <p className={labelCls}>{m.label}</p>
                  </div>
                  <Toggle
                    checked={enabled}
                    onChange={(v) => toggleModule(m.key, v)}
                  />
                </div>
              );
            })}
        </div>
      </div>

      {/* Session Management */}
      <div className="bg-slate-900/50 rounded-xl p-4 space-y-1">
        <h3 className="text-sm font-semibold text-slate-300 mb-3">
          Session Features
        </h3>
        <div className={rowCls}>
          <div>
            <p className={labelCls}>Opening & Closing Sessions</p>
            <p className={sublabelCls}>
              Daily cash drawer opening and closing workflow
            </p>
          </div>
          <Toggle
            checked={payload.session_management_enabled}
            onChange={(v) => updatePayload({ session_management_enabled: v })}
          />
        </div>
        <div className={rowCls + " border-0"}>
          <div>
            <p className={labelCls}>Customer Sessions</p>
            <p className={sublabelCls}>
              Track per-customer transactions in a floating window
            </p>
          </div>
          <Toggle
            checked={payload.customer_sessions_enabled}
            onChange={(v) => updatePayload({ customer_sessions_enabled: v })}
          />
        </div>
      </div>

      {/* Payment Methods */}
      <div className="bg-slate-900/50 rounded-xl p-4 space-y-1">
        <h3 className="text-sm font-semibold text-slate-300 mb-3">
          Payment Methods
        </h3>
        {paymentMethods.map((pm) => {
          const mandatory = MANDATORY_PMS.has(pm.code);
          const enabled =
            mandatory || payload.enabled_payment_methods.includes(pm.code);
          return (
            <div key={pm.code} className={rowCls}>
              <div>
                <p className={labelCls}>{pm.label}</p>
                {mandatory && (
                  <p className={sublabelCls}>
                    <Lock size={10} className="inline mr-1" />
                    Mandatory
                  </p>
                )}
              </div>
              <Toggle
                checked={enabled}
                onChange={(v) => togglePM(pm.code, v)}
                locked={mandatory}
              />
            </div>
          );
        })}
      </div>

      <div className="flex justify-between">
        <button
          onClick={() => setStep(1)}
          className="px-6 py-2.5 border border-slate-600 text-slate-300 hover:bg-slate-800 rounded-lg transition-colors text-sm"
        >
          ← Back
        </button>
        <button
          onClick={() => setStep(3)}
          className="px-6 py-2.5 bg-violet-600 hover:bg-violet-500 text-white font-medium rounded-lg transition-colors text-sm"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
