import { useEffect, useState } from "react";
import { appEvents } from "../../../../shared/utils/appEvents";

export default function ShopConfig() {
  const [shopName, setShopName] = useState("");
  const [receiptHeaderText, setReceiptHeaderText] = useState("");
  const [exchangeRate, setExchangeRate] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const load = async () => {
    setIsLoading(true);
    try {
      const settings = await window.api.settings.getAll();
      const map = new Map(settings.map((s) => [s.key_name, s.value]));
      setShopName((map.get("shop_name") as string) || "");
      setReceiptHeaderText((map.get("receipt_header_text") as string) || "");
      setExchangeRate((map.get("exchange_rate_usd_lbp") as string) || "");
    } finally {
      setIsLoading(false);
    }
  };

  const save = async () => {
    setIsSaving(true);
    try {
      // basic validation
      if (!shopName.trim()) throw new Error("Shop name is required");
      const rateNum = Number(exchangeRate);
      if (!rateNum || rateNum <= 0)
        throw new Error("Exchange rate must be > 0");
      await Promise.all([
        window.api.settings.update("shop_name", shopName),
        window.api.settings.update("receipt_header_text", receiptHeaderText),
        window.api.settings.update("exchange_rate_usd_lbp", exchangeRate),
      ]);
      appEvents.emit("notification:show", "Shop configuration saved", "success");
    } catch (e) {
      console.error(e);
      appEvents.emit("notification:show", (e instanceof Error ? e.message : "Failed to save"), "error");
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (isLoading) return <div className="text-slate-400">Loading...</div>;

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm text-slate-400 mb-2">Shop Name</label>
        <input
          value={shopName}
          onChange={(e) => setShopName(e.target.value)}
          className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white"
        />
      </div>
      <div>
        <label className="block text-sm text-slate-400 mb-2">
          Receipt Header Text
        </label>
        <input
          value={receiptHeaderText}
          onChange={(e) => setReceiptHeaderText(e.target.value)}
          className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white"
        />
      </div>
      <div>
        <label className="block text-sm text-slate-400 mb-2">
          USD → LBP Exchange Rate
        </label>
        <input
          type="number"
          value={exchangeRate}
          onChange={(e) => setExchangeRate(e.target.value)}
          className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white"
        />
      </div>
      <div className="flex gap-2 justify-end">
        <button
          onClick={load}
          disabled={isSaving}
          className="px-4 py-2 rounded bg-slate-700 text-white"
        >
          Reset
        </button>
        <button
          onClick={save}
          disabled={isSaving}
          className="px-4 py-2 rounded bg-violet-600 hover:bg-violet-500 text-white"
        >
          {isSaving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
