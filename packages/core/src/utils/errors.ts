/**
 * Custom error classes for standardized error handling
 * All errors extend AppError for consistent JSON serialization
 */

/**
 * Base application error class
 * All custom errors should extend this class
 */
export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly isOperational: boolean;
  readonly details?: unknown;

  constructor(
    code: string,
    message: string,
    statusCode: number = 500,
    isOperational: boolean = true,
    details?: unknown,
  ) {
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
  toJSON(): { success: false; error: string; code: string; details?: unknown } {
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
  constructor(message: string, details?: unknown) {
    super("VALIDATION_ERROR", message, 400, true, details);
  }
}

/**
 * Authentication errors (invalid credentials, expired session)
 */
export class AuthenticationError extends AppError {
  constructor(message: string = "Authentication failed") {
    super("AUTH_ERROR", message, 401, true);
  }
}

/**
 * Authorization errors (insufficient permissions)
 */
export class AuthorizationError extends AppError {
  constructor(message: string = "Insufficient permissions") {
    super("AUTHORIZATION_ERROR", message, 403, true);
  }
}

/**
 * Resource not found errors
 */
export class NotFoundError extends AppError {
  constructor(resource: string, id?: number | string) {
    const message = id
      ? `${resource} with id ${id} not found`
      : `${resource} not found`;
    super("NOT_FOUND", message, 404, true);
  }
}

/**
 * Database operation errors
 */
export type RepoConstraintCode =
  | "DUPLICATE_BARCODE"
  | "DUPLICATE_PHONE"
  | "DUPLICATE_CURRENCY_CODE";

export type RepoErrorDetails = {
  code?: RepoConstraintCode;
  entityId?: number | string;
  cause?: unknown;
};

export class DatabaseError extends AppError {
  declare readonly details?: RepoErrorDetails;

  constructor(message: string, details?: RepoErrorDetails) {
    super("DATABASE_ERROR", message, 500, true, details);
  }
}

export function getRepoConstraintCode(
  err: unknown,
): RepoConstraintCode | undefined {
  // New path: DatabaseError.details.code
  if (err instanceof DatabaseError) {
    return err.details?.code;
  }

  // Legacy path: some tests and older code use `error.code = 'DUPLICATE_*'`
  const legacyCode = (err as { code?: unknown })?.code;
  if (
    legacyCode === "DUPLICATE_BARCODE" ||
    legacyCode === "DUPLICATE_PHONE" ||
    legacyCode === "DUPLICATE_CURRENCY_CODE"
  ) {
    return legacyCode;
  }

  return undefined;
}

/**
 * Business rule violation errors
 */
export class BusinessRuleError extends AppError {
  constructor(message: string) {
    super("BUSINESS_RULE_ERROR", message, 422, true);
  }
}

/**
 * Configuration errors (missing or invalid config)
 */
export class ConfigurationError extends AppError {
  constructor(message: string) {
    super("CONFIGURATION_ERROR", message, 500, false);
  }
}

/**
 * Conflict errors (duplicate resources, concurrent modification)
 */
export class ConflictError extends AppError {
  constructor(message: string) {
    super("CONFLICT_ERROR", message, 409, true);
  }
}

/**
 * Type guard to check if an error is an AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

// =============================================================================
// Standardized API Response Types
// =============================================================================

/**
 * Standardized error response structure
 * Used across both Electron IPC and REST API for consistency
 */
export interface ApiError {
  success: false;
  error: {
    code: string; // Machine-readable error code (e.g., "CLIENT_NOT_FOUND")
    message: string; // Human-readable error message
    details?: unknown; // Additional context (validation errors, etc.)
    field?: string; // For field-specific validation errors
  };
}

/**
 * Standardized success response structure
 */
export interface ApiSuccess<T = void> {
  success: true;
  data: T;
}

/**
 * Union type for all API responses
 */
export type ApiResponse<T = void> = ApiSuccess<T> | ApiError;

// =============================================================================
// Error Response Factories
// =============================================================================

/**
 * Create a standardized error response
 */
export function createErrorResponse(
  code: string,
  message: string,
  details?: unknown,
  field?: string,
): ApiError {
  return {
    success: false,
    error: {
      code,
      message,
      details,
      field,
    },
  };
}

/**
 * Create a standardized success response
 */
export function createSuccessResponse<T>(data: T): ApiSuccess<T> {
  return {
    success: true,
    data,
  };
}

// =============================================================================
// Legacy Error Handler (for backward compatibility)
// =============================================================================

/**
 * Handle any error and return a consistent JSON response
 * Use this in IPC handlers to wrap error handling
 *
 * @deprecated Use handleErrorV2() and createErrorResponse() for new code
 */
export function handleError(error: unknown): {
  success: false;
  error: string;
  code: string;
  details?: unknown;
} {
  // Known operational errors
  if (isAppError(error)) {
    // Errors are logged by the caller with proper logger context
    return error.toJSON();
  }

  // SQLite constraint errors
  if (error instanceof Error) {
    if (error.message.includes("UNIQUE constraint")) {
      return new ConflictError(
        "A record with this value already exists",
      ).toJSON();
    }
    if (error.message.includes("FOREIGN KEY constraint")) {
      return new ValidationError(
        "Invalid reference to related record",
      ).toJSON();
    }
  }

  // Unknown errors (potential bugs)
  // Note: This is a fallback handler. Errors should be logged by the caller.
  // We use process.stderr to avoid circular dependency with logger
  process.stderr.write(`Unhandled error: ${error}\n`);

  // In development, expose error details; in production, use generic message
  return {
    success: false,
    error: error instanceof Error ? error.message : "Internal server error",
    code: "INTERNAL_ERROR",
  };
}

/**
 * Convert unknown error to new standardized error response format
 */
export function handleErrorV2(error: unknown): ApiError {
  // Known operational errors
  if (isAppError(error)) {
    return createErrorResponse(error.code, error.message, error.details);
  }

  // SQLite constraint errors
  if (error instanceof Error) {
    if (error.message.includes("UNIQUE constraint")) {
      return createErrorResponse(
        "DUPLICATE_ENTRY",
        "A record with this value already exists",
      );
    }
    if (error.message.includes("FOREIGN KEY constraint")) {
      return createErrorResponse(
        "VALIDATION_ERROR",
        "Invalid reference to related record",
      );
    }
  }

  // Note: This is a fallback handler. Errors should be logged by the caller.
  // We use process.stderr to avoid circular dependency with logger
  process.stderr.write(`Unhandled error: ${error}\n`);

  // Return generic error for unknown errors
  return createErrorResponse(
    "INTERNAL_ERROR",
    error instanceof Error ? error.message : "Internal server error",
    error instanceof Error ? { stack: error.stack } : undefined,
  );
}

/**
 * Wrap an async IPC handler with error handling
 * @example
 * ipcMain.handle('auth:login', wrapHandler(async (e, username, password) => {
 *   // handler code that can throw
 * }));
 */
export function toErrorString(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return typeof err === "string" ? err : JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function wrapHandler<Args extends unknown[], R>(
  handler: (...args: Args) => Promise<R>,
): (...args: Args) => Promise<R | ReturnType<typeof handleError>> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      return handleError(error);
    }
  };
}

