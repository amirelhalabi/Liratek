/**
 * useDrawerAmounts Hook
 * Manages drawer amount state and operations
 */

import { useState, useCallback, useMemo } from "react";
import type { DrawerType, DrawerBalances, Currency } from "../types";
import { DRAWER_ORDER } from "../config/drawers";

interface UseDrawerAmountsProps {
  currencies: Currency[];
}

export function useDrawerAmounts({ currencies }: UseDrawerAmountsProps) {
  const [amounts, setAmounts] = useState<Record<DrawerType, DrawerBalances>>({} as Record<DrawerType, DrawerBalances>);

  // Initialize amounts when currencies change
  const initializeAmounts = useCallback(() => {
    const init: Record<DrawerType, DrawerBalances> = {} as Record<DrawerType, DrawerBalances>;
    
    DRAWER_ORDER.forEach((drawer) => {
      init[drawer] = {};
      currencies.forEach((currency) => {
        init[drawer][currency.code] = 0;
      });
    });
    
    setAmounts(init);
  }, [currencies]);

  // Update a specific amount
  const updateAmount = useCallback((drawer: DrawerType, currencyCode: string, value: number) => {
    setAmounts((prev) => ({
      ...prev,
      [drawer]: {
        ...prev[drawer],
        [currencyCode]: value,
      },
    }));
  }, []);

  // Get display value
  // IMPORTANT: We must NOT hide `0` as an empty string, otherwise typing values like `0.5`
  // becomes impossible (the first `0` would immediately render back to "").
  const getDisplayValue = useCallback(
    (drawer: DrawerType, currencyCode: string): string => {
      const value = amounts[drawer]?.[currencyCode];
      if (value === undefined) return "";
      return value.toString();
    },
    [amounts],
  );

  // Validate all amounts
  const validate = useCallback((): { isValid: boolean; errors: string[] } => {
    const errors: string[] = [];

    DRAWER_ORDER.forEach((drawer) => {
      currencies.forEach((currency) => {
        const value = amounts[drawer]?.[currency.code];
        if (value === undefined) {
          errors.push(`Missing amount for ${drawer} - ${currency.code}`);
        } else if (isNaN(value)) {
          errors.push(`Invalid amount for ${drawer} - ${currency.code}`);
        } else if (value < 0) {
          errors.push(`Negative amount for ${drawer} - ${currency.code}`);
        }
      });
    });

    return {
      isValid: errors.length === 0,
      errors,
    };
  }, [amounts, currencies]);

  // Check if any amounts have been entered
  const hasAnyAmounts = useMemo(() => {
    return DRAWER_ORDER.some((drawer) => 
      currencies.some((currency) => {
        const value = amounts[drawer]?.[currency.code];
        return value !== undefined && value > 0;
      })
    );
  }, [amounts, currencies]);

  // Reset all amounts
  const reset = useCallback(() => {
    initializeAmounts();
  }, [initializeAmounts]);

  return {
    amounts,
    updateAmount,
    getDisplayValue,
    validate,
    hasAnyAmounts,
    reset,
    initializeAmounts,
  };
}
