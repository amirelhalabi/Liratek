/**
 * Custom error classes for standardized error handling
 * All errors extend AppError for consistent JSON serialization
 */
/**
 * Base application error class
 * All custom errors should extend this class
 */
export declare class AppError extends Error {
    readonly code: string;
    readonly statusCode: number;
    readonly isOperational: boolean;
    readonly details?: unknown;
    constructor(code: string, message: string, statusCode?: number, isOperational?: boolean, details?: unknown);
    /**
     * Serialize error to JSON for IPC responses
     */
    toJSON(): {
        success: false;
        error: string;
        code: string;
        details?: unknown;
    };
}
/**
 * Validation errors (invalid input data)
 */
export declare class ValidationError extends AppError {
    constructor(message: string, details?: unknown);
}
/**
 * Authentication errors (invalid credentials, expired session)
 */
export declare class AuthenticationError extends AppError {
    constructor(message?: string);
}
/**
 * Authorization errors (insufficient permissions)
 */
export declare class AuthorizationError extends AppError {
    constructor(message?: string);
}
/**
 * Resource not found errors
 */
export declare class NotFoundError extends AppError {
    constructor(resource: string, id?: number | string);
}
/**
 * Database operation errors
 */
export type RepoConstraintCode = "DUPLICATE_BARCODE" | "DUPLICATE_PHONE" | "DUPLICATE_CURRENCY_CODE";
export type RepoErrorDetails = {
    code?: RepoConstraintCode;
    entityId?: number | string;
    cause?: unknown;
};
export declare class DatabaseError extends AppError {
    readonly details?: RepoErrorDetails;
    constructor(message: string, details?: RepoErrorDetails);
}
export declare function getRepoConstraintCode(err: unknown): RepoConstraintCode | undefined;
/**
 * Business rule violation errors
 */
export declare class BusinessRuleError extends AppError {
    constructor(message: string);
}
/**
 * Configuration errors (missing or invalid config)
 */
export declare class ConfigurationError extends AppError {
    constructor(message: string);
}
/**
 * Conflict errors (duplicate resources, concurrent modification)
 */
export declare class ConflictError extends AppError {
    constructor(message: string);
}
/**
 * Type guard to check if an error is an AppError
 */
export declare function isAppError(error: unknown): error is AppError;
/**
 * Handle any error and return a consistent JSON response
 * Use this in IPC handlers to wrap error handling
 */
export declare function handleError(error: unknown): {
    success: false;
    error: string;
    code: string;
    details?: unknown;
};
/**
 * Wrap an async IPC handler with error handling
 * @example
 * ipcMain.handle('auth:login', wrapHandler(async (e, username, password) => {
 *   // handler code that can throw
 * }));
 */
export declare function toErrorString(err: unknown): string;
export declare function wrapHandler<Args extends unknown[], R>(handler: (...args: Args) => Promise<R>): (...args: Args) => Promise<R | ReturnType<typeof handleError>>;