/**
 * Wrap an async handler with standardized error handling (V2 format)
 */
export function wrapHandlerV2<Args extends unknown[], R>(
  handler: (...args: Args) => Promise<ApiSuccess<R>>,
): (...args: Args) => Promise<ApiSuccess<R> | ApiError> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      return handleErrorV2(error);
    }
  };
}

// =============================================================================
// Common Error Codes
// =============================================================================

export const ErrorCodes = {
  // Validation Errors (400)
  VALIDATION_ERROR: "VALIDATION_ERROR",
  REQUIRED_FIELD: "REQUIRED_FIELD",
  INVALID_FORMAT: "INVALID_FORMAT",
  INVALID_VALUE: "INVALID_VALUE",

  // Not Found Errors (404)
  NOT_FOUND: "NOT_FOUND",
  CLIENT_NOT_FOUND: "CLIENT_NOT_FOUND",
  PRODUCT_NOT_FOUND: "PRODUCT_NOT_FOUND",
  SALE_NOT_FOUND: "SALE_NOT_FOUND",
  USER_NOT_FOUND: "USER_NOT_FOUND",

  // Conflict Errors (409)
  DUPLICATE_ENTRY: "DUPLICATE_ENTRY",
  DUPLICATE_PHONE: "DUPLICATE_PHONE",
  DUPLICATE_BARCODE: "DUPLICATE_BARCODE",
  DUPLICATE_USERNAME: "DUPLICATE_USERNAME",

  // Authentication/Authorization Errors (401/403)
  UNAUTHORIZED: "UNAUTHORIZED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  FORBIDDEN: "FORBIDDEN",
  INSUFFICIENT_PERMISSIONS: "INSUFFICIENT_PERMISSIONS",

  // Business Logic Errors (422)
  BUSINESS_RULE_VIOLATION: "BUSINESS_RULE_VIOLATION",
  INSUFFICIENT_STOCK: "INSUFFICIENT_STOCK",
  CREDIT_LIMIT_EXCEEDED: "CREDIT_LIMIT_EXCEEDED",

  // Server Errors (500)
  INTERNAL_ERROR: "INTERNAL_ERROR",
  DATABASE_ERROR: "DATABASE_ERROR",
  OPERATION_FAILED: "OPERATION_FAILED",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
