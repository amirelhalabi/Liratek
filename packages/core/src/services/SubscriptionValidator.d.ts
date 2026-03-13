/**
 * Subscription Validator - Offline-First Implementation
 *
 * Validates subscription status with support for:
 * - Offline mode with cached validation
 * - Online mode with Google Sheets validation
 * - Graceful degradation when network is unavailable
 */
export interface SubscriptionStatus {
  isValid: boolean;
  shopName?: string;
  plan?: string;
  status?: string;
  error?: string;
  gracePeriodEnds?: string;
  expiresAt?: string;
  isCached: boolean;
  isOffline: boolean;
  validatedAt: number;
}
export interface SubscriptionCache {
  status: SubscriptionStatus;
  cachedAt: number;
  ttlMs: number;
}
declare class SubscriptionValidatorService {
  private cache;
  private isOnline;
  private validationInProgress;
  /**
   * Check if the device has internet connectivity
   */
  checkOnlineStatus(): Promise<boolean>;
  /**
   * Get cached subscription status if valid
   */
  getCachedStatus(): SubscriptionStatus | null;
  /**
   * Cache subscription status
   */
  cacheStatus(status: SubscriptionStatus, ttlMs?: number): void;
  /**
   * Clear subscription cache
   */
  clearCache(): void;
  /**
   * Validate subscription with offline support
   *
   * @param shopName - Shop/username to validate
   * @param validateFn - Function to validate subscription (calls Google Sheets or backend)
   * @param forceRefresh - Force refresh even if cache is valid
   * @returns Subscription status
   */
  validate(
    shopName: string,
    validateFn: (shopName: string) => Promise<SubscriptionStatus>,
    forceRefresh?: boolean,
  ): Promise<SubscriptionStatus>;
  /**
   * Perform the actual validation
   */
  private performValidation;
  /**
   * Get current online status
   */
  getOnlineStatus(): boolean;
  /**
   * Parse date from various formats (ISO string or Google Sheets serial number)
   */
  parseDate(dateValue: string | number | null | undefined): Date | null;
  /**
   * Check if a subscription has expired based on expires_at date
   */
  isSubscriptionExpired(expiresAt: string | number | null | undefined): boolean;
}
/**
 * Get or create the subscription validator instance
 */
export declare function getSubscriptionValidator(): SubscriptionValidatorService;
export default SubscriptionValidatorService;
//# sourceMappingURL=SubscriptionValidator.d.ts.map
