import { logger } from "@liratek/core";
import type { ClientData } from "./GoogleSheetsService";

interface CacheEntry {
  data: ClientData;
  cachedAt: number;
}

class SubscriptionCacheService {
  private cache: Map<string, CacheEntry> = new Map();
  private ttlMs: number;

  constructor(ttlHours: number = 12) {
    this.ttlMs = ttlHours * 60 * 60 * 1000;
    logger.info({ ttlHours }, "Subscription cache initialized");
  }

  /**
   * Set client data in cache
   */
  set(shopName: string, data: ClientData): void {
    this.cache.set(shopName, {
      data,
      cachedAt: Date.now(),
    });
    logger.debug({ shopName }, "Client data cached");
  }

  /**
   * Get client data from cache
   * Returns null if not found or expired
   */
  get(shopName: string): ClientData | null {
    const entry = this.cache.get(shopName);
    if (!entry) {
      return null;
    }

    const age = Date.now() - entry.cachedAt;
    if (age > this.ttlMs) {
      logger.debug(
        { shopName, age: Math.round(age / 1000) },
        "Cache entry expired",
      );
      this.cache.delete(shopName);
      return null;
    }

    logger.debug({ shopName, age: Math.round(age / 1000) }, "Cache hit");
    return entry.data;
  }

  /**
   * Get client by API key
   */
  getByApiKey(apiKey: string): ClientData | null {
    for (const [shopName, entry] of this.cache.entries()) {
      const age = Date.now() - entry.cachedAt;
      if (age > this.ttlMs) {
        this.cache.delete(shopName);
        continue;
      }

      if (entry.data.api_key === apiKey) {
        return entry.data;
      }
    }
    return null;
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    this.cache.clear();
    logger.info("Subscription cache cleared");
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; ttlHours: number } {
    return {
      size: this.cache.size,
      ttlHours: Math.round(this.ttlMs / (1000 * 60 * 60)),
    };
  }

  /**
   * Remove expired entries
   */
  cleanup(): number {
    let removed = 0;
    const now = Date.now();

    for (const [shopName, entry] of this.cache.entries()) {
      if (now - entry.cachedAt > this.ttlMs) {
        this.cache.delete(shopName);
        removed++;
      }
    }

    if (removed > 0) {
      logger.info({ removed }, "Cleaned up expired cache entries");
    }

    return removed;
  }
}

// Singleton instance
let instance: SubscriptionCacheService | null = null;

/**
 * Get or create cache service instance
 */
export function getSubscriptionCache(): SubscriptionCacheService {
  if (!instance) {
    const ttlHours = parseInt(process.env.CACHE_TTL_HOURS || "12", 10);
    instance = new SubscriptionCacheService(ttlHours);
  }

  return instance;
}

export default SubscriptionCacheService;
