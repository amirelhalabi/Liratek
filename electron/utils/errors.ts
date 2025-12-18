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
    details?: unknown
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
export class DatabaseError extends AppError {
  constructor(message: string, details?: unknown) {
    super("DATABASE_ERROR", message, 500, true, details);
  }
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

/**
 * Handle any error and return a consistent JSON response
 * Use this in IPC handlers to wrap error handling
 */
export function handleError(error: unknown): {
  success: false;
  error: string;
  code: string;
  details?: unknown;
} {
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
export function wrapHandler<T extends (...args: any[]) => Promise<any>>(
  handler: T
): (...args: Parameters<T>) => Promise<ReturnType<T> | ReturnType<typeof handleError>> {
  return async (...args: Parameters<T>) => {
    try {
      return await handler(...args);
    } catch (error) {
      return handleError(error);
    }
  };
}
