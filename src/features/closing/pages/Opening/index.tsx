import { useState, useEffect } from "react";
import { useAuth } from "../../../auth/context/AuthContext";
import { X } from "lucide-react";

export default function Opening({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const drawerTypes: Array<"General" | "OMT" | "MTC" | "Alfa"> = [
    "General",
    "OMT",
    "MTC",
    "Alfa",
  ];
  const { user } = useAuth();
  const [currencies, setCurrencies] = useState<
    Array<{ code: string; name: string }>
  >([]);
  const [amountsText, setAmountsText] = useState<
    Record<string, Record<string, string>>
  >({}); // drawer -> currency -> opening (text)
  const [drawerType, setDrawerType] = useState<
    "General" | "OMT" | "MTC" | "Alfa"
  >("General");

  useEffect(() => {
    const load = async () => {
      try {
        const list = await window.api.currencies.list();
        const active = list
          .filter((c: any) => c.is_active === 1)
          .map((c: any) => ({ code: c.code, name: c.name }));
        setCurrencies(active);
        // init amounts structure
        const init: Record<string, Record<string, string>> = {};
        for (const d of drawerTypes) {
          init[d] = {};
          for (const c of active) init[d][c.code] = "";
        }
        setAmountsText(init);
      } catch {}
    };
    load();
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setDrawerType("General");
      return;
    }
  }, [isOpen]);

  const setDrawerCurrencyText = (
    drawer: string,
    code: string,
    value: string,
  ) => {
    setAmountsText((prev) => ({
      ...prev,
      [drawer]: { ...prev[drawer], [code]: value },
    }));
  };

  const handleSave = async () => {
    try {
      const closing_date = new Date().toISOString().split("T")[0];
      const amountsArray = [] as Array<{
        drawer_name: string;
        currency_code: string;
        opening_amount: number;
      }>;
      for (const d of drawerTypes) {
        for (const c of currencies) {
          const raw = amountsText[d]?.[c.code] ?? "";
          const parsed = raw === "" ? 0 : parseFloat(raw);
          amountsArray.push({
            drawer_name: d,
            currency_code: c.code,
            opening_amount: isNaN(parsed) ? 0 : parsed,
          });
        }
      }
      const res = await window.api.closing.setOpeningBalances({
        closing_date,
        amounts: amountsArray,
        user_id: user?.id,
      });
      if (res.success) {
        alert("Opening balances saved");
        onClose();
      } else {
        alert("Failed to save opening balances: " + res.error);
      }
    } catch (e) {
      console.error("Failed to save opening balances", e);
      alert("Failed to save opening balances");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-slate-800 rounded-xl border border-slate-700 shadow-2xl w-full max-w-xl overflow-hidden">
        <div className="flex justify-between items-center p-4 border-b border-slate-700">
          <h1 className="text-xl font-bold text-white">Opening Shift</h1>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={24} />
          </button>
        </div>
        <div className="p-6 space-y-6">
          <div>
            <h2 className="text-sm text-slate-400 mb-2">Select Drawer</h2>
            <div className="flex gap-3">
              <button
                onClick={() => setDrawerType("General")}
                className={`px-4 py-2 rounded-lg ${drawerType === "General" ? "bg-violet-600 text-white" : "bg-slate-700 text-slate-300"}`}
              >
                General Drawer
              </button>
              <button
                onClick={() => setDrawerType("OMT")}
                className={`px-4 py-2 rounded-lg ${drawerType === "OMT" ? "bg-violet-600 text-white" : "bg-slate-700 text-slate-300"}`}
              >
                OMT Drawer
              </button>
            </div>
          </div>

          {/* Dynamic amounts per drawer/currency */}
          <div className="space-y-4">
            {drawerTypes.map((d) => (
              <div key={d} className="border border-slate-700 rounded-lg p-3">
                <div className="font-semibold text-white mb-2">{d} Drawer</div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {currencies.map((c) => (
                    <div key={c.code}>
                      <label className="block text-sm text-slate-400 mb-1">
                        {c.code}
                      </label>
                      <input
                        type="number"
                        value={amountsText[d]?.[c.code] ?? ""}
                        onChange={(e) =>
                          setDrawerCurrencyText(d, c.code, e.target.value)
                        }
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-3 mt-4">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-700 text-slate-300"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white"
            >
              Save Opening
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
