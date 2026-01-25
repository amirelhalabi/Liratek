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
import { UserRepository } from "../repositories/index.js";
import type { SafeUser } from "../repositories/index.js";
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
export declare class AuthService {
    private userRepo;
    constructor(userRepo?: UserRepository);
    /**
     * Authenticate a user with username and password
     */
    login(username: string, password: string): Promise<LoginResult>;
    /**
     * Create a new user (admin only operation)
     */
    createUser(data: {
        username: string;
        password: string;
        role: "admin" | "cashier";
    }, actorRole: string): Promise<CreateUserResult>;
    /**
     * Change a user's password
     */
    changePassword(userId: number, currentPassword: string, newPassword: string): Promise<ChangePasswordResult>;
    /**
     * Reset a user's password (admin operation)
     */
    resetPassword(userId: number, newPassword: string, actorRole: string): Promise<ChangePasswordResult>;
    /**
     * Deactivate a user (soft delete)
     */
    deactivateUser(userId: number, actorId: number, actorRole: string): boolean;
    /**
     * Reactivate a user
     */
    reactivateUser(userId: number, actorRole: string): boolean;
    /**
     * Get all active users (safe version without passwords)
     */
    getAllUsers(): SafeUser[];
    /**
     * Get all users including inactive (admin only)
     */
    getAllUsersIncludingInactive(actorRole: string): SafeUser[];
    /**
     * Get a user by ID (safe version)
     */
    getUserById(id: number): SafeUser | null;
    /**
     * Validate if a user can perform an action based on role
     */
    canPerformAction(userRole: string, requiredRole: "admin" | "cashier"): boolean;
}
export declare function getAuthService(): AuthService;
/** Reset the singleton (for testing) */
export declare function resetAuthService(): void;
