/**
 * Authentication Service
 *
 * Business logic layer for authentication operations.
 * Uses UserRepository for data access and crypto utils for password handling.
 *
 * This service encapsulates:
 * - Login/logout logic
 * - Password verification and hashing
 * - Session management coordination
 * - Activity logging
 */

import { UserRepository, getUserRepository } from "../database/repositories";
import type { SafeUser, CreateUserData } from "../database/repositories";
import {
  hashPassword,
  verifyPassword,
  needsMigration,
  validatePasswordComplexity,
} from "../utils/crypto";
import {
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  ConflictError,
  BusinessRuleError,
} from "../utils/errors";

// =============================================================================
// Types
// =============================================================================

export interface LoginResult {
  success: boolean;
  user?: SafeUser;
  error?: string;
}

export interface CreateUserResult {
  success: boolean;
  user?: SafeUser;
  error?: string;
}

export interface ChangePasswordResult {
  success: boolean;
  error?: string;
}

// =============================================================================
// Auth Service Class
// =============================================================================

export class AuthService {
  private userRepo: UserRepository;

  constructor(userRepo?: UserRepository) {
    this.userRepo = userRepo ?? getUserRepository();
  }

  // ---------------------------------------------------------------------------
  // Authentication
  // ---------------------------------------------------------------------------

  /**
   * Authenticate a user with username and password
   */
  async login(username: string, password: string): Promise<LoginResult> {
    // Validate input
    if (!username?.trim()) {
      throw new ValidationError("Username is required");
    }
    if (!password) {
      throw new ValidationError("Password is required");
    }

    // Find user
    const user = this.userRepo.findByUsername(username.trim());
    if (!user) {
      throw new AuthenticationError("Invalid username or password");
    }

    // Verify password
    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      throw new AuthenticationError("Invalid username or password");
    }

    // Check if password needs migration (plain text or old hash)
    if (needsMigration(user.password_hash)) {
      const newHash = await hashPassword(password);
      this.userRepo.updatePassword(user.id, newHash);
    }

