import { useEffect, useState } from "react";
import { useSetup } from "../context/SetupContext";
import { useApi } from "@liratek/ui";

interface CurrencyRow {
  code: string;
  name: string;
  symbol: string;
  is_active: number;
}

export default function Step3Currencies() {
  const { payload, updatePayload, setStep } = useSetup();
  const api = useApi();
  const [currencies, setCurrencies] = useState<CurrencyRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.getCurrencies();
        setCurrencies(Array.isArray(data) ? data : []);
        // Pre-select currently active currencies if not yet set by user
        if (payload.active_currencies.length === 0) {
          const active = (Array.isArray(data) ? data : [])
            .filter((c: CurrencyRow) => c.is_active)
            .map((c: CurrencyRow) => c.code);
          updatePayload({ active_currencies: active });
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [api]);

  const toggle = (code: string) => {
    const next = payload.active_currencies.includes(code)
      ? payload.active_currencies.filter((c) => c !== code)
      : [...payload.active_currencies, code];
    updatePayload({ active_currencies: next });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Currencies</h2>
          <p className="text-slate-400 text-sm mt-1">
            Select which currencies your shop will use. You can update this
            later in Settings.
          </p>
        </div>
        <button
          onClick={() => setStep(4)}
          className="text-xs text-slate-400 hover:text-white underline mt-1"
        >
          Skip — use defaults
        </button>
      </div>

      {loading ? (
        <div className="text-slate-400 text-sm">Loading currencies...</div>
      ) : (
        <div className="bg-slate-900/50 rounded-xl p-4 space-y-1">
          {currencies.map((cur) => {
            const active = payload.active_currencies.includes(cur.code);
            return (
              <div
                key={cur.code}
                className="flex items-center justify-between py-2.5 border-b border-slate-800 last:border-0"
              >
                <div>
                  <p className="text-sm font-medium text-white">
                    {cur.code}
                    <span className="ml-2 text-slate-400 font-normal">
                      {cur.name}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500">{cur.symbol}</p>
                </div>
                <button
                  type="button"
                  onClick={() => toggle(cur.code)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    active ? "bg-violet-600" : "bg-slate-700"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      active ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex justify-between">
        <button
          onClick={() => setStep(2)}
          className="px-6 py-2.5 border border-slate-600 text-slate-300 hover:bg-slate-800 rounded-lg transition-colors text-sm"
        >
          ← Back
        </button>
        <button
          onClick={() => setStep(4)}
          className="px-6 py-2.5 bg-violet-600 hover:bg-violet-500 text-white font-medium rounded-lg transition-colors text-sm"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
