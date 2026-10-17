import { useState, useEffect } from "react";
import { Lock, Save, Send, CheckCircle, AlertCircle } from "lucide-react";
import logger from "@/utils/logger";
import { useApi } from "@liratek/ui";
import PasswordInput from "@/shared/components/PasswordInput";
import { useTranslation } from "react-i18next";

export default function IntegrationsConfig() {
  const { t } = useTranslation("settings");
  const api = useApi();
  const [whatsAppApiKey, setWhatsAppApiKey] = useState("");
  const [whatsAppPhoneNumberId, setWhatsAppPhoneNumberId] = useState("");
  const [testPhone, setTestPhone] = useState("81077357");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setIsLoading(true);
    try {
      const settings = await api.getAllSettings();
      const settingsMap = new Map(
        settings.map((s: { key_name: string; value: string }) => [
          s.key_name,
          s.value,
        ]),
      );
      setWhatsAppApiKey((settingsMap.get("whatsapp_api_key") as string) || "");
      setWhatsAppPhoneNumberId(
        (settingsMap.get("whatsapp_phone_number_id") as string) || "",
      );
    } catch (error) {
      logger.error("Failed to load integration settings:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await Promise.all([
        api.updateSetting("whatsapp_api_key", whatsAppApiKey),
        api.updateSetting("whatsapp_phone_number_id", whatsAppPhoneNumberId),
      ]);
      alert(t("integrations.saved"));
    } catch (error) {
      logger.error("Failed to save integration settings:", error);
      alert(t("integrations.saveFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestMessage = async () => {
    if (!testPhone.trim()) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      // Save settings first to ensure latest values are used
      await Promise.all([
        api.updateSetting("whatsapp_api_key", whatsAppApiKey),
        api.updateSetting("whatsapp_phone_number_id", whatsAppPhoneNumberId),
      ]);
      const result = await api.sendWhatsAppTestMessage(testPhone, "LiraTek");
      if (result.success) {
        setTestResult({
          success: true,
          message: t("integrations.sent", { id: result.messageId || "OK" }),
        });
      } else {
        setTestResult({
          success: false,
          message: result.error || t("integrations.unknownError"),
        });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setTestResult({ success: false, message: msg });
    } finally {
      setIsTesting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="text-slate-400 animate-pulse py-8 text-center">
        {t("common:state.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Lock size={20} className="text-amber-500" />
          {t("integrations.title")}
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          {t("integrations.intro")}
        </p>
      </div>

      <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          WhatsApp Cloud API
        </h3>

        <PasswordInput
          value={whatsAppApiKey}
          onChange={setWhatsAppApiKey}
          label={t("integrations.accessToken")}
          placeholder={t("integrations.accessTokenPlaceholder")}
        />

        <div>
          <label
            htmlFor="whatsAppPhoneNumberId"
            className="block text-sm font-medium text-slate-400 mb-2"
          >
            {t("integrations.phoneNumberId")}
          </label>
          <input
            type="text"
            id="whatsAppPhoneNumberId"
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 transition-colors"
            value={whatsAppPhoneNumberId}
            onChange={(e) => setWhatsAppPhoneNumberId(e.target.value)}
            placeholder={t("integrations.phoneNumberIdPlaceholder")}
          />
          <p className="text-xs text-slate-500 mt-1">
            {t("integrations.phoneNumberIdHint")}
          </p>
        </div>
      </div>

      {/* Test section */}
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          {t("integrations.test")}
        </h3>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label
              htmlFor="testPhone"
              className="block text-sm font-medium text-slate-400 mb-2"
            >
              {t("integrations.recipient")}
            </label>
            <input
              type="text"
              id="testPhone"
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 transition-colors"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder={t("integrations.recipientPlaceholder")}
            />
          </div>
          <button
            onClick={handleTestMessage}
            disabled={isTesting || !whatsAppApiKey || !whatsAppPhoneNumberId}
            className="flex items-center gap-2 px-5 py-3 rounded-lg font-bold bg-green-600 hover:bg-green-500 text-white shadow-lg active:scale-[0.98] transition-all disabled:bg-slate-600 disabled:cursor-not-allowed whitespace-nowrap"
          >
            <Send size={16} />
            {isTesting ? t("integrations.sending") : t("integrations.sendTest")}
          </button>
        </div>

        {testResult && (
          <div
            className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
              testResult.success
                ? "bg-green-900/30 border border-green-700 text-green-300"
                : "bg-red-900/30 border border-red-700 text-red-300"
            }`}
          >
            {testResult.success ? (
              <CheckCircle size={16} />
            ) : (
              <AlertCircle size={16} />
            )}
            {testResult.message}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-2 px-6 py-3 rounded-lg font-bold bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-900/20 active:scale-[0.98] transition-all disabled:bg-slate-600 disabled:cursor-not-allowed"
        >
          <Save size={18} />
          {isSaving ? t("common:state.saving") : t("common:actions.save")}
        </button>
      </div>
    </div>
  );
}
