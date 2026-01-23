import { useEffect, useState } from "react";
import { appEvents } from "../../../../shared/utils/appEvents";

export default function DrawerConfig() {
  const [drawerLimitGeneral, setDrawerLimitGeneral] = useState("");
  const [drawerLimitOMT, setDrawerLimitOMT] = useState("");
  const [closingVarianceThresholdPct, setClosingVarianceThresholdPct] =
    useState("5");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const load = async () => {
    setIsLoading(true);
    try {
      const settings = await window.api.settings.getAll();
      const map = new Map(settings.map((s) => [s.key_name, s.value]));
      setDrawerLimitGeneral((map.get("drawer_limit_general") as string) || "");
      setDrawerLimitOMT((map.get("drawer_limit_omt") as string) || "");
      setClosingVarianceThresholdPct(
        String(map.get("closing_variance_threshold_pct") ?? "5"),
      );
    } finally {
      setIsLoading(false);
    }
  };

  const save = async () => {
    setIsSaving(true);
    try {
      const gen = Number(drawerLimitGeneral);
      const omt = Number(drawerLimitOMT);
      const thresholdPct = Number(closingVarianceThresholdPct);

      if (!gen || gen <= 0) throw new Error("General drawer limit must be > 0");
      if (!omt || omt <= 0) throw new Error("OMT drawer limit must be > 0");
      if (!isFinite(thresholdPct) || thresholdPct < 0 || thresholdPct > 100)
        throw new Error("Closing variance threshold must be between 0 and 100");

      await Promise.all([
        window.api.settings.update("drawer_limit_general", drawerLimitGeneral),
        window.api.settings.update("drawer_limit_omt", drawerLimitOMT),
        window.api.settings.update(
          "closing_variance_threshold_pct",
          String(thresholdPct),
        ),
      ]);
      appEvents.emit(
        "notification:show",
        "Drawer configuration saved",
        "success",
      );
    } catch (e) {
      console.error(e);
      appEvents.emit(
        "notification:show",
        e instanceof Error ? e.message : "Failed to save",
        "error",
      );
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
        <label
          htmlFor="drawerLimitGeneral"
          className="block text-sm text-slate-400 mb-2"
        >
          General Drawer Limit (USD)
        </label>
        <input
          id="drawerLimitGeneral"
          type="number"
          value={drawerLimitGeneral}
          onChange={(e) => setDrawerLimitGeneral(e.target.value)}
          className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white"
        />
      </div>
      <div>
        <label
          htmlFor="drawerLimitOMT"
          className="block text-sm text-slate-400 mb-2"
        >
          OMT Drawer Limit (USD)
        </label>
        <input
          id="drawerLimitOMT"
          type="number"
          value={drawerLimitOMT}
          onChange={(e) => setDrawerLimitOMT(e.target.value)}
          className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white"
        />
      </div>

      <div>
        <label
          htmlFor="closingVarianceThresholdPct"
          className="block text-sm text-slate-400 mb-2"
        >
          Closing Variance Threshold (%)
        </label>
        <input
          id="closingVarianceThresholdPct"
          type="number"
          min={0}
          max={100}
          step={0.1}
          value={closingVarianceThresholdPct}
          onChange={(e) => setClosingVarianceThresholdPct(e.target.value)}
          className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white"
        />
        <p className="text-xs text-slate-500 mt-2">
          Used to show a warning banner in Closing when variance exceeds this percentage.
          Set to 0 to disable.
        </p>
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
