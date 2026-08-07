import { Request, Response, NextFunction } from "express";
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
 * falls through to the generic 500 handler instead of being recognized as
 * a validation rejection (caught by the WP5/WP6 admin-router tests:
 * `createTenantSchema`'s reserved/invalid-slug rejections came back 500
 * instead of the intended rejection response). Duck-typing on `.name` + the
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
        // Rule 19c contract (§10.4 fix): every REST route answers a
        // business-rule/validation failure with HTTP 200 and
        // { success: false, error: <plain string> } — never a 4xx status
        // or an object-shaped `error` — because the frontend adapter
        // branches on `result.success`, never on status code or error
        // shape. This used to be the one exception (400 + an
        // {code,message,details,field} object); it no longer is.
        const firstError = zodIssues(error)[0];
        res.status(200).json({
          success: false,
          error: firstError?.message || "Validation failed",
        });
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
        // See the rule-19c note in validateRequest() above.
        const firstError = zodIssues(error)[0];
        res.status(200).json({
          success: false,
          error: firstError?.message || "Query validation failed",
        });
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
        // See the rule-19c note in validateRequest() above.
        const firstError = zodIssues(error)[0];
        res.status(200).json({
          success: false,
          error: firstError?.message || "Parameter validation failed",
        });
        return;
      }

      next(error);
    }
  };
}
