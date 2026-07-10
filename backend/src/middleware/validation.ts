import { Request, Response, NextFunction } from "express";
import { createErrorResponse, ErrorCodes } from "@liratek/core";
import type { ParsedQs } from "qs";

/** Structural type compatible with both Zod v3 and v4 schemas */
interface Schema {
  parse(data: unknown): unknown;
}

/** One issue entry, shape-compatible across Zod v3 (`.errors`) and v4 (`.issues`). */
interface ZodLikeIssue {
  path: Array<string | number>;
  message: string;
  code: string;
}

interface ZodLikeError {
  name: string;
  issues?: ZodLikeIssue[];
  errors?: ZodLikeIssue[];
}

/**
 * Detect a Zod validation error regardless of WHICH zod package instance
 * threw it.
 *
 * `packages/core`'s validators (including this PR's `createTenantSchema`)
 * are built against zod v4 — `@liratek/core` pins `zod: ^4.3.6`, which is
 * incompatible with backend's/root's own `zod: ^3.x`, so yarn installs a
 * SEPARATE nested `packages/core/node_modules/zod` copy. A schema exported
 * from `@liratek/core` therefore throws a v4 `ZodError` instance that FAILS
 * `instanceof ZodError` against backend's own top-level v3 import — two
 * different classes from two different module instances. Left unfixed,
 * every validation failure on an `@liratek/core`-sourced schema silently
 * falls through to the generic 500 handler instead of a 400 (caught by the
 * WP5/WP6 admin-router tests: `createTenantSchema`'s reserved/invalid-slug
 * rejections came back 500, not 400). Duck-typing on `.name` + the
 * issue-list shape works across both major versions.
 */
function isZodError(error: unknown): error is ZodLikeError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "ZodError" &&
    (Array.isArray((error as ZodLikeError).issues) ||
      Array.isArray((error as ZodLikeError).errors))
  );
}

function zodIssues(error: ZodLikeError): ZodLikeIssue[] {
  return error.issues ?? error.errors ?? [];
}

/**
 * Express middleware for validating request bodies with Zod schemas
 *
 * @example
 * router.post('/clients',
 *   validateRequest(createClientSchema),
 *   (req, res) => {
 *     // req.body is now typed and validated
 *   }
 * );
 */
export function validateRequest(schema: Schema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // Validate and parse request body
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (isZodError(error)) {
        // Format Zod validation errors into our standard format
        const issues = zodIssues(error);
        const firstError = issues[0];
        const field = firstError?.path.join(".");

        const errorResponse = createErrorResponse(
          ErrorCodes.VALIDATION_ERROR,
          firstError?.message || "Validation failed",
          {
            errors: issues.map((err) => ({
              field: err.path.join("."),
              message: err.message,
              code: err.code,
            })),
          },
          field,
        );

        res.status(400).json(errorResponse);
        return;
      }

      // Unknown validation error
      next(error);
    }
  };
}

/**
 * Express middleware for validating request query parameters
 */
export function validateQuery(schema: Schema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.query = schema.parse(req.query) as ParsedQs;
      next();
    } catch (error) {
      if (isZodError(error)) {
        const issues = zodIssues(error);
        const firstError = issues[0];
        const field = firstError?.path.join(".");

        const errorResponse = createErrorResponse(
          ErrorCodes.VALIDATION_ERROR,
          firstError?.message || "Query validation failed",
          {
            errors: issues.map((err) => ({
              field: err.path.join("."),
              message: err.message,
              code: err.code,
            })),
          },
          field,
        );

        res.status(400).json(errorResponse);
        return;
      }

      next(error);
    }
  };
}

/**
 * Express middleware for validating request params
 */
export function validateParams(schema: Schema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.params = schema.parse(req.params) as Record<string, string>;
      next();
    } catch (error) {
      if (isZodError(error)) {
        const issues = zodIssues(error);
        const firstError = issues[0];
        const field = firstError?.path.join(".");

        const errorResponse = createErrorResponse(
          ErrorCodes.VALIDATION_ERROR,
          firstError?.message || "Parameter validation failed",
          {
            errors: issues.map((err) => ({
              field: err.path.join("."),
              message: err.message,
              code: err.code,
            })),
          },
          field,
        );

        res.status(400).json(errorResponse);
        return;
      }

      next(error);
    }
  };
}
