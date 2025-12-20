/**
 * Opening Modal - Simplified Design
 * Matches platform design language
 */

import { useEffect, useState } from "react";
import { useAuth } from "../../../auth/context/AuthContext";
import type { DrawerType } from "../../types";
import { DRAWER_ORDER } from "../../config/drawers";
import { useCurrencies } from "../../hooks/useCurrencies";
import { useDrawerAmounts } from "../../hooks/useDrawerAmounts";
import { DrawerCard } from "../../components/DrawerCard";
import { X } from "lucide-react";

interface OpeningProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function Opening({ isOpen, onClose }: OpeningProps) {
  const { user } = useAuth();
  const { currencies, loading: currenciesLoading, error: currenciesError } = useCurrencies();
  const drawerAmounts = useDrawerAmounts({ currencies });
  
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Initialize amounts when currencies are loaded
  useEffect(() => {
    if (currencies.length > 0 && isOpen) {
      drawerAmounts.initializeAmounts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currencies, isOpen]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      drawerAmounts.reset();
      setSaveError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleAmountChange = (drawer: DrawerType, code: string, value: string) => {
    const numValue = value === "" ? 0 : parseFloat(value);
    drawerAmounts.updateAmount(drawer, code, isNaN(numValue) ? 0 : numValue);
  };

  const handleSave = async () => {
    setSaveError(null);
    
    // Validate
    const validation = drawerAmounts.validate();
    if (!validation.isValid) {
      setSaveError(validation.errors.join(", "));
      return;
    }

    if (!drawerAmounts.hasAnyAmounts) {
      setSaveError("Please enter at least one amount before saving.");
      return;
    }

    setSaving(true);
    setSaveError(null);

    const closingDate = new Date().toISOString().split("T")[0];
    const amounts = DRAWER_ORDER.flatMap((drawer) =>
      currencies.map((currency) => ({
        drawer_name: drawer,
        currency_code: currency.code,
        opening_amount: drawerAmounts.amounts[drawer]?.[currency.code] ?? 0,
      }))
    );

    try {
      const result = await window.api.closing.setOpeningBalances({
        closing_date: closingDate,
        amounts,
        ...(user?.id != null ? { user_id: user.id } : {}),
      });

      if (result.success) {
        alert("Opening balances saved successfully!");
        onClose();
      } else {
        setSaveError(result.error || "Failed to save opening balances");
      }
    } catch (error) {
      console.error("[Opening] Save error:", error);
      setSaveError(error instanceof Error ? error.message : "An unexpected error occurred");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (drawerAmounts.hasAnyAmounts) {
      if (confirm("You have unsaved changes. Are you sure you want to close?")) {
        onClose();
      }
    } else {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          handleCancel();
        }
      }}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden w-full max-w-6xl max-h-[90vh] flex flex-col shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-slate-700 bg-slate-800">
          <div>
            <h2 className="text-2xl font-bold text-white">Opening</h2>
            <p className="text-slate-400 text-sm mt-1">Set starting drawer amounts</p>
          </div>
          <button
            onClick={handleCancel}
            disabled={saving}
            className="text-slate-400 hover:text-white transition-colors disabled:opacity-50"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {currenciesLoading && (
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
              <p className="text-blue-200 text-sm">Loading currencies...</p>
            </div>
          )}

          {currenciesError && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
              <p className="text-red-200 text-sm">Error: {currenciesError}</p>
            </div>
          )}

          {saveError && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
              <p className="text-red-200 text-sm">{saveError}</p>
            </div>
          )}

          {!currenciesLoading && !currenciesError && currencies.length === 0 && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
              <p className="text-yellow-200 text-sm">
                No active currencies found. Please enable at least one currency in Settings → Currency Manager.
              </p>
            </div>
          )}

          {!currenciesLoading && !currenciesError && currencies.length > 0 && (
            <>
              <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
                <p className="text-slate-300 text-sm">
                  Enter the starting cash amount for each drawer and currency.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {DRAWER_ORDER.map((drawer) => {
                  // MTC and Alfa only use USD (credits stored in shop's phone)
                  const drawerCurrencies =
                    drawer === "MTC" || drawer === "Alfa"
                      ? currencies.filter((c) => c.code === "USD")
                      : currencies;

                  return (
                    <DrawerCard
                      key={drawer}
                      drawer={drawer}
                      currencies={drawerCurrencies}
                      getDisplayValue={(d, c) => drawerAmounts.getDisplayValue(d, c)}
                      onAmountChange={handleAmountChange}
                      disabled={saving}
                      focusRingColor="violet-500"
                    />
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-700 p-6 bg-slate-800">
          <div className="flex justify-end items-center gap-3">
            <button
              type="button"
              onClick={handleCancel}
              disabled={saving}
              className="px-4 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-700 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !drawerAmounts.hasAnyAmounts || currenciesLoading}
              className="px-6 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Saving..." : "Save & Start Day"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
