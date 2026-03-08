import { useEffect, useState } from "react";
import logger from "@/utils/logger";
import { appEvents, useApi } from "@liratek/ui";
import {
  PanelLeft,
  LayoutGrid,
  Image,
  List,
  Monitor,
  Printer,
} from "lucide-react";
import clsx from "clsx";
import { useFeatureFlags } from "@/contexts/FeatureFlagContext";
import { invalidateShopInfo } from "@/hooks/useShopName";

const UI_SCALE_OPTIONS = [
  { value: 0.75, label: "75%" },
  { value: 0.8, label: "80%" },
  { value: 0.85, label: "85%" },
  { value: 0.9, label: "90%" },
  { value: 1.0, label: "100%" },
  { value: 1.1, label: "110%" },
  { value: 1.25, label: "125%" },
];

export default function ShopConfig() {
  const api = useApi();
  const { refreshFlags } = useFeatureFlags();
  const [shopName, setShopName] = useState("");
  const [shopPhone, setShopPhone] = useState("");
  const [shopLocation, setShopLocation] = useState("");
  const [receiptHeaderText, setReceiptHeaderText] = useState("");
  const [sessionMgmt, setSessionMgmt] = useState(true);
  const [customerSessions, setCustomerSessions] = useState(true);
  const [autoCheckUpdates, setAutoCheckUpdates] = useState(true);

  // Print settings
  const [printers, setPrinters] = useState<
    { name: string; displayName: string }[]
  >([]);
  const [receiptPrinter, setReceiptPrinter] = useState("");
  const [barcodePrinter, setBarcodePrinter] = useState("");

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
  const [uiScale, setUiScale] = useState(() => {
    const saved = localStorage.getItem("ui_scale");
    return saved ? parseFloat(saved) : 1.0;
  });

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

  const handleUiScaleChange = (scale: number) => {
    setUiScale(scale);
    localStorage.setItem("ui_scale", String(scale));
    // Apply zoom via Electron webFrame
    if (window.api?.display?.setZoomFactor) {
      window.api.display.setZoomFactor(scale);
    }
  };

  const load = async () => {
    setIsLoading(true);
    try {
      const settings = await api.getAllSettings();
      const map = new Map(settings.map((s: any) => [s.key_name, s.value]));
      setShopName((map.get("shop_name") as string) || "");
      setShopPhone((map.get("shop_phone") as string) || "");
      setShopLocation((map.get("shop_location") as string) || "");
      setReceiptHeaderText((map.get("receipt_header_text") as string) || "");
      setSessionMgmt(map.get("feature_session_management") !== "disabled");
      setCustomerSessions(map.get("feature_customer_sessions") !== "disabled");
      setAutoCheckUpdates(map.get("auto_check_updates") !== "0");
      setReceiptPrinter((map.get("receipt_printer") as string) || "");
      setBarcodePrinter((map.get("barcode_printer") as string) || "");

      // Load available printers if running in Electron
      if (window.api?.print?.getPrinters) {
        try {
          const sysPrinters = await window.api.print.getPrinters();
          setPrinters(sysPrinters);
        } catch (e) {
          logger.error("Failed to fetch system printers", { error: e });
        }
      }
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
        api.updateSetting("shop_phone", shopPhone),
        api.updateSetting("shop_location", shopLocation),
        api.updateSetting("receipt_header_text", receiptHeaderText),
        api.updateSetting(
          "feature_session_management",
          sessionMgmt ? "enabled" : "disabled",
        ),
        api.updateSetting(
          "feature_customer_sessions",
          customerSessions ? "enabled" : "disabled",
        ),
        api.updateSetting("auto_check_updates", autoCheckUpdates ? "1" : "0"),
        api.updateSetting("receipt_printer", receiptPrinter),
        api.updateSetting("barcode_printer", barcodePrinter),
      ]);
      // Invalidate cached shop info so receipts pick up new values
      invalidateShopInfo();
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
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="shop-phone"
            className="block text-sm text-slate-400 mb-2"
          >
            Phone Number
          </label>
          <input
            id="shop-phone"
            value={shopPhone}
            onChange={(e) => setShopPhone(e.target.value)}
            placeholder="e.g. +961 71 123 456"
            className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white placeholder:text-slate-600"
          />
        </div>
        <div>
          <label
            htmlFor="shop-location"
            className="block text-sm text-slate-400 mb-2"
          >
            Location
          </label>
          <input
            id="shop-location"
            value={shopLocation}
            onChange={(e) => setShopLocation(e.target.value)}
            placeholder="e.g. Beirut, Lebanon"
            className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white placeholder:text-slate-600"
          />
        </div>
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

      <div className="pt-6 border-t border-slate-700">
        <span className="flex items-center gap-2 block text-sm text-slate-400 mb-4">
          <Printer size={16} /> Print Settings
        </span>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-slate-400 mb-2">
              Receipt Printer
            </label>
            <select
              value={receiptPrinter}
              onChange={(e) => setReceiptPrinter(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white"
            >
              <option value="">Default (System Print Dialog)</option>
              {printers.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.displayName || p.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">
              Leave empty to show the print dialog every time.
            </p>
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-2">
              Barcode Printer
            </label>
            <select
              value={barcodePrinter}
              onChange={(e) => setBarcodePrinter(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white"
            >
              <option value="">Default (System Print Dialog)</option>
              {printers.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.displayName || p.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">
              Leave empty to show the print dialog every time.
            </p>
          </div>
        </div>
      </div>

      {/* Feature Toggles */}
      <div className="space-y-4">
        <span className="block text-sm text-slate-400">Features</span>

        <label className="flex items-center justify-between cursor-pointer group">
          <div>
            <span className="text-sm text-white">Opening & Closing</span>
            <p className="text-xs text-slate-500">
              Show session management (open/close day) in the sidebar and home
              screen
            </p>
          </div>
          <div
            className={clsx(
              "relative w-10 h-5 rounded-full transition-colors",
              sessionMgmt ? "bg-violet-600" : "bg-slate-600",
            )}
            onClick={() => setSessionMgmt(!sessionMgmt)}
          >
            <div
              className={clsx(
                "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform",
                sessionMgmt ? "translate-x-5" : "translate-x-0.5",
              )}
            />
          </div>
        </label>

        <label className="flex items-center justify-between cursor-pointer group">
          <div>
            <span className="text-sm text-white">Customer Sessions</span>
            <p className="text-xs text-slate-500">
              Show the floating customer session button in the app
            </p>
          </div>
          <div
            className={clsx(
              "relative w-10 h-5 rounded-full transition-colors",
              customerSessions ? "bg-violet-600" : "bg-slate-600",
            )}
            onClick={() => setCustomerSessions(!customerSessions)}
          >
            <div
              className={clsx(
                "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform",
                customerSessions ? "translate-x-5" : "translate-x-0.5",
              )}
            />
          </div>
        </label>

        <label className="flex items-center justify-between cursor-pointer group">
          <div>
            <span className="text-sm text-white">Auto-check for Updates</span>
            <p className="text-xs text-slate-500">
              Automatically check for app updates when the app starts
            </p>
          </div>
          <div
            className={clsx(
              "relative w-10 h-5 rounded-full transition-colors",
              autoCheckUpdates ? "bg-violet-600" : "bg-slate-600",
            )}
            onClick={() => setAutoCheckUpdates(!autoCheckUpdates)}
          >
            <div
              className={clsx(
                "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform",
                autoCheckUpdates ? "translate-x-5" : "translate-x-0.5",
              )}
            />
          </div>
        </label>
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

      {/* UI Scale */}
      <div className="pt-6 border-t border-slate-700">
        <span className="block text-sm text-slate-400 mb-3">UI Scale</span>
        <div className="flex gap-4 items-start">
          <div className="flex items-center gap-3">
            <Monitor size={20} className="text-slate-400" />
            <div className="flex gap-1">
              {UI_SCALE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleUiScaleChange(opt.value)}
                  className={clsx(
                    "px-3 py-2 rounded-lg text-sm font-medium transition-all",
                    uiScale === opt.value
                      ? "bg-violet-600 text-white shadow-lg shadow-violet-900/30"
                      : "bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-white",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Scale the entire app UI. Use a smaller scale on POS screens to fit
          more content, or a larger scale for touch displays.
        </p>
      </div>
    </div>
  );
}
