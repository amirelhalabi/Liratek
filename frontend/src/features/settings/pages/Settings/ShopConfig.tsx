import { useEffect, useState } from "react";
import logger from "../../../../utils/logger";
import { appEvents, useApi } from "@liratek/ui";
import { PanelLeft, LayoutGrid, Image, List } from "lucide-react";
import clsx from "clsx";
import { useFeatureFlags } from "../../../../contexts/FeatureFlagContext";

export default function ShopConfig() {
  const api = useApi();
  const { refreshFlags } = useFeatureFlags();
  const [shopName, setShopName] = useState("");
  const [receiptHeaderText, setReceiptHeaderText] = useState("");
  const [sessionMgmt, setSessionMgmt] = useState(true);
  const [customerSessions, setCustomerSessions] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [layoutMode, setLayoutMode] = useState(
    () => localStorage.getItem("layout_mode") || "left-panel",
  );
  const [columnsPerRow, setColumnsPerRow] = useState(
    () => Number(localStorage.getItem("home_columns")) || 5,
  );
  const [posShowImages, setPosShowImages] = useState(
    () => localStorage.getItem("pos_show_images") !== "false",
  );

  const handleLayoutChange = (mode: "left-panel" | "page-view") => {
    setLayoutMode(mode);
    localStorage.setItem("layout_mode", mode);
    window.dispatchEvent(new Event("layout-mode-changed"));
  };

  const handleColumnsChange = (cols: number) => {
    const clamped = Math.max(2, Math.min(6, cols));
    setColumnsPerRow(clamped);
    localStorage.setItem("home_columns", String(clamped));
    window.dispatchEvent(new Event("layout-mode-changed"));
  };

  const handlePosShowImagesChange = (show: boolean) => {
    setPosShowImages(show);
    localStorage.setItem("pos_show_images", String(show));
    window.dispatchEvent(new Event("pos-display-changed"));
  };

  const load = async () => {
    setIsLoading(true);
    try {
      const settings = await api.getAllSettings();
      const map = new Map(settings.map((s: any) => [s.key_name, s.value]));
      setShopName((map.get("shop_name") as string) || "");
      setReceiptHeaderText((map.get("receipt_header_text") as string) || "");
      setSessionMgmt(map.get("feature_session_management") !== "disabled");
      setCustomerSessions(map.get("feature_customer_sessions") !== "disabled");
    } finally {
      setIsLoading(false);
    }
  };

  const save = async () => {
    setIsSaving(true);
    try {
      // basic validation
      if (!shopName.trim()) throw new Error("Shop name is required");

      await Promise.all([
        api.updateSetting("shop_name", shopName),
        api.updateSetting("receipt_header_text", receiptHeaderText),
        api.updateSetting(
          "feature_session_management",
          sessionMgmt ? "enabled" : "disabled",
        ),
        api.updateSetting(
          "feature_customer_sessions",
          customerSessions ? "enabled" : "disabled",
        ),
      ]);
      // Notify feature flag context to refresh
      window.dispatchEvent(new Event("feature-flags-changed"));
      await refreshFlags();
      appEvents.emit(
        "notification:show",
        "Shop configuration saved",
        "success",
      );
    } catch (e) {
      logger.error("Operation failed", { error: e });
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
    <div className="space-y-6">
      <div>
        <label
          htmlFor="shop-name"
          className="block text-sm text-slate-400 mb-2"
        >
          Shop Name
        </label>
        <input
          id="shop-name"
          value={shopName}
          onChange={(e) => setShopName(e.target.value)}
          className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white"
        />
      </div>
      <div>
        <label
          htmlFor="shop-receipt-header"
          className="block text-sm text-slate-400 mb-2"
        >
          Receipt Header Text
        </label>
        <input
          id="shop-receipt-header"
          value={receiptHeaderText}
          onChange={(e) => setReceiptHeaderText(e.target.value)}
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

      {/* Navigation Style & POS Display Mode — side by side */}
      <div className="pt-6 border-t border-slate-700 grid grid-cols-2 gap-8">
        {/* Navigation Style Toggle */}
        <div>
          <span className="block text-sm text-slate-400 mb-3">
            Navigation Style
          </span>
          <div className="flex gap-4 items-start">
            {/* Left Panel option */}
            <button
              onClick={() => handleLayoutChange("left-panel")}
              className={clsx(
                "flex flex-col items-center gap-3 p-4 rounded-xl border-2 transition-all w-44 min-h-[13rem]",
                layoutMode === "left-panel"
                  ? "border-violet-500 bg-violet-600/10"
                  : "border-slate-700 bg-slate-800 hover:border-slate-600",
              )}
            >
              <div className="w-full aspect-[4/3] rounded-lg bg-slate-900 border border-slate-700 overflow-hidden flex">
                <div className="w-1/4 bg-slate-800 border-r border-slate-700 flex flex-col items-center pt-2 gap-1">
                  <div className="w-3 h-0.5 bg-violet-500 rounded" />
                  <div className="w-3 h-0.5 bg-slate-600 rounded" />
                  <div className="w-3 h-0.5 bg-slate-600 rounded" />
                  <div className="w-3 h-0.5 bg-slate-600 rounded" />
                </div>
                <div className="flex-1 flex flex-col">
                  <div className="h-2 bg-slate-800 border-b border-slate-700" />
                  <div className="flex-1 p-1">
                    <div className="w-full h-full bg-slate-800/50 rounded" />
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <PanelLeft
                  size={16}
                  className={
                    layoutMode === "left-panel"
                      ? "text-violet-400"
                      : "text-slate-400"
                  }
                />
                <span
                  className={clsx(
                    "text-sm font-medium",
                    layoutMode === "left-panel"
                      ? "text-white"
                      : "text-slate-400",
                  )}
                >
                  Left Panel
                </span>
              </div>
              {layoutMode === "left-panel" && (
                <span className="text-xs text-violet-400">Active</span>
              )}
            </button>

            {/* Page View option */}
            <button
              onClick={() => handleLayoutChange("page-view")}
              className={clsx(
                "flex flex-col items-center gap-3 p-4 rounded-xl border-2 transition-all w-44 min-h-[13rem]",
                layoutMode === "page-view"
                  ? "border-violet-500 bg-violet-600/10"
                  : "border-slate-700 bg-slate-800 hover:border-slate-600",
              )}
            >
              <div className="w-full aspect-[4/3] rounded-lg bg-slate-900 border border-slate-700 overflow-hidden flex flex-col">
                <div className="h-2 bg-slate-800 border-b border-slate-700 flex items-center px-1 gap-0.5">
                  <div className="w-1 h-1 bg-violet-500 rounded-sm" />
                  <div className="w-4 h-0.5 bg-slate-600 rounded" />
                </div>
                <div
                  className="flex-1 p-1.5 grid gap-1"
                  style={{
                    gridTemplateColumns: `repeat(${columnsPerRow}, 1fr)`,
                  }}
                >
                  {Array.from({ length: columnsPerRow * 2 }).map((_, i) => (
                    <div key={i} className="bg-slate-800 rounded" />
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <LayoutGrid
                  size={16}
                  className={
                    layoutMode === "page-view"
                      ? "text-violet-400"
                      : "text-slate-400"
                  }
                />
                <span
                  className={clsx(
                    "text-sm font-medium",
                    layoutMode === "page-view"
                      ? "text-white"
                      : "text-slate-400",
                  )}
                >
                  Page View
                </span>
              </div>
              {layoutMode === "page-view" && (
                <span className="text-xs text-violet-400">Active</span>
              )}
            </button>

            {/* Items per row — shown next to Page View card */}
            {layoutMode === "page-view" && (
              <div className="p-4 bg-slate-800/50 border border-slate-700/50 rounded-xl">
                <span className="block text-sm text-slate-400 mb-2">
                  Items per row
                </span>
                <div className="flex gap-1">
                  {[2, 3, 4, 5, 6].map((n) => (
                    <button
                      key={n}
                      onClick={() => handleColumnsChange(n)}
                      className={clsx(
                        "w-9 h-9 rounded-lg text-sm font-semibold transition-all",
                        columnsPerRow === n
                          ? "bg-violet-600 text-white shadow-lg shadow-violet-900/30"
                          : "bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-white",
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <p className="text-xs text-slate-500 mt-2">
            Left Panel shows a sidebar for navigation. Page View shows a home
            screen with cards.
          </p>
        </div>

        {/* POS Display Mode */}
        <div>
          <span className="block text-sm text-slate-400 mb-3">
            POS Product Display
          </span>
          <div className="flex gap-4 items-start">
            {/* Show Images */}
            <button
              onClick={() => handlePosShowImagesChange(true)}
              className={clsx(
                "flex flex-col items-center gap-3 p-4 rounded-xl border-2 transition-all w-44",
                posShowImages
                  ? "border-violet-500 bg-violet-600/10"
                  : "border-slate-700 bg-slate-800 hover:border-slate-600",
              )}
            >
              <div className="w-full aspect-[4/3] rounded-lg bg-slate-900 border border-slate-700 overflow-hidden p-1.5 grid grid-cols-3 gap-1">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="bg-slate-700 rounded flex items-center justify-center"
                  >
                    <div className="w-3 h-3 bg-slate-600 rounded" />
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Image
                  size={16}
                  className={
                    posShowImages ? "text-violet-400" : "text-slate-400"
                  }
                />
                <span
                  className={clsx(
                    "text-sm font-medium",
                    posShowImages ? "text-white" : "text-slate-400",
                  )}
                >
                  Show Images
                </span>
              </div>
              {posShowImages && (
                <span className="text-xs text-violet-400">Active</span>
              )}
            </button>

            {/* Table View */}
            <button
              onClick={() => handlePosShowImagesChange(false)}
              className={clsx(
                "flex flex-col items-center gap-3 p-4 rounded-xl border-2 transition-all w-44",
                !posShowImages
                  ? "border-violet-500 bg-violet-600/10"
                  : "border-slate-700 bg-slate-800 hover:border-slate-600",
              )}
            >
              <div className="w-full aspect-[4/3] rounded-lg bg-slate-900 border border-slate-700 overflow-hidden p-1.5 flex flex-col gap-1">
                <div className="h-1.5 bg-slate-700 rounded w-full" />
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-1.5 bg-slate-800 border border-slate-700/50 rounded w-full"
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <List
                  size={16}
                  className={
                    !posShowImages ? "text-violet-400" : "text-slate-400"
                  }
                />
                <span
                  className={clsx(
                    "text-sm font-medium",
                    !posShowImages ? "text-white" : "text-slate-400",
                  )}
                >
                  Table View
                </span>
              </div>
              {!posShowImages && (
                <span className="text-xs text-violet-400">Active</span>
              )}
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Show Images displays products as image cards. Table View shows a
            compact list with pagination.
          </p>
        </div>
      </div>
    </div>
  );
}
