/**
 * LIRA-331: a signed-in user's own preferences (today: the UI language).
 * Both transports call this (rule 19): `user-preferences:*` IPC and
 * `/api/user-preferences/me` REST. The actor is always the session/JWT user,
 * never a body field. No SQL here (rule 13).
 */
import {
  getUserRepository,
  type UserRepository,
} from "../repositories/UserRepository.js";
import {
  getSettingsRepository,
  type SettingsRepository,
} from "../repositories/SettingsRepository.js";
import { resolveEffectiveLanguage } from "../utils/effectiveLanguage.js";
import {
  setMyLanguageSchema,
  type MyPreferences,
  type SetMyLanguageInput,
} from "../validators/userPreferences.js";
import { NotFoundError, ValidationError } from "../utils/errors.js";

type UserLanguageRepo = Pick<UserRepository, "getLanguage" | "setLanguage">;
type ShopLanguageRepo = Pick<
  SettingsRepository,
  "getUiDefaultLanguage" | "getReceiptLanguage"
>;

export class UserPreferencesService {
  private readonly users: UserLanguageRepo;
  private readonly settings: ShopLanguageRepo;

  constructor(users?: UserLanguageRepo, settings?: ShopLanguageRepo) {
    this.users = users ?? getUserRepository();
    this.settings = settings ?? getSettingsRepository();
  }

  getMine(userId: number): MyPreferences {
    const language = this.users.getLanguage(userId);
    const shopDefaultLanguage = this.settings.getUiDefaultLanguage();
    return {
      language,
      effectiveLanguage: resolveEffectiveLanguage(language, shopDefaultLanguage),
      shopDefaultLanguage,
      receiptLanguage: this.settings.getReceiptLanguage(),
    };
  }

  setMine(userId: number, input: SetMyLanguageInput): MyPreferences {
    const parsed = setMyLanguageSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError("Unknown language", parsed.error.issues);
    }
    if (!this.users.setLanguage(userId, parsed.data.language)) {
      throw new NotFoundError("User", userId);
    }
    return this.getMine(userId);
  }
}

let instance: UserPreferencesService | null = null;

export function getUserPreferencesService(): UserPreferencesService {
  if (!instance) instance = new UserPreferencesService();
  return instance;
}

export function resetUserPreferencesService(): void {
  instance = null;
}
