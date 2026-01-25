/**
 * Custom error classes for standardized error handling
 * All errors extend AppError for consistent JSON serialization
 */
/**
 * Base application error class
 * All custom errors should extend this class
 */
export class AppError extends Error {
    code;
    statusCode;
    isOperational;
    details;
    constructor(code, message, statusCode = 500, isOperational = true, details) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        this.details = details;
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
    }
    /**
     * Serialize error to JSON for IPC responses
     */
    toJSON() {
        return {
            success: false,
            error: this.message,
            code: this.code,
            ...(this.details !== undefined && { details: this.details }),
        };
    }
}
/**
 * Validation errors (invalid input data)
 */
export class ValidationError extends AppError {
    constructor(message, details) {
        super("VALIDATION_ERROR", message, 400, true, details);
    }
}
/**
 * Authentication errors (invalid credentials, expired session)
 */
export class AuthenticationError extends AppError {
    constructor(message = "Authentication failed") {
        super("AUTH_ERROR", message, 401, true);
    }
}
/**
 * Authorization errors (insufficient permissions)
 */
export class AuthorizationError extends AppError {
    constructor(message = "Insufficient permissions") {
        super("AUTHORIZATION_ERROR", message, 403, true);
    }
}
/**
 * Resource not found errors
 */
export class NotFoundError extends AppError {
    constructor(resource, id) {
        const message = id
            ? `${resource} with id ${id} not found`
            : `${resource} not found`;
        super("NOT_FOUND", message, 404, true);
    }
}
export class DatabaseError extends AppError {
    constructor(message, details) {
        super("DATABASE_ERROR", message, 500, true, details);
    }
}
export function getRepoConstraintCode(err) {
    // New path: DatabaseError.details.code
    if (err instanceof DatabaseError) {
        return err.details?.code;
    }
    // Legacy path: some tests and older code use `error.code = 'DUPLICATE_*'`
    const legacyCode = err?.code;
    if (legacyCode === "DUPLICATE_BARCODE" ||
        legacyCode === "DUPLICATE_PHONE" ||
        legacyCode === "DUPLICATE_CURRENCY_CODE") {
        return legacyCode;
    }
    return undefined;
}
/**
 * Business rule violation errors
 */
export class BusinessRuleError extends AppError {
    constructor(message) {
        super("BUSINESS_RULE_ERROR", message, 422, true);
    }
}
/**
 * Configuration errors (missing or invalid config)
 */
export class ConfigurationError extends AppError {
    constructor(message) {
        super("CONFIGURATION_ERROR", message, 500, false);
    }
}
/**
 * Conflict errors (duplicate resources, concurrent modification)
 */
export class ConflictError extends AppError {
    constructor(message) {
        super("CONFLICT_ERROR", message, 409, true);
    }
}
/**
 * Type guard to check if an error is an AppError
 */
export function isAppError(error) {
    return error instanceof AppError;
}
/**
 * Handle any error and return a consistent JSON response
 * Use this in IPC handlers to wrap error handling
 */
export function handleError(error) {
    // Known operational errors
    if (isAppError(error)) {
        console.warn(`[${error.code}]`, error.message, error.details || "");
        return error.toJSON();
    }
    // SQLite constraint errors
    if (error instanceof Error) {
        if (error.message.includes("UNIQUE constraint")) {
            return new ConflictError("A record with this value already exists").toJSON();
        }
        if (error.message.includes("FOREIGN KEY constraint")) {
            return new ValidationError("Invalid reference to related record").toJSON();
        }
    }
    // Unknown errors (potential bugs)
    console.error("Unhandled error:", error);
    const isDev = process.env.NODE_ENV === "development";
    return {
        success: false,
        error: isDev && error instanceof Error ? error.message : "Internal server error",
        code: "INTERNAL_ERROR",
    };
}
/**
 * Wrap an async IPC handler with error handling
 * @example
 * ipcMain.handle('auth:login', wrapHandler(async (e, username, password) => {
 *   // handler code that can throw
 * }));
 */
export function toErrorString(err) {
    if (err instanceof Error)
        return err.message;
    try {
        return typeof err === "string" ? err : JSON.stringify(err);
    }
    catch {
        return String(err);
    }
}
export function wrapHandler(handler) {
    return async (...args) => {
        try {
            return await handler(...args);
        }
        catch (error) {
            return handleError(error);
        }
    };
}
