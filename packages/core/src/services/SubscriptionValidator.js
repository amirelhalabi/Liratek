/**
 * Subscription Validator - Offline-First Implementation
 *
 * Validates subscription status with support for:
 * - Offline mode with cached validation
 * - Online mode with Google Sheets validation
 * - Graceful degradation when network is unavailable
 */
const CACHE_TTL_DEFAULT = 60 * 60 * 1000; // 1 hour in milliseconds
class SubscriptionValidatorService {
  cache = null;
  isOnline = true;
  validationInProgress = null;
  /**
   * Check if the device has internet connectivity
   */
  async checkOnlineStatus() {
    // Browser environment
    if (typeof navigator !== "undefined") {
      if (!navigator.onLine) {
        return false;
      }
      // Try to reach a reliable endpoint
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const response = await fetch("https://www.google.com/favicon.ico", {
          method: "HEAD",
          signal: controller.signal,
          mode: "no-cors",
        });
        clearTimeout(timeoutId);
        return true;
      } catch {
        return false;
      }
    }
    // Node.js/Electron environment
    return true; // Assume online in Electron
  }
  /**
   * Get cached subscription status if valid
   */
  getCachedStatus() {
    if (!this.cache) {
      return null;
    }
    const now = Date.now();
    const isExpired = now - this.cache.cachedAt > this.cache.ttlMs;
    if (isExpired) {
      this.cache = null;
      return null;
    }
    return {
      ...this.cache.status,
      isCached: true,
    };
  }
  /**
   * Cache subscription status
   */
  cacheStatus(status, ttlMs = CACHE_TTL_DEFAULT) {
    this.cache = {
      status: {
        ...status,
        isCached: false,
      },
      cachedAt: Date.now(),
      ttlMs,
    };
  }
  /**
   * Clear subscription cache
   */
  clearCache() {
    this.cache = null;
  }
  /**
   * Validate subscription with offline support
   *
   * @param shopName - Shop/username to validate
   * @param validateFn - Function to validate subscription (calls Google Sheets or backend)
   * @param forceRefresh - Force refresh even if cache is valid
   * @returns Subscription status
   */
  async validate(shopName, validateFn, forceRefresh = false) {
    // Return existing validation if already in progress
    if (this.validationInProgress && !forceRefresh) {
      return this.validationInProgress;
    }
    try {
      this.validationInProgress = this.performValidation(
        shopName,
        validateFn,
        forceRefresh,
      );
      return await this.validationInProgress;
    } finally {
      this.validationInProgress = null;
    }
  }
  /**
   * Perform the actual validation
   */
  async performValidation(shopName, validateFn, forceRefresh) {
    const now = Date.now();
    // Check if we have valid cached data
    if (!forceRefresh) {
      const cached = this.getCachedStatus();
      if (cached) {
        return cached;
      }
    }
    // Check online status
    this.isOnline = await this.checkOnlineStatus();
    if (!this.isOnline) {
      // Offline mode - use cached data even if expired
      const expiredCache = this.cache;
      if (expiredCache) {
        return {
          ...expiredCache.status,
          isCached: true,
          isOffline: true,
          validatedAt: now,
        };
      }
      // No cache available while offline - allow access but mark as offline
      return {
        isValid: true,
        shopName,
        isCached: false,
        isOffline: true,
        validatedAt: now,
        error: "Offline mode - using cached permissions",
      };
    }
    // Online mode - validate from source
    try {
      const status = await validateFn(shopName);
      // Cache the result
      this.cacheStatus({
        ...status,
        isOffline: false,
        validatedAt: now,
      });
      return {
        ...status,
        isCached: false,
        isOffline: false,
        validatedAt: now,
      };
    } catch (error) {
      // Network error - fall back to cache
      const expiredCache = this.cache;
      if (expiredCache) {
        return {
          ...expiredCache.status,
          isCached: true,
          isOffline: true,
          validatedAt: now,
          error: `Validation failed: ${error.message}. Using cached status.`,
        };
      }
      // No cache and validation failed - fail open (allow access)
      return {
        isValid: true,
        shopName,
        isCached: false,
        isOffline: true,
        validatedAt: now,
        error: `Validation unavailable: ${error.message}`,
      };
    }
  }
  /**
   * Get current online status
   */
  getOnlineStatus() {
    return this.isOnline;
  }
  /**
   * Parse date from various formats (ISO string or Google Sheets serial number)
   */
  parseDate(dateValue) {
    if (!dateValue) {
      return null;
    }
    const value = String(dateValue).trim();
    // Try to parse as ISO date string
    const isoDate = new Date(value);
    if (!isNaN(isoDate.getTime())) {
      return isoDate;
    }
    // Try to parse as Google Sheets serial number (days since 1899-12-30)
    const serialNum = Number(value);
    if (!isNaN(serialNum)) {
      // Google Sheets uses days since 1899-12-30
      // Unix epoch is 1970-01-01, which is 25569 days after 1899-12-30
      return new Date((serialNum - 25569) * 86400 * 1000);
    }
    return null;
  }
  /**
   * Check if a subscription has expired based on expires_at date
   */
  isSubscriptionExpired(expiresAt) {
    const expiresDate = this.parseDate(expiresAt);
    if (!expiresDate) {
      return false; // No expiration date means no expiration
    }
    // Set to end of day to include the entire expiration day
    expiresDate.setHours(23, 59, 59, 999);
    return Date.now() > expiresDate.getTime();
  }
}
// Singleton instance
let instance = null;
/**
 * Get or create the subscription validator instance
 */
export function getSubscriptionValidator() {
  if (!instance) {
    instance = new SubscriptionValidatorService();
  }
  return instance;
}
export default SubscriptionValidatorService;
//# sourceMappingURL=SubscriptionValidator.js.map
