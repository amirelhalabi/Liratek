import { useState, useEffect } from "react";
import { Save, Send, CheckCircle, AlertCircle } from "lucide-react";
import logger from "@/utils/logger";
import { useApi } from "@liratek/ui";
import PasswordInput from "@/shared/components/PasswordInput";
import { useTranslation } from "react-i18next";
import {
  SettingsSectionHeading,
  SETTINGS_FORM_WIDTH,
  SETTINGS_INPUT,
  SETTINGS_LABEL,
  SETTINGS_PRIMARY_BUTTON,
} from "./settingsUi";

export default function IntegrationsConfig() {
  const { t } = useTranslation(["settings", "common"]);
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
    <div className={`space-y-8 ${SETTINGS_FORM_WIDTH}`}>
      <div className="space-y-4">
        <SettingsSectionHeading>
          {t("integrations.whatsappCloud")}
        </SettingsSectionHeading>

        <PasswordInput
          value={whatsAppApiKey}
          onChange={setWhatsAppApiKey}
          label={t("integrations.accessToken")}
          placeholder={t("integrations.accessTokenPlaceholder")}
          labelClassName={SETTINGS_LABEL}
          inputClassName={SETTINGS_INPUT}
        />

        <div>
          <label
            htmlFor="whatsAppPhoneNumberId"
            className={SETTINGS_LABEL}
          >
            {t("integrations.phoneNumberId")}
          </label>
          <input
            type="text"
            id="whatsAppPhoneNumberId"
            className={SETTINGS_INPUT}
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
      <div className="space-y-4">
        <SettingsSectionHeading>{t("integrations.test")}</SettingsSectionHeading>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label
              htmlFor="testPhone"
              className={SETTINGS_LABEL}
            >
              {t("integrations.recipient")}
            </label>
            <input
              type="text"
              id="testPhone"
              className={SETTINGS_INPUT}
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder={t("integrations.recipientPlaceholder")}
            />
          </div>
          <button
            onClick={handleTestMessage}
            disabled={isTesting || !whatsAppApiKey || !whatsAppPhoneNumberId}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-green-600 hover:bg-green-500 text-white transition-colors disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed whitespace-nowrap"
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

      <div>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className={`inline-flex items-center gap-2 ${SETTINGS_PRIMARY_BUTTON}`}
        >
          <Save size={16} />
          {isSaving ? t("common:state.saving") : t("common:actions.save")}
        </button>
      </div>
    </div>
  );
}
