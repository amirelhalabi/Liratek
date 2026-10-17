import { useEffect, useRef, useState } from "react";
import logger from "@/utils/logger";
import { appEvents, useApi, DecimalInput, Select } from "@liratek/ui";
import { Printer, Wallet } from "lucide-react";
import clsx from "clsx";
import { useFeatureFlags } from "@/contexts/FeatureFlagContext";
import { invalidateShopInfo } from "@/hooks/useShopName";
import { Link } from "react-router-dom";
import { getApiErrorMessage } from "@/shared/utils/apiErrorMessage";
import {
  WARRANTY_TERMS_MAX_LENGTH,
  WARRANTY_TERMS_SETTING_KEY,
  RECEIPT_LANGUAGE_SETTING_KEY,
  UI_DEFAULT_LANGUAGE_SETTING_KEY,
  isLanguage,
  type Language,
} from "@liratek/core";
import { useTranslation } from "react-i18next";
import { isArabicAvailable } from "@/i18n/arabicGate";

/**
 * LIRA-331: the two language selects are shown only when the OD-4 gate allows
 * Arabic on this device, so shops see no change before Arabic is released.
 * A language key is written only when the admin changed it — saving the form
 * never rewrites a stored value (e.g. Arabic from a signup on the Arabic
 * landing) or adds rows for shops that never touched it.
 */
const LANGUAGE_OPTIONS: Language[] = ["en", "ar"];

