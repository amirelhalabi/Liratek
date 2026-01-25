/**
 * User Repository
 *
 * Handles all database operations for users.
 * Extends BaseRepository for standard CRUD operations.
 */
import { BaseRepository, type FindOptions } from "./BaseRepository.js";
export interface UserEntity {
    id: number;
    username: string;
    password_hash: string;
    role: "admin" | "cashier" | "staff";
    is_active: number;
}
/** User without sensitive password hash */
export type SafeUser = Omit<UserEntity, "password_hash">;
export interface CreateUserData {
    username: string;
    password_hash: string;
    role: "admin" | "cashier";
    is_active?: number;
}
export interface UpdateUserData {
    username?: string;
    password_hash?: string;
    role?: "admin" | "cashier";
    is_active?: number;
}
export declare class UserRepository extends BaseRepository<UserEntity> {
    constructor();
    /**
     * Find a user by username (for login)
     */
    findByUsername(username: string): UserEntity | null;
    /**
     * Find a user by username including inactive users
     */
    findByUsernameIncludingInactive(username: string): UserEntity | null;
    /**
     * Check if username already exists
     */
    usernameExists(username: string, excludeId?: number): boolean;
    /**
     * Get all users without password hash (safe for API responses)
     */
    findAllSafe(options?: FindOptions): SafeUser[];
    /**
     * Get all users including inactive, without password hash
     */
    findAllIncludingInactive(options?: FindOptions): SafeUser[];
    /**
     * Get user by ID without password hash (safe for API responses)
     */
    findByIdSafe(id: number): SafeUser | null;
    /**
     * Count users by role
     */
    countByRole(role: "admin" | "cashier"): number;
    /**
     * Get the count of active admins (for preventing last admin deletion)
     */
    countActiveAdmins(): number;
    /**
     * Update user's password hash
     */
    updatePassword(id: number, passwordHash: string): boolean;
    /**
     * Create a new user
     */
    createUser(data: CreateUserData): UserEntity;
    /**
     * Update user details (excludes password)
     */
    updateUser(id: number, data: Omit<UpdateUserData, "password_hash">): SafeUser | null;
    /**
     * Override soft delete - users table doesn't have updated_at column
     */
    softDeleteById(id: number): boolean;
    /**
     * Override restore - users table doesn't have updated_at column
     */
    restore(id: number): boolean;
}
export declare function getUserRepository(): UserRepository;
/** Reset the singleton (for testing) */
export declare function resetUserRepository(): void;
