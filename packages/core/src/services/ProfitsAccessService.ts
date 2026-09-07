import {
  SettingsRepository,
  getSettingsRepository,
} from "../repositories/SettingsRepository.js";
import { hashPassword, verifyPassword } from "../utils/crypto.js";
import { PROFITS_PASSWORD_SETTING_KEY, PROFITS_PASSWORD_MIN_LENGTH } from "../constants/profitsAccess.js";
import { settingsLogger } from "../utils/logger.js";

/**
 * Profits password gate (frozen contract, agent A).
 *
 * The `profits` module is visible to both roles (migration v163); `/profits`
 * is protected by this per-page password instead of by role, admin included.
 * Fail-closed: `verify` returns false and `isPasswordSet` returns false when
 * nothing has been set yet — nobody enters until an admin sets one in
 * Settings › Profits Password.
 *
 * Goes through `SettingsRepository` directly (rule 13 — no SQL in services).
 * Deliberately does NOT go through `SettingsService`, which redacts
 * `PROFITS_PASSWORD_SETTING_KEY` from every read (see the comment on
 * `SENSITIVE_SETTING_KEYS` in SettingsService.ts) — this service IS the one
 * legitimate reader/writer of the hash.
 *
 * `setPassword` deliberately does NOT run `validatePasswordComplexity`
 * (packages/core/src/utils/crypto.ts) — the owner wants a short PIN to be a
 * legal profits password, unlike user account passwords. It only enforces
 * `PROFITS_PASSWORD_MIN_LENGTH`.
 */
export interface ProfitsPasswordResult {
  success: boolean;
  error?: string;
}

export class ProfitsAccessService {
  private repo: SettingsRepository;

  constructor(repo?: SettingsRepository) {
    this.repo = repo ?? getSettingsRepository();
  }

  /**
   * True only when a non-empty password hash has been stored.
   */
  isPasswordSet(): boolean {
    try {
      const value = this.repo.getSettingValue(PROFITS_PASSWORD_SETTING_KEY);
      return typeof value === "string" && value.length > 0;
    } catch (error) {
      settingsLogger.error(
        { error },
        "ProfitsAccessService.isPasswordSet failed",
      );
      return false;
    }
  }

  /**
   * Set (or replace) the profits password. Admin-only at the transport layer
   * (IPC role check / REST requireRole) — this service does not itself check
   * roles.
   */
  setPassword(plain: string): ProfitsPasswordResult {
    try {
      if (!plain || plain.length < PROFITS_PASSWORD_MIN_LENGTH) {
        return {
          success: false,
          error: `Password must be at least ${PROFITS_PASSWORD_MIN_LENGTH} characters`,
        };
      }

      const hash = hashPassword(plain);
      this.repo.upsertSetting(PROFITS_PASSWORD_SETTING_KEY, hash);
      settingsLogger.info("Profits password updated");
      return { success: true };
    } catch (error) {
      settingsLogger.error(
        { error },
        "ProfitsAccessService.setPassword failed",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Verify a candidate password against the stored hash. Fail-closed: false
   * when no password has been set yet (never falls back to a default).
   */
  verify(plain: string): boolean {
    try {
      const stored = this.repo.getSettingValue(PROFITS_PASSWORD_SETTING_KEY);
      if (!stored) return false;
      return verifyPassword(plain, stored);
    } catch (error) {
      settingsLogger.error({ error }, "ProfitsAccessService.verify failed");
      return false;
    }
  }
}

// Singleton instance
let profitsAccessServiceInstance: ProfitsAccessService | null = null;

export function getProfitsAccessService(): ProfitsAccessService {
  if (!profitsAccessServiceInstance) {
    profitsAccessServiceInstance = new ProfitsAccessService();
  }
  return profitsAccessServiceInstance;
}

export function resetProfitsAccessService(): void {
  profitsAccessServiceInstance = null;
}
