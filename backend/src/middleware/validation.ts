import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { createErrorResponse, ErrorCodes } from "@liratek/core";

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
export function validateRequest(schema: any) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // Validate and parse request body
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        // Format Zod validation errors into our standard format
        const firstError = error.errors[0];
        const field = firstError?.path.join(".");

        const errorResponse = createErrorResponse(
          ErrorCodes.VALIDATION_ERROR,
          firstError?.message || "Validation failed",
          {
            errors: error.errors.map((err) => ({
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
export function validateQuery(schema: any) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.query = schema.parse(req.query) as any;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const firstError = error.errors[0];
        const field = firstError?.path.join(".");

        const errorResponse = createErrorResponse(
          ErrorCodes.VALIDATION_ERROR,
          firstError?.message || "Query validation failed",
          {
            errors: error.errors.map((err) => ({
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
export function validateParams(schema: any) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.params = schema.parse(req.params) as any;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const firstError = error.errors[0];
        const field = firstError?.path.join(".");

        const errorResponse = createErrorResponse(
          ErrorCodes.VALIDATION_ERROR,
          firstError?.message || "Parameter validation failed",
          {
            errors: error.errors.map((err) => ({
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