export default function ShopConfig() {
  const api = useApi();
  const { t } = useTranslation("common");
  const { refreshFlags } = useFeatureFlags();
  // LIRA-331: shop default UI language and receipt language (missing = en).
  const [uiDefaultLanguage, setUiDefaultLanguage] = useState<Language>("en");
  const [receiptLanguage, setReceiptLanguage] = useState<Language>("en");
  const loadedLanguagesRef = useRef<{ ui: Language; receipt: Language }>({
    ui: "en",
    receipt: "en",
  });
  const [shopName, setShopName] = useState("");
  const [shopPhone, setShopPhone] = useState("");
  const [shopLocation, setShopLocation] = useState("");
  const [receiptHeaderText, setReceiptHeaderText] = useState("");
  // LIRA-296 — the shop's warranty terms, printed on warranty receipts.
  const [warrantyTermsText, setWarrantyTermsText] = useState("");
  // Receipt logo as a data URL (base64), "" = none. Printed above the receipt.
  const [receiptLogo, setReceiptLogo] = useState("");
  const [sessionMgmt, setSessionMgmt] = useState(true);
  const [customerSessions, setCustomerSessions] = useState(true);
  const [autoCheckUpdates, setAutoCheckUpdates] = useState(true);
  const [voiceBotEnabled, setVoiceBotEnabled] = useState(true);
  const [allowOutOfStockSales, setAllowOutOfStockSales] = useState(false);

  // Print settings
  const [printers, setPrinters] = useState<
    { name: string; displayName: string }[]
  >([]);
  const [receiptPrinter, setReceiptPrinter] = useState("");
  const [barcodePrinter, setBarcodePrinter] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  // Seed run 2026-10-16: a failed read used to fall through to a BLANK form
  // (saving it would overwrite the real settings) and a stalled one showed
  // "Loading..." forever. Now: the reason + Retry, and Retry when slow.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadSlow, setLoadSlow] = useState(false);
  const loadRequestRef = useRef(0);
  const [isSaving, setIsSaving] = useState(false);
  const [alfaCreditCost, setAlfaCreditCost] = useState("85000");
  const [alfaCreditSellRate, setAlfaCreditSellRate] = useState("100000");
  const [marginAlertThreshold, setMarginAlertThreshold] = useState("100000");

  const load = async () => {
    const requestId = ++loadRequestRef.current;
    setIsLoading(true);
    setLoadError(null);
    setLoadSlow(false);
    try {
      const settings = await api.getAllSettings();
      // A Retry overlapping a stalled read: only the newest one applies.
      if (loadRequestRef.current !== requestId) return;
      const map = new Map(settings.map((s: any) => [s.key_name, s.value]));
      setShopName((map.get("shop_name") as string) || "");
      setShopPhone((map.get("shop_phone") as string) || "");
      setShopLocation((map.get("shop_location") as string) || "");
      setReceiptHeaderText((map.get("receipt_header_text") as string) || "");
      setWarrantyTermsText(
        (map.get(WARRANTY_TERMS_SETTING_KEY) as string) || "",
      );
      setReceiptLogo((map.get("receipt_logo") as string) || "");
      const uiLang = map.get(UI_DEFAULT_LANGUAGE_SETTING_KEY);
      setUiDefaultLanguage(isLanguage(uiLang) ? uiLang : "en");
      const receiptLang = map.get(RECEIPT_LANGUAGE_SETTING_KEY);
      setReceiptLanguage(isLanguage(receiptLang) ? receiptLang : "en");
      loadedLanguagesRef.current = {
        ui: isLanguage(uiLang) ? uiLang : "en",
        receipt: isLanguage(receiptLang) ? receiptLang : "en",
      };
      setSessionMgmt(map.get("feature_session_management") !== "disabled");
      setCustomerSessions(map.get("feature_customer_sessions") !== "disabled");
      setAutoCheckUpdates(map.get("auto_check_updates") !== "0");
      setAllowOutOfStockSales(map.get("allow_out_of_stock_sales") === "1");
      setReceiptPrinter((map.get("receipt_printer") as string) || "");
      setBarcodePrinter((map.get("barcode_printer") as string) || "");
      setAlfaCreditCost((map.get("alfa_credit_cost_lbp") as string) || "85000");
      setAlfaCreditSellRate(
        (map.get("alfa_credit_sell_rate_lbp") as string) || "100000",
      );
      setMarginAlertThreshold(
        (map.get("recharge_margin_alert_threshold") as string) || "100000",
      );

      // Load voice bot setting from localStorage
      const voiceBotEnabledSetting = localStorage.getItem("voicebot_enabled");
      setVoiceBotEnabled(
        voiceBotEnabledSetting !== null
          ? voiceBotEnabledSetting === "true"
          : true,
      );

      // Load available printers if running in Electron
      if (window.api?.print?.getPrinters) {
        try {
          const sysPrinters = await window.api.print.getPrinters();
          setPrinters(sysPrinters);
        } catch (e) {
          logger.error("Failed to fetch system printers", { error: e });
        }
      }
    } catch (e) {
      if (loadRequestRef.current !== requestId) return;
      logger.error("Failed to load shop settings", { error: e });
      setLoadError(getApiErrorMessage(e, "Failed to load settings"));
    } finally {
      if (loadRequestRef.current === requestId) setIsLoading(false);
    }
  };

  // Read an uploaded image, downscale it (cap width + re-encode) so the
  // base64 stored in settings — and injected into every printed receipt —
  // stays small. Thermal receipts are ~80mm, so a 384px-wide logo is plenty.
  const handleLogoUpload = (file: File) => {
    if (!file.type.startsWith("image/")) {
      appEvents.emit(
        "notification:show",
        "Please choose an image file for the logo",
        "warning",
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      // document.createElement, not `new Image()`: an `Image` icon import
      // would shadow the DOM constructor (this file had one until LIRA-292).
      const img = document.createElement("img");
      img.onload = () => {
        const MAX_W = 384;
        const scale = Math.min(1, MAX_W / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, w, h);
        // PNG preserves logos with transparency / sharp edges best.
        setReceiptLogo(canvas.toDataURL("image/png"));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
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
        api.updateSetting(WARRANTY_TERMS_SETTING_KEY, warrantyTermsText),
        api.updateSetting("receipt_logo", receiptLogo),
        ...(uiDefaultLanguage !== loadedLanguagesRef.current.ui
          ? [
              api.updateSetting(
                UI_DEFAULT_LANGUAGE_SETTING_KEY,
                uiDefaultLanguage,
              ),
            ]
          : []),
        ...(receiptLanguage !== loadedLanguagesRef.current.receipt
          ? [api.updateSetting(RECEIPT_LANGUAGE_SETTING_KEY, receiptLanguage)]
          : []),
        api.updateSetting(
          "feature_session_management",
          sessionMgmt ? "enabled" : "disabled",
        ),
        api.updateSetting(
          "feature_customer_sessions",
          customerSessions ? "enabled" : "disabled",
        ),
        api.updateSetting("auto_check_updates", autoCheckUpdates ? "1" : "0"),
        api.updateSetting(
          "allow_out_of_stock_sales",
          allowOutOfStockSales ? "1" : "0",
        ),
        api.updateSetting("receipt_printer", receiptPrinter),
        api.updateSetting("barcode_printer", barcodePrinter),
        api.updateSetting("alfa_credit_cost_lbp", alfaCreditCost),
        api.updateSetting("alfa_credit_sell_rate_lbp", alfaCreditSellRate),
        api.updateSetting(
          "recharge_margin_alert_threshold",
          marginAlertThreshold,
        ),
      ]);

      // Save voice bot setting to localStorage
      localStorage.setItem("voicebot_enabled", String(voiceBotEnabled));
      window.dispatchEvent(new Event("voicebot-settings-changed"));

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isLoading) return;
    const timer = window.setTimeout(() => setLoadSlow(true), 10_000);
    return () => window.clearTimeout(timer);
  }, [isLoading]);

  if (isLoading)
    return (
      <div className="text-slate-400">
        Loading...
        {loadSlow && (
          <span
            data-testid="shop-config-slow"
            className="ms-2 inline-flex items-center gap-2 text-sm"
          >
            This is taking longer than usual.
            <button
              type="button"
              onClick={() => void load()}
              className="px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs"
            >
              Retry
            </button>
          </span>
        )}
      </div>
    );
  if (loadError)
    return (
      <div
        data-testid="shop-config-load-error"
        className="flex items-center gap-3 text-sm text-red-400"
      >
        <span>Could not load the shop settings: {loadError}</span>
        <button
          type="button"
          onClick={() => void load()}
          className="px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs"
        >
          Retry
        </button>
      </div>
    );

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

      {/* LIRA-331 — the shop's default UI language (for anyone who has not
          chosen one in My account) and the language receipts print in. */}
      {isArabicAvailable() && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="shop-ui-default-language"
              className="block text-sm text-slate-400 mb-2"
            >
              {t("language.shopDefault")}
            </label>
            <select
              id="shop-ui-default-language"
              value={uiDefaultLanguage}
              onChange={(e) => {
                if (isLanguage(e.target.value))
                  setUiDefaultLanguage(e.target.value);
              }}
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white"
            >
              {LANGUAGE_OPTIONS.map((code) => (
                <option key={code} value={code}>
                  {t(`language.${code}`)}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">
              {t("language.shopDefaultHint")}
            </p>
          </div>
          <div>
            <label
              htmlFor="shop-receipt-language"
              className="block text-sm text-slate-400 mb-2"
            >
              {t("language.receipt")}
            </label>
            <select
              id="shop-receipt-language"
              value={receiptLanguage}
              onChange={(e) => {
                if (isLanguage(e.target.value))
                  setReceiptLanguage(e.target.value);
              }}
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white"
            >
              {LANGUAGE_OPTIONS.map((code) => (
                <option key={code} value={code}>
                  {t(`language.${code}`)}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">
              {t("language.receiptHint")}
            </p>
          </div>
        </div>
      )}

      {/* LIRA-296 — warranty terms, printed under the items on any receipt
          that has a warranty line. */}
      <div>
        <label
          htmlFor="shop-warranty-terms"
          className="block text-sm text-slate-400 mb-2"
        >
          Warranty terms
        </label>
        <textarea
          id="shop-warranty-terms"
          value={warrantyTermsText}
          maxLength={WARRANTY_TERMS_MAX_LENGTH}
          rows={3}
          placeholder="e.g. Covers manufacturing faults only. No water or physical damage."
          onChange={(e) => setWarrantyTermsText(e.target.value)}
          className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white text-sm"
        />
        <p className="text-xs text-slate-500 mt-1">
          Printed on receipts that include an item with a warranty (
          {warrantyTermsText.length}/{WARRANTY_TERMS_MAX_LENGTH}).
        </p>
      </div>

      {/* Receipt logo (RCP-0): printed above the receipt text on every module. */}
      <div>
        <label className="block text-sm text-slate-400 mb-2">
          Receipt Logo
        </label>
        <div className="flex items-center gap-4">
          {receiptLogo ? (
            <img
              src={receiptLogo}
              alt="Receipt logo preview"
              className="h-16 max-w-[160px] object-contain bg-white rounded p-1 border border-slate-700"
            />
          ) : (
            <div className="h-16 w-24 flex items-center justify-center rounded border border-dashed border-slate-700 text-xs text-slate-500">
              No logo
            </div>
          )}
          <div className="flex flex-col gap-2">
            <label className="cursor-pointer inline-block px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-sm text-white">
              {receiptLogo ? "Change logo" : "Upload logo"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleLogoUpload(file);
                  e.target.value = "";
                }}
              />
            </label>
            {receiptLogo && (
              <button
                type="button"
                onClick={() => setReceiptLogo("")}
                className="px-3 py-1.5 bg-red-900/40 hover:bg-red-900/60 rounded text-sm text-red-300"
              >
                Remove
              </button>
            )}
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Shown centered at the top of every printed receipt. Auto-resized for
          the thermal printer.
        </p>
      </div>

      <div className="pt-6 border-t border-slate-700">
        <span className="flex items-center gap-2 block text-sm text-slate-400 mb-4">
          <Wallet size={16} /> Alfa Gift Card Settings
        </span>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="alfa-credit-cost"
              className="block text-xs text-slate-400 mb-1.5"
            >
              Credit Cost (LBP per $1)
            </label>
            <DecimalInput
              id="alfa-credit-cost"
              value={parseFloat(alfaCreditCost) || 0}
              onChange={(n) => setAlfaCreditCost(n ? String(n) : "")}
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white"
            />
            <p className="text-xs text-slate-500 mt-1">
              Default: 85,000 LBP per $1 USD credit
            </p>
          </div>
          <div>
            <label
              htmlFor="alfa-credit-sell"
              className="block text-xs text-slate-400 mb-1.5"
            >
              Credit Sell Rate (LBP per $1)
            </label>
            <DecimalInput
              id="alfa-credit-sell"
              value={parseFloat(alfaCreditSellRate) || 0}
              onChange={(n) => setAlfaCreditSellRate(n ? String(n) : "")}
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white"
            />
            <p className="text-xs text-slate-500 mt-1">
              Default: 100,000 LBP per $1 USD credit
            </p>
          </div>
        </div>
      </div>

      <div className="pt-6 border-t border-slate-700">
        <span className="flex items-center gap-2 block text-sm text-slate-400 mb-4">
          <Wallet size={16} /> Recharge Margin Alert
        </span>
        <div className="max-w-xs">
          <label
            htmlFor="margin-alert-threshold"
            className="block text-xs text-slate-400 mb-1.5"
          >
            Margin Alert Threshold (LBP)
          </label>
          <DecimalInput
            id="margin-alert-threshold"
            value={parseFloat(marginAlertThreshold) || 0}
            onChange={(n) => setMarginAlertThreshold(n ? String(n) : "")}
            className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white"
          />
          <p className="text-xs text-slate-500 mt-1">
            Show a warning badge on recharge history entries where the price was
            manually changed and the margin exceeds this amount. Default:
            100,000 LBP
          </p>
        </div>
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
            <Select
              value={receiptPrinter}
              onChange={(v) => setReceiptPrinter(v)}
              options={[
                { value: "", label: "Default (System Print Dialog)" },
                ...printers.map((p) => ({
                  value: p.name,
                  label: p.displayName || p.name,
                })),
              ]}
              buttonClassName="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white"
            />
            <p className="text-xs text-slate-500 mt-1">
              Leave empty to show the print dialog every time.
            </p>
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-2">
              Barcode Printer
            </label>
            <Select
              value={barcodePrinter}
              onChange={(v) => setBarcodePrinter(v)}
              options={[
                { value: "", label: "Default (System Print Dialog)" },
                ...printers.map((p) => ({
                  value: p.name,
                  label: p.displayName || p.name,
                })),
              ]}
              buttonClassName="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white"
            />
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

        <label className="flex items-center justify-between cursor-pointer group">
          <div className="flex items-center gap-3">
            <div>
              <span className="text-sm text-white">Voice Bot</span>
              <p className="text-xs text-slate-500">
                Show or hide the voice assistant button
              </p>
            </div>
          </div>
          <div
            className={clsx(
              "relative w-10 h-5 rounded-full transition-colors",
              voiceBotEnabled ? "bg-violet-600" : "bg-slate-600",
            )}
            onClick={() => setVoiceBotEnabled(!voiceBotEnabled)}
          >
            <div
              className={clsx(
                "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform",
                voiceBotEnabled ? "translate-x-5" : "translate-x-0.5",
              )}
            />
          </div>
        </label>

        <label className="flex items-center justify-between cursor-pointer group">
          <div className="flex items-center gap-3">
            <div>
              <span className="text-sm text-white">
                Allow out-of-stock sales
              </span>
              <p className="text-xs text-slate-500">
                When on, a sale completes even if an item is out of stock (stock
                may go negative). When off, the sale is blocked.
              </p>
            </div>
          </div>
          <div
            className={clsx(
              "relative w-10 h-5 rounded-full transition-colors",
              allowOutOfStockSales ? "bg-violet-600" : "bg-slate-600",
            )}
            onClick={() => setAllowOutOfStockSales(!allowOutOfStockSales)}
          >
            <div
              className={clsx(
                "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform",
                allowOutOfStockSales ? "translate-x-5" : "translate-x-0.5",
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

      {/* LIRA-292: the per-device display options (navigation style, POS
          display, auto-fill, UI scale) live on My account now, so staff can
          set their own. */}
      <p className="pt-6 border-t border-slate-700 text-sm text-slate-400">
        Display options moved to{" "}
        <Link to="/account" className="text-violet-400 hover:text-violet-300">
          My account
        </Link>
        .
      </p>
    </div>
  );
}