    // Return safe user (without password_hash)
    const safeUser = this.userRepo.findByIdSafe(user.id);
    if (!safeUser) {
      return { success: false, error: "Failed to load user profile" };
    }
    return { success: true, user: safeUser };
  }

  // ---------------------------------------------------------------------------
  // User Management
  // ---------------------------------------------------------------------------

  /**
   * Create a new user (admin only operation)
   */
  async createUser(
    data: { username: string; password: string; role: "admin" | "cashier" },
    actorRole: string,
  ): Promise<CreateUserResult> {
    // Authorization check
    if (actorRole !== "admin") {
      throw new AuthorizationError("Only administrators can create users");
    }

    // Validate username
    if (!data.username?.trim()) {
      throw new ValidationError("Username is required");
    }
    if (data.username.length < 3) {
      throw new ValidationError("Username must be at least 3 characters");
    }

    // Validate password
    const passwordValidation = validatePasswordComplexity(data.password);
    if (!passwordValidation.valid) {
      throw new ValidationError(passwordValidation.errors.join(", "));
    }

    // Check for duplicate username
    if (this.userRepo.usernameExists(data.username.trim())) {
      throw new ConflictError("Username already exists");
    }

    // Hash password and create user
    const passwordHash = await hashPassword(data.password);
    const createData: CreateUserData = {
      username: data.username.trim(),
      password_hash: passwordHash,
      role: data.role,
      is_active: 1,
    };

    const user = this.userRepo.createUser(createData);
    const safeUser = this.userRepo.findByIdSafe(user.id);
    if (!safeUser) {
      return { success: false, error: "Failed to load created user profile" };
    }

    return { success: true, user: safeUser };
  }

  /**
   * Change a user's password
   */
  async changePassword(
    userId: number,
    currentPassword: string,
    newPassword: string,
  ): Promise<ChangePasswordResult> {
    // Find user with password hash
    const user = this.userRepo.findById(userId);
    if (!user) {
      throw new AuthenticationError("User not found");
    }

    // Verify current password
    const isValid = await verifyPassword(currentPassword, user.password_hash);
    if (!isValid) {
      throw new AuthenticationError("Current password is incorrect");
    }

    // Validate new password
    const passwordValidation = validatePasswordComplexity(newPassword);
    if (!passwordValidation.valid) {
      throw new ValidationError(passwordValidation.errors.join(", "));
    }

    // Hash and update password
    const newHash = await hashPassword(newPassword);
    const updated = this.userRepo.updatePassword(userId, newHash);

    if (!updated) {
      throw new BusinessRuleError("Failed to update password");
    }

    return { success: true };
  }

  /**
   * Reset a user's password (admin operation)
   */
  async resetPassword(
    userId: number,
    newPassword: string,
    actorRole: string,
  ): Promise<ChangePasswordResult> {
    // Authorization check
    if (actorRole !== "admin") {
      throw new AuthorizationError("Only administrators can reset passwords");
    }

    // Find user
    const user = this.userRepo.findById(userId);
    if (!user) {
      throw new AuthenticationError("User not found");
    }

    // Validate new password
    const passwordValidation = validatePasswordComplexity(newPassword);
    if (!passwordValidation.valid) {
      throw new ValidationError(passwordValidation.errors.join(", "));
    }

    // Hash and update password
    const newHash = await hashPassword(newPassword);
    const updated = this.userRepo.updatePassword(userId, newHash);

    if (!updated) {
      throw new BusinessRuleError("Failed to reset password");
    }

    return { success: true };
  }

  /**
   * Deactivate a user (soft delete)
   */
  deactivateUser(userId: number, actorId: number, actorRole: string): boolean {
    // Authorization check
    if (actorRole !== "admin") {
      throw new AuthorizationError("Only administrators can deactivate users");
    }

    // Cannot deactivate yourself
    if (userId === actorId) {
      throw new BusinessRuleError("Cannot deactivate your own account");
    }

    // Check if this is the last admin
    const user = this.userRepo.findById(userId);
    if (user?.role === "admin" && this.userRepo.countActiveAdmins() <= 1) {
      throw new BusinessRuleError("Cannot deactivate the last administrator");
    }

    return this.userRepo.softDeleteById(userId);
  }

  /**
   * Reactivate a user
   */
  reactivateUser(userId: number, actorRole: string): boolean {
    // Authorization check
    if (actorRole !== "admin") {
      throw new AuthorizationError("Only administrators can reactivate users");
    }

    return this.userRepo.restore(userId);
  }

  // ---------------------------------------------------------------------------
  // Query Methods
  // ---------------------------------------------------------------------------

  /**
   * Get all active users (safe version without passwords)
   */
  getAllUsers(): SafeUser[] {
    return this.userRepo.findAllSafe();
  }

  /**
   * Get all users including inactive (admin only)
   */
  getAllUsersIncludingInactive(actorRole: string): SafeUser[] {
    if (actorRole !== "admin") {
      throw new AuthorizationError(
        "Only administrators can view inactive users",
      );
    }
    return this.userRepo.findAllIncludingInactive();
  }

  /**
   * Get a user by ID (safe version)
   */
  getUserById(id: number): SafeUser | null {
    return this.userRepo.findByIdSafe(id);
  }

  /**
   * Validate if a user can perform an action based on role
   */
  canPerformAction(
    userRole: string,
    requiredRole: "admin" | "cashier",
  ): boolean {
    if (requiredRole === "admin") {
      return userRole === "admin";
    }
    // Cashier actions can be performed by both admin and cashier
    return userRole === "admin" || userRole === "cashier";
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let authServiceInstance: AuthService | null = null;

export function getAuthService(): AuthService {
  if (!authServiceInstance) {
    authServiceInstance = new AuthService();
  }
  return authServiceInstance;
}

/** Reset the singleton (for testing) */
export function resetAuthService(): void {
  authServiceInstance = null;
}
