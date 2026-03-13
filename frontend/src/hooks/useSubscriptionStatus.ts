import { useState, useEffect, useCallback } from "react";
import { requestJson, type ApiError } from "@/api/httpClient";

export interface SubscriptionInfo {
  isValid: boolean;
  shopName?: string;
  plan?: string;
  status?: string;
  error?: string;
  expiresAt?: string;
  isCached?: boolean;
  isOffline?: boolean;
  validatedAt?: number;
}

interface UseSubscriptionStatusResult {
  subscription: SubscriptionInfo | null;
  isLoading: boolean;
  isOffline: boolean;
  error: string | null;
  validate: (forceRefresh?: boolean) => Promise<void>;
  clearCache: () => void;
}

/**
 * Hook to check subscription status with offline support
 *
 * Usage:
 * const { subscription, isLoading, isOffline, validate } = useSubscriptionStatus();
 *
 * Features:
 * - Automatically validates on mount
 * - Supports offline mode with cached validation
 * - Provides manual validation function
 * - Handles loading and error states
 */
export function useSubscriptionStatus(): UseSubscriptionStatusResult {
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validate = useCallback(async (forceRefresh: boolean = false) => {
    setIsLoading(true);
    setError(null);

    try {
      // Check online status
      const online = navigator.onLine;
      setIsOffline(!online);

      // Call backend subscription validation endpoint via httpClient
      // (uses correct base URL and attaches Authorization header automatically)
      const data = await requestJson<{
        success: boolean;
        data?: {
          isValid: boolean;
          shopName?: string;
          plan?: string;
          status?: string;
          error?: string;
          expiresAt?: string;
          isCached?: boolean;
          isOffline?: boolean;
          validatedAt?: number;
        };
      }>("/api/subscription/validate-self", {
        method: "POST",
        body: { forceRefresh },
      });

      if (data.success && data.data) {
        setSubscription(data.data);
      } else {
        setSubscription({
          isValid: true,
          isCached: false,
          isOffline: false,
          validatedAt: Date.now(),
        });
      }
    } catch (err: any) {
      const apiError = err as ApiError;

      if (apiError.status === 403) {
        // Subscription invalid — backend explicitly rejected
        const details = (apiError.details as any)?.error?.details;
        const message = (apiError.details as any)?.error?.message;
        setSubscription({
          isValid: false,
          ...details,
          error: message || "Subscription invalid",
          isCached: false,
          isOffline: false,
          validatedAt: Date.now(),
        });
        return;
      }

      if (apiError.status === 503) {
        // Service unavailable (offline)
        setIsOffline(true);
      }

      setError(err.message || "Failed to validate subscription");

      // On error, mark subscription as invalid unless we're offline
      if (!navigator.onLine) {
        // Offline — keep existing subscription data if available
      } else {
        // Online but validation failed — mark as invalid
        setSubscription({
          isValid: false,
          error: err.message || "Subscription validation failed",
          isCached: false,
          isOffline: false,
          validatedAt: Date.now(),
        });
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clearCache = useCallback(() => {
    setSubscription(null);
  }, []);

  // Auto-validate on mount
  useEffect(() => {
    validate();

    // Listen for online/offline events
    const handleOnline = () => {
      setIsOffline(false);
      // Re-validate when coming back online
      validate(true);
    };

    const handleOffline = () => {
      setIsOffline(true);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [validate]);

  return {
    subscription,
    isLoading,
    isOffline,
    error,
    validate,
    clearCache,
  };
}

export default useSubscriptionStatus;
