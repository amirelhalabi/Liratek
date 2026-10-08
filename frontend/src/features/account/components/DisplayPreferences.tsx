/**
 * Display (this device) — LIRA-292.
 *
 * The per-browser display preferences: navigation style, home items per row,
 * POS product display, POS auto-fill of the payment amount, and UI scale.
 * They live in this browser's localStorage, so they belong to the DEVICE, not
 * the shop. They used to sit in Settings → Shop Config, which is admin-only,
 * so a cashier could not size their own screen; they now live on My account
 * (every role). This is the ONE copy of these controls (rule 14): Shop Config
 * no longer renders them.
 *
 * The storage keys and window events are unchanged, because the rest of the
 * app reads them (MainLayout, ProductSearch, the POS checkout, App.tsx's
 * boot-time scale): `layout_mode` / `home_columns` → "layout-mode-changed",
 * `pos_show_images` → "pos-display-changed", `pos_autofill_payment`, and
 * `ui_scale` through `saveAndApplyUiScale`. Nobody's choice resets.
 *
 * No server call: works the same on desktop and web.
 */

import { useState } from "react";
import { PanelLeft, LayoutGrid, Image, List, Monitor } from "lucide-react";
import clsx from "clsx";
import { saveAndApplyUiScale } from "@/shared/utils/uiScale";

const UI_SCALE_OPTIONS = [
  { value: 0.75, label: "75%" },
  { value: 0.8, label: "80%" },
  { value: 0.85, label: "85%" },
  { value: 0.9, label: "90%" },
  { value: 1.0, label: "100%" },
  { value: 1.1, label: "110%" },
  { value: 1.25, label: "125%" },
];

export default function DisplayPreferences() {
  const [layoutMode, setLayoutMode] = useState(
    () => localStorage.getItem("layout_mode") || "left-panel",
  );
  const [columnsPerRow, setColumnsPerRow] = useState(
    () => Number(localStorage.getItem("home_columns")) || 5,
  );
  const [posShowImages, setPosShowImages] = useState(
    () => localStorage.getItem("pos_show_images") !== "false",
  );
  const [posAutofillPayment, setPosAutofillPayment] = useState(
    () => localStorage.getItem("pos_autofill_payment") !== "false",
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

  const handlePosAutofillPaymentChange = (enabled: boolean) => {
    setPosAutofillPayment(enabled);
    localStorage.setItem("pos_autofill_payment", String(enabled));
  };

  const handleUiScaleChange = (scale: number) => {
    setUiScale(scale);
    // Persist AND apply together. This used to write localStorage itself and
    // then apply only through Electron's webFrame, so on the web the control
    // saved a value and changed nothing — it looked like it worked.
    saveAndApplyUiScale(scale);
  };

  return (
    <section
      aria-labelledby="display-prefs-heading"
      className="rounded-xl border border-slate-700 bg-slate-800 p-4 pb-6 space-y-6"
    >
      <div>
        <h2
          id="display-prefs-heading"
          className="text-sm font-semibold text-white"
        >
          Display (this device)
        </h2>
        <p className="text-xs text-slate-500 mt-1">Saved on this device only</p>
      </div>

      {/* Navigation Style & POS Display Mode — side by side */}
      <div className="grid grid-cols-2 gap-8">
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

      {/* POS checkout */}
      <div className="pt-6 border-t border-slate-700">
        <label className="flex items-center justify-between cursor-pointer group">
          <div className="flex items-center gap-3">
            <div>
              <span className="text-sm text-white">
                Auto-fill Payment Amount
              </span>
              <p className="text-xs text-slate-500">
                Automatically fill the payment amount in POS checkout when the
                modal opens
              </p>
            </div>
          </div>
          <div
            className={clsx(
              "relative w-10 h-5 rounded-full transition-colors",
              posAutofillPayment ? "bg-violet-600" : "bg-slate-600",
            )}
            onClick={() => handlePosAutofillPaymentChange(!posAutofillPayment)}
          >
            <div
              className={clsx(
                "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform",
                posAutofillPayment ? "translate-x-5" : "translate-x-0.5",
              )}
            />
          </div>
        </label>
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
    </section>
  );
}
