import React, { useEffect, useState } from "react";
import { useSubscriptionStatus } from "../../hooks/useSubscriptionStatus";
import { useAuth } from "../../features/auth/context/AuthContext";

interface SubscriptionGuardProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  allowOffline?: boolean;
}

/**
 * Component to protect routes with subscription validation
 *
 * Features:
 * - Blocks access if subscription is invalid
 * - Allows offline access if previously validated
 * - Shows loading state during validation
 * - Provides user-friendly error messages
 *
 * Usage:
 * <SubscriptionGuard>
 *   <ProtectedContent />
 * </SubscriptionGuard>
 */
export function SubscriptionGuard({
  children,
  fallback: _fallback,
  allowOffline = true,
}: SubscriptionGuardProps) {
  const { subscription, isLoading, isOffline, error, validate } =
    useSubscriptionStatus();
  const { logout } = useAuth();
  const [showRetry, setShowRetry] = useState(false);

  // Handle subscription expiration during usage
  useEffect(() => {
    if (subscription && !subscription.isValid && !subscription.isOffline) {
      // Subscription is invalid and we're online - force logout after delay
      const timer = setTimeout(() => {
        logout();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [subscription, logout]);

  // Show loading state
  if (isLoading) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        <div style={{ fontSize: "18px", color: "#666" }}>
          Validating subscription...
        </div>
        {isOffline && (
          <div style={{ fontSize: "14px", color: "#999" }}>Working offline</div>
        )}
      </div>
    );
  }

  // Show error state if subscription is invalid
  if (subscription && !subscription.isValid && !subscription.isOffline) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
          flexDirection: "column",
          gap: "24px",
          padding: "24px",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: "24px", fontWeight: "bold", color: "#dc2626" }}>
          Subscription{" "}
          {subscription.status === "expired" ? "Expired" : "Invalid"}
        </div>

        <div style={{ fontSize: "16px", color: "#666", maxWidth: "400px" }}>
          {subscription.error ||
            "Your subscription is no longer active. Please contact support to renew."}
        </div>

        {subscription.shopName && (
          <div style={{ fontSize: "14px", color: "#999" }}>
            Shop: {subscription.shopName}
          </div>
        )}

        <div style={{ display: "flex", gap: "12px" }}>
          <button
            onClick={() =>
              (window.location.href = "mailto:support@liratek.com")
            }
            style={{
              padding: "12px 24px",
              backgroundColor: "#3b82f6",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "14px",
            }}
          >
            Contact Support
          </button>

          <button
            onClick={() => {
              setShowRetry(true);
              validate(true);
            }}
            style={{
              padding: "12px 24px",
              backgroundColor: "#f3f4f6",
              color: "#374151",
              border: "1px solid #d1d5db",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "14px",
            }}
          >
            Retry Validation
          </button>
        </div>

        {showRetry && isLoading && (
          <div style={{ fontSize: "14px", color: "#666" }}>Retrying...</div>
        )}
      </div>
    );
  }

  // Subscription validation failed (null result while online) — block access
  if (!subscription && !isLoading && !isOffline) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
          flexDirection: "column",
          gap: "24px",
          padding: "24px",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: "24px", fontWeight: "bold", color: "#dc2626" }}>
          Subscription Validation Failed
        </div>

        <div style={{ fontSize: "16px", color: "#666", maxWidth: "400px" }}>
          {error ||
            "Unable to verify your subscription. Please check your connection and try again."}
        </div>

        <button
          onClick={() => {
            setShowRetry(true);
            validate(true);
          }}
          style={{
            padding: "12px 24px",
            backgroundColor: "#3b82f6",
            color: "white",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            fontSize: "14px",
          }}
        >
          Retry Validation
        </button>

        {showRetry && isLoading && (
          <div style={{ fontSize: "14px", color: "#666" }}>Retrying...</div>
        )}
      </div>
    );
  }

  // Show offline warning if using cached data
  if (isOffline && subscription?.isCached && allowOffline) {
    return (
      <>
        {children}
        <div
          style={{
            position: "fixed",
            bottom: "20px",
            right: "20px",
            padding: "12px 20px",
            backgroundColor: "#fef3c7",
            border: "1px solid #f59e0b",
            borderRadius: "8px",
            fontSize: "14px",
            color: "#92400e",
            zIndex: 9999,
            boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
          }}
        >
          ⚠️ Working offline - Subscription status cached
        </div>
      </>
    );
  }

  // Show content if subscription is valid or we're allowing offline access
  return <>{children}</>;
}

export default SubscriptionGuard;
