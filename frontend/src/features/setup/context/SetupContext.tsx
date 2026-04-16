/**
 * Setup Wizard Context
 *
 * Holds wizard state across steps and persists to sessionStorage
 * so a browser refresh restores the last completed step.
 */

import React, { createContext, useContext, useState, useEffect } from "react";

export interface SetupPayload {
  // Step 1
  shop_name: string;
  admin_username: string;
  admin_password: string;
  // Step 2
  enabled_modules: string[];
  enabled_payment_methods: string[];
  session_management_enabled: boolean;
  customer_sessions_enabled: boolean;
  // Step 3 (NEW) - Database Path
  database_path: string | null;
  database_type: "local" | "network";
  // Step 4 (optional)
  active_currencies: string[];
  // Step 5 (optional)
  extra_users: { username: string; password: string; role: string }[];
  whatsapp_phone: string;
  whatsapp_api_key: string;
}

const DEFAULT_PAYLOAD: SetupPayload = {
  shop_name: "",
  admin_username: "",
  admin_password: "",
  enabled_modules: ["pos", "inventory"],
  enabled_payment_methods: ["CASH", "OMT", "WHISH"],
  session_management_enabled: true,
  customer_sessions_enabled: true,
  database_path: null,
  database_type: "local",
  active_currencies: ["USD", "LBP"],
  extra_users: [],
  whatsapp_phone: "",
  whatsapp_api_key: "",
};

const STORAGE_KEY = "setup_wizard_state";

interface SetupContextValue {
  step: number;
  payload: SetupPayload;
  setStep: (step: number) => void;
  updatePayload: (partial: Partial<SetupPayload>) => void;
  resetWizard: () => void;
}

const SetupContext = createContext<SetupContextValue>({
  step: 1,
  payload: DEFAULT_PAYLOAD,
  setStep: () => {},
  updatePayload: () => {},
  resetWizard: () => {},
});

export function SetupProvider({ children }: { children: React.ReactNode }) {
  const [step, setStepState] = useState<number>(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved).step ?? 1;
    } catch {}
    return 1;
  });

  const [payload, setPayload] = useState<SetupPayload>(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) return { ...DEFAULT_PAYLOAD, ...JSON.parse(saved).payload };
    } catch {}
    return DEFAULT_PAYLOAD;
  });

  // Persist to sessionStorage on every change
  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ step, payload }));
  }, [step, payload]);

  const setStep = (s: number) => setStepState(s);

  const updatePayload = (partial: Partial<SetupPayload>) =>
    setPayload((prev) => ({ ...prev, ...partial }));

  const resetWizard = () => {
    sessionStorage.removeItem(STORAGE_KEY);
    setStepState(1);
    setPayload(DEFAULT_PAYLOAD);
  };

  return (
    <SetupContext.Provider
      value={{ step, payload, setStep, updatePayload, resetWizard }}
    >
      {children}
    </SetupContext.Provider>
  );
}

export function useSetup() {
  return useContext(SetupContext);
}
